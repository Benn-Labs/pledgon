package main

import (
	"context"
	"encoding/json"
	"errors"
	"math/big"
	"os"
	"path/filepath"
	"testing"
	"time"

	ethereum "github.com/ethereum/go-ethereum"
	"github.com/ethereum/go-ethereum/accounts/abi"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/core/types"
	"github.com/ethereum/go-ethereum/rpc"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func writeFile(t *testing.T, path, content string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
}

func topicAddress(addr common.Address) common.Hash {
	var h common.Hash
	copy(h[12:], addr.Bytes())
	return h
}

// ─── extractBorrowers ──────────────────────────────────────

func TestExtractBorrowers_DedupesAcrossMultipleDeposits(t *testing.T) {
	a := common.HexToAddress("0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")
	b := common.HexToAddress("0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb")

	logs := []types.Log{
		{Topics: []common.Hash{collateralDepositedTopic, topicAddress(a)}},
		{Topics: []common.Hash{collateralDepositedTopic, topicAddress(a)}}, // a's second deposit
		{Topics: []common.Hash{collateralDepositedTopic, topicAddress(b)}},
	}

	got := extractBorrowers(logs)
	assert.Len(t, got, 2)
	assert.True(t, got[a])
	assert.True(t, got[b])
}

func TestExtractBorrowers_SkipsLogsMissingIndexedBorrower(t *testing.T) {
	logs := []types.Log{
		{Topics: []common.Hash{collateralDepositedTopic}}, // malformed / unrelated log with no borrower topic
	}
	assert.Empty(t, extractBorrowers(logs))
}

// ─── scanBorrowers ─────────────────────────────────────────

type stubFilterer struct {
	t        *testing.T
	byWindow map[[2]uint64][]types.Log
}

func (s *stubFilterer) FilterLogs(_ context.Context, q ethereum.FilterQuery) ([]types.Log, error) {
	key := [2]uint64{q.FromBlock.Uint64(), q.ToBlock.Uint64()}
	logs, ok := s.byWindow[key]
	if !ok {
		s.t.Fatalf("unexpected block window queried: %d-%d", key[0], key[1])
	}
	return logs, nil
}

func TestScanBorrowers_ChunksAcrossBlockRangeAndDedupes(t *testing.T) {
	a := common.HexToAddress("0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")
	b := common.HexToAddress("0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb")
	pool := common.HexToAddress("0x00000000000000000000000000000000000BEEF")

	// fromBlock=100, toBlock=115, chunkBlocks=10 -> windows [100,109], [110,115]
	stub := &stubFilterer{
		t: t,
		byWindow: map[[2]uint64][]types.Log{
			{100, 109}: {{Topics: []common.Hash{collateralDepositedTopic, topicAddress(a)}}},
			{110, 115}: {
				{Topics: []common.Hash{collateralDepositedTopic, topicAddress(a)}}, // a again, different window
				{Topics: []common.Hash{collateralDepositedTopic, topicAddress(b)}},
			},
		},
	}

	got, err := scanBorrowers(stub, pool, 100, 115, 10, 0)
	require.NoError(t, err)
	assert.Equal(t, []string{a.Hex(), b.Hex()}, got)
}

func TestScanBorrowers_SingleWindowWhenRangeFitsInOneChunk(t *testing.T) {
	a := common.HexToAddress("0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")
	pool := common.HexToAddress("0x00000000000000000000000000000000000BEEF")

	stub := &stubFilterer{
		t: t,
		byWindow: map[[2]uint64][]types.Log{
			{100, 104}: {{Topics: []common.Hash{collateralDepositedTopic, topicAddress(a)}}},
		},
	}

	got, err := scanBorrowers(stub, pool, 100, 104, 10, 0)
	require.NoError(t, err)
	assert.Equal(t, []string{a.Hex()}, got)
}

// ─── filterLogsWithRetry ───────────────────────────────────

// scriptedFilterer returns errs[i] for call i+1 while errs last, then logs.
type scriptedFilterer struct {
	t      *testing.T
	window [2]uint64
	logs   []types.Log
	errs   []error
	calls  int
}

func (s *scriptedFilterer) FilterLogs(_ context.Context, q ethereum.FilterQuery) ([]types.Log, error) {
	s.calls++
	if q.FromBlock.Uint64() != s.window[0] || q.ToBlock.Uint64() != s.window[1] {
		s.t.Fatalf("unexpected block window queried: %s-%s", q.FromBlock, q.ToBlock)
	}
	if s.calls <= len(s.errs) {
		return nil, s.errs[s.calls-1]
	}
	return s.logs, nil
}

func stubSleep(t *testing.T) {
	t.Helper()
	old := sleep
	sleep = func(time.Duration) {}
	t.Cleanup(func() { sleep = old })
}

func TestFilterLogsWithRetry_RecoversFromRateLimit(t *testing.T) {
	stubSleep(t)
	a := common.HexToAddress("0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")
	f := &scriptedFilterer{
		t:      t,
		window: [2]uint64{100, 109},
		logs:   []types.Log{{Topics: []common.Hash{collateralDepositedTopic, topicAddress(a)}}},
		errs: []error{
			rpc.HTTPError{StatusCode: 429, Status: "429 Too Many Requests"},
			errors.New("Your app has exceeded its compute units per second capacity"),
			rpc.HTTPError{StatusCode: 429, Status: "429 Too Many Requests"},
		},
	}

	got, err := filterLogsWithRetry(f, ethereum.FilterQuery{
		FromBlock: big.NewInt(100),
		ToBlock:   big.NewInt(109),
	})
	require.NoError(t, err)
	assert.Len(t, got, 1)
	assert.Equal(t, 4, f.calls) // 3 failures, then the success
}

func TestFilterLogsWithRetry_NonRateLimitErrorFailsImmediately(t *testing.T) {
	stubSleep(t)
	f := &scriptedFilterer{
		t:      t,
		window: [2]uint64{100, 109},
		errs:   []error{errors.New("execution reverted")},
	}

	_, err := filterLogsWithRetry(f, ethereum.FilterQuery{
		FromBlock: big.NewInt(100),
		ToBlock:   big.NewInt(109),
	})
	require.Error(t, err)
	assert.Equal(t, 1, f.calls)
}

func TestFilterLogsWithRetry_GivesUpAfterMaxRetries(t *testing.T) {
	stubSleep(t)
	errs := make([]error, maxRateLimitRetries+1)
	for i := range errs {
		errs[i] = rpc.HTTPError{StatusCode: 429, Status: "429 Too Many Requests"}
	}
	f := &scriptedFilterer{t: t, window: [2]uint64{100, 109}, errs: errs}

	_, err := filterLogsWithRetry(f, ethereum.FilterQuery{
		FromBlock: big.NewInt(100),
		ToBlock:   big.NewInt(109),
	})
	require.Error(t, err)
	assert.Equal(t, maxRateLimitRetries+1, f.calls)
}

// ─── patchBorrowers ────────────────────────────────────────

func TestPatchBorrowers_ReplacesArrayPreservesRest(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "config.json")
	writeFile(t, path, `{
  "chainSelectorName": "ethereum-testnet-sepolia",
  "lendingPoolAddress": "0x1111111111111111111111111111111111111111",
  "borrowers": ["0x0000000000000000000000000000000000000000"],
  "gasLimitWei": 500000
}
`)

	err := patchBorrowers(path, []string{"0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", "0xBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB"})
	require.NoError(t, err)

	raw, _ := os.ReadFile(path)
	var m map[string]any
	require.NoError(t, json.Unmarshal(raw, &m))

	borrowers, ok := m["borrowers"].([]any)
	require.True(t, ok)
	assert.Equal(t, []any{"0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", "0xBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB"}, borrowers)
	assert.Equal(t, "ethereum-testnet-sepolia", m["chainSelectorName"])
	assert.Equal(t, "0x1111111111111111111111111111111111111111", m["lendingPoolAddress"])
	assert.Equal(t, float64(500000), m["gasLimitWei"])
}

func TestPatchBorrowers_EmptyListWritesEmptyArray(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "config.json")
	writeFile(t, path, `{"borrowers": ["0x1111111111111111111111111111111111111111"]}`)

	err := patchBorrowers(path, nil)
	require.NoError(t, err)

	raw, _ := os.ReadFile(path)
	var m map[string]any
	require.NoError(t, json.Unmarshal(raw, &m))
	assert.Empty(t, m["borrowers"])
}

func TestPatchBorrowers_ErrorsIfFieldMissing(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "config.json")
	writeFile(t, path, `{"gasLimitWei": 500000}`)

	err := patchBorrowers(path, []string{"0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"})
	require.Error(t, err)
}

func TestPatchBorrowers_ErrorsIfFileMissing(t *testing.T) {
	err := patchBorrowers(filepath.Join(t.TempDir(), "nope.json"), []string{"0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"})
	require.Error(t, err)
}

// ─── run (end to end against a fake repo tree) ─────────────

func TestRun_ErrorsIfLendingPoolNotDeployed(t *testing.T) {
	root := t.TempDir()
	writeFile(t, filepath.Join(root, "contracts", "evm", "deployments", "11155111.json"), `{
  "lendingPool": "0x0000000000000000000000000000000000000000"
}
`)

	err := run(root, "11155111", "staging", "https://example.com/rpc", 100, 10, 2000, 0)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "not deployed")
}

func TestRun_ErrorsIfDeploymentsFileMissing(t *testing.T) {
	err := run(t.TempDir(), "11155111", "staging", "https://example.com/rpc", 100, 10, 2000, 0)
	require.Error(t, err)
}

// ─── risk classification ────────────────────────────────────

type stubCaller struct {
	t             *testing.T
	pool          common.Address
	oracle        common.Address
	thresholdBps  *big.Int
	feedID        [32]byte
	price         *big.Int
	priceDecimals uint8
	updatedAt     *big.Int
	positions     map[common.Address][2]*big.Int // borrower -> [collateral, debt]
}

func (s *stubCaller) CallContract(_ context.Context, call ethereum.CallMsg, _ *big.Int) ([]byte, error) {
	data := call.Data
	to := *call.To
	switch {
	case to == s.pool && len(data) >= 4 && string(data[:4]) == string(selector("liquidationThresholdBps()")):
		u256, _ := abi.NewType("uint256", "", nil)
		return (abi.Arguments{{Type: u256}}).Pack(s.thresholdBps)
	case to == s.pool && len(data) >= 4 && string(data[:4]) == string(selector("collateralFeedId()")):
		bytes32, _ := abi.NewType("bytes32", "", nil)
		return (abi.Arguments{{Type: bytes32}}).Pack(s.feedID)
	case to == s.oracle && len(data) >= 4 && string(data[:4]) == string(selector("latestRound(bytes32)")):
		u256, _ := abi.NewType("uint256", "", nil)
		u8, _ := abi.NewType("uint8", "", nil)
		return (abi.Arguments{{Type: u256}, {Type: u8}, {Type: u256}}).Pack(s.price, s.priceDecimals, s.updatedAt)
	case to == s.pool && len(data) >= 4 && string(data[:4]) == string(selector("positions(address)")):
		addrType, _ := abi.NewType("address", "", nil)
		vals, err := (abi.Arguments{{Type: addrType}}).Unpack(data[4:])
		require.NoError(s.t, err)
		borrower := vals[0].(common.Address)
		pos, ok := s.positions[borrower]
		if !ok {
			pos = [2]*big.Int{big.NewInt(0), big.NewInt(0)}
		}
		u256, _ := abi.NewType("uint256", "", nil)
		return (abi.Arguments{{Type: u256}, {Type: u256}}).Pack(pos[0], pos[1])
	default:
		s.t.Fatalf("unexpected call to %s: %x", to.Hex(), data)
		return nil, nil
	}
}

func TestIsCloseWatch(t *testing.T) {
	price := big.NewInt(100_000_000_000) // $1000.00000000, 8 decimals
	thresholdBps := big.NewInt(8000)     // 80%
	marginBps := big.NewInt(2000)        // close-watch within 20 points -> cutoff 60%

	t.Run("no debt is always safe", func(t *testing.T) {
		assert.False(t, isCloseWatch(big.NewInt(0), big.NewInt(0), price, 8, true, thresholdBps, marginBps))
	})
	t.Run("no price is close-watch regardless of LTV", func(t *testing.T) {
		assert.True(t, isCloseWatch(weiAmount(100, 18), weiAmount(1, 18), price, 8, false, thresholdBps, marginBps))
	})
	t.Run("far from threshold is safe", func(t *testing.T) {
		collateral := weiAmount(100, 18) // $100,000 worth
		debt := weiAmount(1000, 18)      // 1% LTV, well under the 60% cutoff
		assert.False(t, isCloseWatch(collateral, debt, price, 8, true, thresholdBps, marginBps))
	})
	t.Run("within margin of threshold is close-watch", func(t *testing.T) {
		collateral := weiAmount(10, 18) // $10,000 worth
		debt := weiAmount(6500, 18)     // 65% LTV, within the 60%-80% close-watch band
		assert.True(t, isCloseWatch(collateral, debt, price, 8, true, thresholdBps, marginBps))
	})
	t.Run("margin larger than threshold clamps to always close-watch when indebted", func(t *testing.T) {
		collateral := weiAmount(1000, 18) // tiny LTV
		debt := weiAmount(1, 18)
		hugeMargin := big.NewInt(9000) // threshold(8000) - margin(9000) would be negative -> clamped to 0
		assert.True(t, isCloseWatch(collateral, debt, price, 8, true, thresholdBps, hugeMargin))
	})
}

func weiAmount(whole int64, decimals uint) *big.Int {
	scale := new(big.Int).Exp(big.NewInt(10), big.NewInt(int64(decimals)), nil)
	return new(big.Int).Mul(big.NewInt(whole), scale)
}

func TestClassifyByRisk_SplitsIntoTiersUsingSharedThresholdAndPrice(t *testing.T) {
	pool := common.HexToAddress("0x00000000000000000000000000000000000BEEF")
	oracle := common.HexToAddress("0x00000000000000000000000000000000000FEED")
	a := common.HexToAddress("0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa") // no debt -> safe
	b := common.HexToAddress("0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb") // 1% LTV -> safe
	c := common.HexToAddress("0xcccccccccccccccccccccccccccccccccccccc")   // 65% LTV -> close-watch

	stub := &stubCaller{
		t:             t,
		pool:          pool,
		oracle:        oracle,
		thresholdBps:  big.NewInt(8000),
		feedID:        [32]byte{0x01},
		price:         big.NewInt(100_000_000_000),
		priceDecimals: 8,
		updatedAt:     big.NewInt(1_700_000_000),
		positions: map[common.Address][2]*big.Int{
			a: {big.NewInt(0), big.NewInt(0)},
			b: {weiAmount(100, 18), weiAmount(1000, 18)},
			c: {weiAmount(10, 18), weiAmount(6500, 18)},
		},
	}

	closeWatch, safe, err := classifyByRisk(stub, pool, oracle, 2000, []string{a.Hex(), b.Hex(), c.Hex()})
	require.NoError(t, err)
	assert.Equal(t, []string{c.Hex()}, closeWatch)
	assert.Equal(t, []string{a.Hex(), b.Hex()}, safe)
}
