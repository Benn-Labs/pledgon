// Command discover-borrowers scans a deployed LendingPool's
// CollateralDeposited events to build the list of every address that has
// ever deposited collateral, classifies each by how close its current LTV is
// to the pool's liquidation threshold, and patches the two tiers into
// liquidation-protection's config.<target>.json (close-watch, checked every
// 5 minutes) and config.<target>-safe.json (safe, checked on a much slower
// cadence) borrowers fields.
//
// Why tiered at all: the workflow previously re-checked every borrower on
// every tick regardless of how far they actually were from liquidation —
// correct, but wasteful. In a healthy system most positions are nowhere near
// the threshold; checking them every 5 minutes forever spends compute and
// gas on answers that essentially never change. Splitting into two
// deployments of the *same* workflow code, at two schedules, needs no new
// CRE capability and no code duplication — just two more workflow.yaml
// targets and two config files.
//
// Why classification lives here rather than in the workflow itself: same
// reasoning as discovery — no persistent storage across ticks, so the
// workflow can't remember which tier a borrower was in last time without an
// external system to ask. Re-running this tool re-derives both tiers from
// scratch each time, so a borrower's tier reflects current on-chain state
// exactly, not stale history.
//
// Why an external tool rather than in-workflow discovery — the evm
// capability's FilterLogs is available to a CRE workflow, but a Confidential
// Workflow has no persistent storage across cron ticks, so discovering
// borrowers inside the workflow itself would mean rescanning from the pool's
// deployment block on every single tick, forever: an unbounded, ever-growing
// query with no proven precedent in this codebase. Scanning here, on demand,
// and writing the result into config is the same operational shape already
// accepted for escrow-confirmation's vaultAddresses (see docs/architecture.md's
// "per-vault log triggers don't scale automatically").
//
// Usage:
//
//	go run ./cmd/discover-borrowers --chain-id 11155111 --target staging \
//	  --rpc-url https://... --from-block 11738425
package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"math/big"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"

	ethereum "github.com/ethereum/go-ethereum"
	"github.com/ethereum/go-ethereum/accounts/abi"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/core/types"
	"github.com/ethereum/go-ethereum/crypto"
	"github.com/ethereum/go-ethereum/ethclient"
)

var collateralDepositedTopic = crypto.Keccak256Hash([]byte("CollateralDeposited(address,uint256)"))

const bpsDenominator = 10_000

func main() {
	chainID := flag.String("chain-id", "", "chain ID matching contracts/evm/deployments/<chainId>.json (required)")
	target := flag.String("target", "staging", "config target: staging or production")
	rpcURL := flag.String("rpc-url", "", "EVM JSON-RPC URL to scan logs from (required)")
	fromBlock := flag.Uint64("from-block", 0, "block to start scanning from — typically the pool's deployment block (required)")
	chunkBlocks := flag.Uint64("chunk-blocks", 10, "blocks per eth_getLogs request — many free RPC tiers (Alchemy included) cap this at 10")
	ltvMarginBps := flag.Uint64("ltv-margin-bps", 2000, "a borrower is close-watch if their LTV is within this many bps of the liquidation threshold (e.g. 2000 = within 20 percentage points); everyone else is safe")
	flag.Parse()

	if *chainID == "" || *rpcURL == "" || *fromBlock == 0 {
		fmt.Fprintln(os.Stderr, "usage: discover-borrowers --chain-id <id> --rpc-url <url> --from-block <n> [--target staging|production] [--chunk-blocks <n>] [--ltv-margin-bps <n>]")
		os.Exit(1)
	}

	if err := run(".", *chainID, *target, *rpcURL, *fromBlock, *chunkBlocks, *ltvMarginBps); err != nil {
		fmt.Fprintln(os.Stderr, "discover-borrowers:", err)
		os.Exit(1)
	}
}

func run(root, chainID, target, rpcURL string, fromBlock, chunkBlocks, ltvMarginBps uint64) error {
	deploymentsPath := filepath.Join(root, "contracts", "evm", "deployments", chainID+".json")
	raw, err := os.ReadFile(deploymentsPath)
	if err != nil {
		return fmt.Errorf("read %s: %w", deploymentsPath, err)
	}
	var deployments map[string]string
	if err := json.Unmarshal(raw, &deployments); err != nil {
		return fmt.Errorf("parse %s: %w", deploymentsPath, err)
	}
	pool := deployments["lendingPool"]
	if pool == "" || common.HexToAddress(pool) == (common.Address{}) {
		return fmt.Errorf("lendingPool is not deployed (zero/absent) in %s", deploymentsPath)
	}
	poolAddress := common.HexToAddress(pool)
	oracle := deployments["lendingOracleConsumer"]
	if oracle == "" || common.HexToAddress(oracle) == (common.Address{}) {
		return fmt.Errorf("lendingOracleConsumer is not deployed (zero/absent) in %s", deploymentsPath)
	}
	oracleAddress := common.HexToAddress(oracle)

	client, err := ethclient.Dial(rpcURL)
	if err != nil {
		return fmt.Errorf("dial %s: %w", rpcURL, err)
	}
	defer client.Close()

	latest, err := client.BlockNumber(context.Background())
	if err != nil {
		return fmt.Errorf("read latest block: %w", err)
	}

	borrowers, err := scanBorrowers(client, poolAddress, fromBlock, latest, chunkBlocks)
	if err != nil {
		return fmt.Errorf("scan CollateralDeposited logs: %w", err)
	}

	fmt.Printf("found %d borrower(s) from block %d to %d:\n", len(borrowers), fromBlock, latest)
	for _, b := range borrowers {
		fmt.Println(" ", b)
	}

	closeWatch, safe, err := classifyByRisk(client, poolAddress, oracleAddress, ltvMarginBps, borrowers)
	if err != nil {
		return fmt.Errorf("classify borrowers by risk: %w", err)
	}
	fmt.Printf("close-watch (%d): %v\n", len(closeWatch), closeWatch)
	fmt.Printf("safe (%d): %v\n", len(safe), safe)

	configPath := filepath.Join(root, "workflows", "liquidation-protection", fmt.Sprintf("config.%s.json", target))
	if err := patchBorrowers(configPath, closeWatch); err != nil {
		return fmt.Errorf("patch %s: %w", configPath, err)
	}
	fmt.Printf("wrote %d close-watch borrower(s) to %s\n", len(closeWatch), configPath)

	safeConfigPath := filepath.Join(root, "workflows", "liquidation-protection", fmt.Sprintf("config.%s-safe.json", target))
	if err := patchBorrowers(safeConfigPath, safe); err != nil {
		return fmt.Errorf("patch %s: %w", safeConfigPath, err)
	}
	fmt.Printf("wrote %d safe borrower(s) to %s\n", len(safe), safeConfigPath)
	return nil
}

// logFilterer is the one ethclient method this tool needs — narrowed to an
// interface so tests can stub it without a live RPC.
type logFilterer interface {
	FilterLogs(ctx context.Context, q ethereum.FilterQuery) ([]types.Log, error)
}

// scanBorrowers pages eth_getLogs in chunkBlocks-sized windows from fromBlock
// to toBlock (inclusive) — many free RPC tiers (Alchemy included) cap
// eth_getLogs at a small block range (10, in Alchemy's case — see the
// frontend's own chunked eth_getLogs workaround for the same limit), so a
// single wide query would fail outright on those tiers.
func scanBorrowers(client logFilterer, pool common.Address, fromBlock, toBlock, chunkBlocks uint64) ([]string, error) {
	if chunkBlocks == 0 {
		chunkBlocks = 10
	}
	seen := map[common.Address]bool{}
	for start := fromBlock; start <= toBlock; start += chunkBlocks {
		end := start + chunkBlocks - 1
		if end > toBlock {
			end = toBlock
		}
		logs, err := client.FilterLogs(context.Background(), ethereum.FilterQuery{
			FromBlock: new(big.Int).SetUint64(start),
			ToBlock:   new(big.Int).SetUint64(end),
			Addresses: []common.Address{pool},
			Topics:    [][]common.Hash{{collateralDepositedTopic}},
		})
		if err != nil {
			return nil, fmt.Errorf("blocks %d-%d: %w", start, end, err)
		}
		for addr := range extractBorrowers(logs) {
			seen[addr] = true
		}
		if end == toBlock {
			break
		}
	}
	return sortedAddresses(seen), nil
}

// extractBorrowers pulls the indexed `borrower` address (Topics[1]) out of
// each CollateralDeposited log. Pure and network-free so it's directly
// testable against fixture logs.
func extractBorrowers(logs []types.Log) map[common.Address]bool {
	borrowers := map[common.Address]bool{}
	for _, log := range logs {
		if len(log.Topics) < 2 {
			continue
		}
		borrowers[common.BytesToAddress(log.Topics[1].Bytes())] = true
	}
	return borrowers
}

func sortedAddresses(set map[common.Address]bool) []string {
	out := make([]string, 0, len(set))
	for addr := range set {
		out = append(out, addr.Hex())
	}
	sort.Strings(out)
	return out
}

// ─── Risk classification ────────────────────────────────────
// Raw calldata, no generated bindings — same approach as
// liquidation-protection/workflow.go and lending-oracle/workflow.go, reused
// here because it's already proven correct for exactly these reads.

// contractCaller is the one ethclient method this section needs — narrowed
// to an interface so tests can stub it without a live RPC.
type contractCaller interface {
	CallContract(ctx context.Context, call ethereum.CallMsg, blockNumber *big.Int) ([]byte, error)
}

func selector(signature string) []byte {
	return crypto.Keccak256([]byte(signature))[:4]
}

func callContract(client contractCaller, to common.Address, calldata []byte) ([]byte, error) {
	return client.CallContract(context.Background(), ethereum.CallMsg{To: &to, Data: calldata}, nil)
}

func readUint256(client contractCaller, to common.Address, signature string) (*big.Int, error) {
	data, err := callContract(client, to, selector(signature))
	if err != nil {
		return nil, fmt.Errorf("call %s: %w", signature, err)
	}
	u256, _ := abi.NewType("uint256", "", nil)
	vals, err := (abi.Arguments{{Type: u256}}).Unpack(data)
	if err != nil {
		return nil, fmt.Errorf("decode %s reply: %w", signature, err)
	}
	return vals[0].(*big.Int), nil
}

func readCollateralFeedID(client contractCaller, pool common.Address) ([32]byte, error) {
	data, err := callContract(client, pool, selector("collateralFeedId()"))
	if err != nil {
		return [32]byte{}, fmt.Errorf("call collateralFeedId(): %w", err)
	}
	bytes32, _ := abi.NewType("bytes32", "", nil)
	vals, err := (abi.Arguments{{Type: bytes32}}).Unpack(data)
	if err != nil {
		return [32]byte{}, fmt.Errorf("decode collateralFeedId() reply: %w", err)
	}
	return vals[0].([32]byte), nil
}

// readLatestRound mirrors LendingOracleConsumer.latestRound(feedId) — returns
// (value, decimals, updatedAt); updatedAt == 0 means no price has ever been
// reported for this feed.
func readLatestRound(client contractCaller, oracle common.Address, feedID [32]byte) (value *big.Int, decimals uint8, updatedAt *big.Int, err error) {
	bytes32, _ := abi.NewType("bytes32", "", nil)
	packed, err := (abi.Arguments{{Type: bytes32}}).Pack(feedID)
	if err != nil {
		return nil, 0, nil, err
	}
	data, err := callContract(client, oracle, append(selector("latestRound(bytes32)"), packed...))
	if err != nil {
		return nil, 0, nil, fmt.Errorf("call latestRound(): %w", err)
	}
	u256, _ := abi.NewType("uint256", "", nil)
	u8, _ := abi.NewType("uint8", "", nil)
	vals, err := (abi.Arguments{{Type: u256}, {Type: u8}, {Type: u256}}).Unpack(data)
	if err != nil {
		return nil, 0, nil, fmt.Errorf("decode latestRound() reply: %w", err)
	}
	return vals[0].(*big.Int), vals[1].(uint8), vals[2].(*big.Int), nil
}

func readPosition(client contractCaller, pool, borrower common.Address) (collateralAmount, debtAmount *big.Int, err error) {
	addrType, _ := abi.NewType("address", "", nil)
	packed, err := (abi.Arguments{{Type: addrType}}).Pack(borrower)
	if err != nil {
		return nil, nil, err
	}
	data, err := callContract(client, pool, append(selector("positions(address)"), packed...))
	if err != nil {
		return nil, nil, fmt.Errorf("call positions(%s): %w", borrower.Hex(), err)
	}
	u256, _ := abi.NewType("uint256", "", nil)
	vals, err := (abi.Arguments{{Type: u256}, {Type: u256}}).Unpack(data)
	if err != nil {
		return nil, nil, fmt.Errorf("decode positions() reply: %w", err)
	}
	return vals[0].(*big.Int), vals[1].(*big.Int), nil
}

// ltvBps returns debt/collateralValue in bps, or nil if collateral is worth
// nothing (avoids a division by zero — such a position is never close-watch
// by definition: zero collateral value with debt would already be maximally
// eligible, and with zero debt it's excluded before this is ever called).
func ltvBps(collateralAmount, debtAmount, price *big.Int, priceDecimals uint8) *big.Int {
	scale := new(big.Int).Exp(big.NewInt(10), big.NewInt(int64(priceDecimals)), nil)
	collateralValue := new(big.Int).Div(new(big.Int).Mul(collateralAmount, price), scale)
	if collateralValue.Sign() == 0 {
		return nil
	}
	return new(big.Int).Div(new(big.Int).Mul(debtAmount, big.NewInt(bpsDenominator)), collateralValue)
}

// isCloseWatch decides which tier a borrower belongs in. Deliberately
// conservative on missing information: no debt is always safe (nothing to
// liquidate regardless of price); a stale/never-reported price, or a
// collateral value of zero with real debt, can't be assessed, so it's
// close-watch rather than assumed safe.
func isCloseWatch(collateralAmount, debtAmount, price *big.Int, priceDecimals uint8, hasPrice bool, thresholdBps, marginBps *big.Int) bool {
	if debtAmount.Sign() == 0 {
		return false
	}
	if !hasPrice {
		return true
	}
	ltv := ltvBps(collateralAmount, debtAmount, price, priceDecimals)
	if ltv == nil {
		return true
	}
	cutoff := new(big.Int).Sub(thresholdBps, marginBps)
	if cutoff.Sign() < 0 {
		cutoff = big.NewInt(0)
	}
	return ltv.Cmp(cutoff) >= 0
}

// classifyByRisk reads the pool's threshold and price once (both apply to
// every borrower, not per-borrower reads), then buckets each borrower by
// isCloseWatch. Preserves the deterministic sort order scanBorrowers already
// produced within each tier.
func classifyByRisk(client contractCaller, pool, oracle common.Address, marginBps uint64, borrowers []string) (closeWatch, safe []string, err error) {
	thresholdBps, err := readUint256(client, pool, "liquidationThresholdBps()")
	if err != nil {
		return nil, nil, err
	}
	feedID, err := readCollateralFeedID(client, pool)
	if err != nil {
		return nil, nil, err
	}
	price, priceDecimals, updatedAt, err := readLatestRound(client, oracle, feedID)
	if err != nil {
		return nil, nil, err
	}
	hasPrice := updatedAt.Sign() > 0
	margin := new(big.Int).SetUint64(marginBps)

	for _, addr := range borrowers {
		borrower := common.HexToAddress(addr)
		collateralAmount, debtAmount, err := readPosition(client, pool, borrower)
		if err != nil {
			return nil, nil, err
		}
		if isCloseWatch(collateralAmount, debtAmount, price, priceDecimals, hasPrice, thresholdBps, margin) {
			closeWatch = append(closeWatch, addr)
		} else {
			safe = append(safe, addr)
		}
	}
	return closeWatch, safe, nil
}

// patchBorrowers replaces the value of the top-level "borrowers": [...] array
// in a JSON config file, editing the raw bytes rather than unmarshal/remarshal
// — same reasoning as cmd/wire-config's patchAddressField: a real run's diff
// should be exactly the borrowers array that changed, nothing else reordered
// or reformatted.
func patchBorrowers(path string, borrowers []string) error {
	raw, err := os.ReadFile(path)
	if err != nil {
		return err
	}

	var config map[string]json.RawMessage
	if err := json.Unmarshal(raw, &config); err != nil {
		return fmt.Errorf("parse: %w", err)
	}
	if _, ok := config["borrowers"]; !ok {
		return fmt.Errorf("field %q not found", "borrowers")
	}

	quoted := make([]string, len(borrowers))
	for i, b := range borrowers {
		quoted[i] = fmt.Sprintf("%q", b)
	}
	replacement := fmt.Sprintf(`"borrowers": [%s]`, strings.Join(quoted, ", "))

	pattern := regexp.MustCompile(`"borrowers"\s*:\s*\[[^\]]*\]`)
	updated := pattern.ReplaceAll(raw, []byte(replacement))

	return os.WriteFile(path, updated, 0o644)
}
