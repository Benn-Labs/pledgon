package main

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	ethereum "github.com/ethereum/go-ethereum"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/core/types"
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

	got, err := scanBorrowers(stub, pool, 100, 115, 10)
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

	got, err := scanBorrowers(stub, pool, 100, 104, 10)
	require.NoError(t, err)
	assert.Equal(t, []string{a.Hex()}, got)
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

	err := run(root, "11155111", "staging", "https://example.com/rpc", 100, 10)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "not deployed")
}

func TestRun_ErrorsIfDeploymentsFileMissing(t *testing.T) {
	err := run(t.TempDir(), "11155111", "staging", "https://example.com/rpc", 100, 10)
	require.Error(t, err)
}
