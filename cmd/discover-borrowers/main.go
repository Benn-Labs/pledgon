// Command discover-borrowers scans a deployed LendingPool's
// CollateralDeposited events to build the list of every address that has
// ever deposited collateral, and patches that list into
// liquidation-protection's config.<target>.json borrowers field.
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
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/core/types"
	"github.com/ethereum/go-ethereum/crypto"
	"github.com/ethereum/go-ethereum/ethclient"
)

var collateralDepositedTopic = crypto.Keccak256Hash([]byte("CollateralDeposited(address,uint256)"))

func main() {
	chainID := flag.String("chain-id", "", "chain ID matching contracts/evm/deployments/<chainId>.json (required)")
	target := flag.String("target", "staging", "config target: staging or production")
	rpcURL := flag.String("rpc-url", "", "EVM JSON-RPC URL to scan logs from (required)")
	fromBlock := flag.Uint64("from-block", 0, "block to start scanning from — typically the pool's deployment block (required)")
	chunkBlocks := flag.Uint64("chunk-blocks", 10, "blocks per eth_getLogs request — many free RPC tiers (Alchemy included) cap this at 10")
	flag.Parse()

	if *chainID == "" || *rpcURL == "" || *fromBlock == 0 {
		fmt.Fprintln(os.Stderr, "usage: discover-borrowers --chain-id <id> --rpc-url <url> --from-block <n> [--target staging|production] [--chunk-blocks <n>]")
		os.Exit(1)
	}

	if err := run(".", *chainID, *target, *rpcURL, *fromBlock, *chunkBlocks); err != nil {
		fmt.Fprintln(os.Stderr, "discover-borrowers:", err)
		os.Exit(1)
	}
}

func run(root, chainID, target, rpcURL string, fromBlock, chunkBlocks uint64) error {
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

	configPath := filepath.Join(root, "workflows", "liquidation-protection", fmt.Sprintf("config.%s.json", target))
	if err := patchBorrowers(configPath, borrowers); err != nil {
		return fmt.Errorf("patch %s: %w", configPath, err)
	}
	fmt.Printf("wrote %d borrower(s) to %s\n", len(borrowers), configPath)
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
