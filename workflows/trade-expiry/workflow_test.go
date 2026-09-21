package main

import (
	"bytes"
	"context"
	"fmt"
	"math/big"
	"testing"
	"time"

	"github.com/ethereum/go-ethereum/accounts/abi"
	"github.com/ethereum/go-ethereum/common"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/smartcontractkit/cre-sdk-go/capabilities/blockchain/evm"
	evmmock "github.com/smartcontractkit/cre-sdk-go/capabilities/blockchain/evm/mock"
	"github.com/smartcontractkit/cre-sdk-go/cre"
	"github.com/smartcontractkit/cre-sdk-go/cre/testutils"
)

const (
	sepoliaChainName = "ethereum-testnet-sepolia"
	keeperAddress    = "0x00000000000000000000000000000000000CAFE"
)

var (
	factoryAddress = common.HexToAddress("0x00000000000000000000000000000000000FAC7")
	vaultA         = common.HexToAddress("0x000000000000000000000000000000000000A1")
	vaultB         = common.HexToAddress("0x000000000000000000000000000000000000B2")
)

// vaultState is the on-chain shape discoverExpired reads for one vault.
type vaultState struct {
	cancelled          bool
	funded             bool
	fundingDeadline    *big.Int
	milestoneDeadlines []*big.Int // index -> deadline; 0 means "not applicable"
}

func testConfig() *Config {
	return &Config{
		Schedule:             "0 */5 * * * *",
		ChainSelectorName:    sepoliaChainName,
		EscrowFactoryAddress: factoryAddress.Hex(),
		KeeperAddress:        "0x0000000000000000000000000000000000000000",
		GasLimitWei:          500000,
	}
}

func configWithKeeper() *Config {
	config := testConfig()
	config.KeeperAddress = keeperAddress
	return config
}

func packUint256(v *big.Int) []byte {
	u256, _ := abi.NewType("uint256", "", nil)
	packed, _ := (abi.Arguments{{Type: u256}}).Pack(v)
	return packed
}

func packBool(v bool) []byte {
	boolType, _ := abi.NewType("bool", "", nil)
	packed, _ := (abi.Arguments{{Type: boolType}}).Pack(v)
	return packed
}

func packAddress(v common.Address) []byte {
	addrType, _ := abi.NewType("address", "", nil)
	packed, _ := (abi.Arguments{{Type: addrType}}).Pack(v)
	return packed
}

// decodeUint256Arg reads the single uint256 argument off the end of calldata
// (after the 4-byte selector) — the mirror of encodeUint256Arg in the mocked
// contracts below.
func decodeUint256Arg(calldata []byte) *big.Int {
	u256, _ := abi.NewType("uint256", "", nil)
	vals, err := (abi.Arguments{{Type: u256}}).Unpack(calldata[4:])
	if err != nil {
		panic(err)
	}
	return vals[0].(*big.Int)
}

// stubChain wires a fake EscrowFactory + set of EscrowVaults, in vault order,
// answering exactly the selectors discoverExpired/relayExpiry use.
func stubChain(t *testing.T, vaultOrder []common.Address, vaults map[common.Address]vaultState, writeStatus evm.TxStatus) (*[]*evm.WriteReportRequest, func(failOnCall int)) {
	t.Helper()

	chainSelector, err := evm.ChainSelectorFromName(sepoliaChainName)
	require.NoError(t, err)

	capability, err := evmmock.NewClientCapability(chainSelector, t)
	require.NoError(t, err)

	capability.CallContract = func(_ context.Context, input *evm.CallContractRequest) (*evm.CallContractReply, error) {
		to := common.BytesToAddress(input.Call.To)
		data := input.Call.Data
		sig := data[:4]

		switch {
		case to == factoryAddress && bytes.Equal(sig, selector("vaultCount()")):
			return &evm.CallContractReply{Data: packUint256(big.NewInt(int64(len(vaultOrder))))}, nil
		case to == factoryAddress && bytes.Equal(sig, selector("allVaults(uint256)")):
			idx := decodeUint256Arg(data)
			return &evm.CallContractReply{Data: packAddress(vaultOrder[idx.Int64()])}, nil
		}

		state, ok := vaults[to]
		if !ok {
			t.Fatalf("unexpected call to unknown address %s", to.Hex())
		}

		switch {
		case bytes.Equal(sig, selector("cancelled()")):
			return &evm.CallContractReply{Data: packBool(state.cancelled)}, nil
		case bytes.Equal(sig, selector("funded()")):
			return &evm.CallContractReply{Data: packBool(state.funded)}, nil
		case bytes.Equal(sig, selector("fundingDeadline()")):
			return &evm.CallContractReply{Data: packUint256(state.fundingDeadline)}, nil
		case bytes.Equal(sig, selector("milestoneCount()")):
			return &evm.CallContractReply{Data: packUint256(big.NewInt(int64(len(state.milestoneDeadlines))))}, nil
		case bytes.Equal(sig, selector("milestoneDeadline(uint256)")):
			idx := decodeUint256Arg(data)
			return &evm.CallContractReply{Data: packUint256(state.milestoneDeadlines[idx.Int64()])}, nil
		default:
			t.Fatalf("unexpected call to %s data %x", to.Hex(), data)
			return nil, nil
		}
	}

	callCount := 0
	failOnCall := 0 // 0 means never fail

	captured := &[]*evm.WriteReportRequest{}
	capability.WriteReport = func(_ context.Context, input *evm.WriteReportRequest) (*evm.WriteReportReply, error) {
		callCount++
		*captured = append(*captured, input)
		if callCount == failOnCall {
			return nil, fmt.Errorf("simulated write failure")
		}
		txHash := make([]byte, 32)
		txHash[31] = byte(len(*captured))
		return &evm.WriteReportReply{TxStatus: writeStatus, TxHash: txHash}, nil
	}

	setFailOnCall := func(n int) { failOnCall = n }
	return captured, setFailOnCall
}

func noDeadline() *big.Int { return big.NewInt(0) }

// ─── Pure logic ────────────────────────────────────────────

func TestEncodeExpiryReportRoundTrips_Funding(t *testing.T) {
	encoded, err := encodeExpiryReport(vaultA, false, big.NewInt(0))
	require.NoError(t, err)

	args, err := expiryReportArgs()
	require.NoError(t, err)
	vals, err := args.Unpack(encoded)
	require.NoError(t, err)
	require.Len(t, vals, 3)

	assert.Equal(t, vaultA, vals[0].(common.Address))
	assert.Equal(t, false, vals[1].(bool))
	assert.Equal(t, int64(0), vals[2].(*big.Int).Int64())
}

func TestEncodeExpiryReportRoundTrips_Milestone(t *testing.T) {
	encoded, err := encodeExpiryReport(vaultB, true, big.NewInt(3))
	require.NoError(t, err)

	args, err := expiryReportArgs()
	require.NoError(t, err)
	vals, err := args.Unpack(encoded)
	require.NoError(t, err)

	assert.Equal(t, vaultB, vals[0].(common.Address))
	assert.Equal(t, true, vals[1].(bool))
	assert.Equal(t, int64(3), vals[2].(*big.Int).Int64())
}

// ─── discoverExpired ────────────────────────────────────────

func TestDiscoverExpired_FindsPastFundingDeadline(t *testing.T) {
	vaults := map[common.Address]vaultState{
		vaultA: {funded: false, fundingDeadline: big.NewInt(100), milestoneDeadlines: nil},
	}
	captured, _ := stubChain(t, []common.Address{vaultA}, vaults, evm.TxStatus_TX_STATUS_SUCCESS)
	_ = captured
	runtime := testutils.NewRuntime(t, nil)

	items, err := discoverExpired(runtime, evmClientFor(t), factoryAddress, 200)
	require.NoError(t, err)
	require.Len(t, items, 1)
	assert.Equal(t, vaultA, items[0].vault)
	assert.False(t, items[0].isMilestone)
}

func TestDiscoverExpired_SkipsFundingNotYetDue(t *testing.T) {
	vaults := map[common.Address]vaultState{
		vaultA: {funded: false, fundingDeadline: big.NewInt(300), milestoneDeadlines: nil},
	}
	stubChain(t, []common.Address{vaultA}, vaults, evm.TxStatus_TX_STATUS_SUCCESS)
	runtime := testutils.NewRuntime(t, nil)

	items, err := discoverExpired(runtime, evmClientFor(t), factoryAddress, 200)
	require.NoError(t, err)
	assert.Empty(t, items)
}

func TestDiscoverExpired_SkipsAlreadyFunded(t *testing.T) {
	vaults := map[common.Address]vaultState{
		vaultA: {funded: true, fundingDeadline: big.NewInt(100), milestoneDeadlines: nil},
	}
	stubChain(t, []common.Address{vaultA}, vaults, evm.TxStatus_TX_STATUS_SUCCESS)
	runtime := testutils.NewRuntime(t, nil)

	items, err := discoverExpired(runtime, evmClientFor(t), factoryAddress, 200)
	require.NoError(t, err)
	assert.Empty(t, items)
}

func TestDiscoverExpired_SkipsCancelledVaultEntirely(t *testing.T) {
	vaults := map[common.Address]vaultState{
		vaultA: {cancelled: true, funded: false, fundingDeadline: big.NewInt(100), milestoneDeadlines: []*big.Int{big.NewInt(50)}},
	}
	stubChain(t, []common.Address{vaultA}, vaults, evm.TxStatus_TX_STATUS_SUCCESS)
	runtime := testutils.NewRuntime(t, nil)

	items, err := discoverExpired(runtime, evmClientFor(t), factoryAddress, 200)
	require.NoError(t, err)
	assert.Empty(t, items)
}

func TestDiscoverExpired_FindsPastMilestoneDeadline(t *testing.T) {
	vaults := map[common.Address]vaultState{
		vaultA: {funded: true, fundingDeadline: noDeadline(), milestoneDeadlines: []*big.Int{noDeadline(), big.NewInt(100)}},
	}
	stubChain(t, []common.Address{vaultA}, vaults, evm.TxStatus_TX_STATUS_SUCCESS)
	runtime := testutils.NewRuntime(t, nil)

	items, err := discoverExpired(runtime, evmClientFor(t), factoryAddress, 200)
	require.NoError(t, err)
	require.Len(t, items, 1)
	assert.Equal(t, vaultA, items[0].vault)
	assert.True(t, items[0].isMilestone)
	assert.Equal(t, int64(1), items[0].milestoneIndex.Int64())
}

func TestDiscoverExpired_MultipleVaultsIndependently(t *testing.T) {
	vaults := map[common.Address]vaultState{
		vaultA: {funded: false, fundingDeadline: big.NewInt(100), milestoneDeadlines: nil},
		vaultB: {funded: true, fundingDeadline: noDeadline(), milestoneDeadlines: []*big.Int{big.NewInt(50)}},
	}
	stubChain(t, []common.Address{vaultA, vaultB}, vaults, evm.TxStatus_TX_STATUS_SUCCESS)
	runtime := testutils.NewRuntime(t, nil)

	items, err := discoverExpired(runtime, evmClientFor(t), factoryAddress, 200)
	require.NoError(t, err)
	require.Len(t, items, 2)
}

// ─── onCronTrigger ────────────────────────────────────────

func TestOnCronTrigger_SkipsWriteWhenNoKeeper(t *testing.T) {
	vaults := map[common.Address]vaultState{
		vaultA: {funded: false, fundingDeadline: big.NewInt(1), milestoneDeadlines: nil},
	}
	stubChain(t, []common.Address{vaultA}, vaults, evm.TxStatus_TX_STATUS_SUCCESS)
	runtime := testutils.NewRuntime(t, nil)
	runtimeAt(t, runtime, 100)

	result, err := onCronTrigger(testConfig(), runtime, nil)
	require.NoError(t, err)
	assert.Contains(t, result, "found 1 expired item")
	assert.Contains(t, result, "no keeper configured")
}

func TestOnCronTrigger_RelaysExpiredItemToKeeper(t *testing.T) {
	vaults := map[common.Address]vaultState{
		vaultA: {funded: false, fundingDeadline: big.NewInt(1), milestoneDeadlines: nil},
	}
	captured, _ := stubChain(t, []common.Address{vaultA}, vaults, evm.TxStatus_TX_STATUS_SUCCESS)
	runtime := testutils.NewRuntime(t, nil)
	runtimeAt(t, runtime, 100)

	result, err := onCronTrigger(configWithKeeper(), runtime, nil)
	require.NoError(t, err)
	assert.Contains(t, result, "1 relayed, 0 failed")
	require.Len(t, *captured, 1)
	assert.Equal(t, common.HexToAddress(keeperAddress).Bytes(), (*captured)[0].Receiver)

	args, err := expiryReportArgs()
	require.NoError(t, err)
	vals, err := args.Unpack((*captured)[0].Report.RawReport[cre.ReportMetadataHeaderLength:])
	require.NoError(t, err)
	assert.Equal(t, vaultA, vals[0].(common.Address))
	assert.Equal(t, false, vals[1].(bool))
}

func TestOnCronTrigger_OneFailureDoesNotStopTheRest(t *testing.T) {
	vaults := map[common.Address]vaultState{
		vaultA: {funded: false, fundingDeadline: big.NewInt(1), milestoneDeadlines: nil},
		vaultB: {funded: false, fundingDeadline: big.NewInt(1), milestoneDeadlines: nil},
	}
	captured, setFailOnCall := stubChain(t, []common.Address{vaultA, vaultB}, vaults, evm.TxStatus_TX_STATUS_SUCCESS)
	setFailOnCall(1) // the first relay attempt fails; the second must still be tried
	runtime := testutils.NewRuntime(t, nil)
	runtimeAt(t, runtime, 100)

	result, err := onCronTrigger(configWithKeeper(), runtime, nil)
	require.NoError(t, err, "one item's relay failure must not fail the whole tick")
	assert.Contains(t, result, "found 2 expired item")
	assert.Contains(t, result, "1 relayed, 1 failed")
	assert.Len(t, *captured, 2, "both items must still be attempted")
}

func TestOnCronTrigger_NoExpiredItems_NoWrites(t *testing.T) {
	vaults := map[common.Address]vaultState{
		vaultA: {funded: true, fundingDeadline: noDeadline(), milestoneDeadlines: nil},
	}
	captured, _ := stubChain(t, []common.Address{vaultA}, vaults, evm.TxStatus_TX_STATUS_SUCCESS)
	runtime := testutils.NewRuntime(t, nil)
	runtimeAt(t, runtime, 100)

	result, err := onCronTrigger(configWithKeeper(), runtime, nil)
	require.NoError(t, err)
	assert.Contains(t, result, "found 0 expired item")
	assert.Empty(t, *captured)
}

func TestOnCronTrigger_ErrorsOnMissingFactory(t *testing.T) {
	runtime := testutils.NewRuntime(t, nil)
	config := testConfig()
	config.EscrowFactoryAddress = "0x0000000000000000000000000000000000000000"

	_, err := onCronTrigger(config, runtime, nil)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "escrowFactoryAddress")
}

func TestInitWorkflow_RegistersHandler(t *testing.T) {
	workflow, err := InitWorkflow(testConfig(), nil, nil)
	require.NoError(t, err)
	assert.Len(t, workflow, 1)
}

// ─── test helpers depending on the mock's registration side effects ──

// evmClientFor returns the evm.Client for the chain selector every test in
// this file uses; the mock capability registers itself against the runtime
// via testutils/evmmock internals once created by stubChain, so this just
// needs to target the same chain selector.
func evmClientFor(t *testing.T) *evm.Client {
	t.Helper()
	chainSelector, err := evm.ChainSelectorFromName(sepoliaChainName)
	require.NoError(t, err)
	return &evm.Client{ChainSelector: chainSelector}
}

// runtimeAt pins the runtime's clock (as onCronTrigger reads it via
// runtime.Now()) to an exact Unix timestamp, so deadline comparisons in these
// tests don't depend on when they happen to run.
func runtimeAt(t *testing.T, runtime *testutils.TestRuntime, unixSeconds int64) {
	t.Helper()
	runtime.SetTimeProvider(func() time.Time { return time.Unix(unixSeconds, 0) })
}
