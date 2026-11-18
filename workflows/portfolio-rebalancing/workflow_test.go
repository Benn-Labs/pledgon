package main

import (
	"context"
	"math/big"
	"testing"

	"github.com/ethereum/go-ethereum/accounts/abi"
	"github.com/ethereum/go-ethereum/common"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/smartcontractkit/cre-sdk-go/capabilities/blockchain/evm"
	evmmock "github.com/smartcontractkit/cre-sdk-go/capabilities/blockchain/evm/mock"
	"github.com/smartcontractkit/cre-sdk-go/capabilities/networking/http"
	httpmock "github.com/smartcontractkit/cre-sdk-go/capabilities/networking/http/mock"
	"github.com/smartcontractkit/cre-sdk-go/cre"
	"github.com/smartcontractkit/cre-sdk-go/cre/testutils"
)

const (
	apiToken         = "test-rebalancing-price-token"
	sepoliaChainName = "ethereum-testnet-sepolia"
	consumerAddress  = "0x00000000000000000000000000000000000CAFE"
	poolAddress      = "0x00000000000000000000000000000000000BEEF"
)

var (
	borrowerAddress       = common.HexToAddress("0x000000000000000000000000000000000B0771E")
	secondBorrowerAddress = common.HexToAddress("0x00000000000000000000000000000000BADA55E")
)

// weiAmount returns whole * 10^decimals as a *big.Int (10e18-style literals
// overflow Go's int64 constant conversion, unlike Solidity's uint256).
func weiAmount(whole int64, decimals uint) *big.Int {
	scale := new(big.Int).Exp(big.NewInt(10), big.NewInt(int64(decimals)), nil)
	return new(big.Int).Mul(big.NewInt(whole), scale)
}

func testConfig() *Config {
	return &Config{
		Schedule:           "0 7 * * * *",
		ChainSelectorName:  sepoliaChainName,
		LendingPoolAddress: poolAddress,
		Borrowers:          []string{borrowerAddress.Hex()},
		VerificationURL:    "https://example.com/price/collateral",
		SecretID:           "REBALANCING_PRICE_API_TOKEN",
		ResponsePricePath:  "data.price",
		PriceDecimals:      8,
		RebalanceTargetBps: 7000, // advise above 70% LTV, pool threshold 80%
		ConsumerAddress:    "0x0000000000000000000000000000000000000000",
		GasLimitWei:        500000,
	}
}

func configWithConsumer() *Config {
	config := testConfig()
	config.ConsumerAddress = consumerAddress
	return config
}

func testSecrets() testutils.Secrets {
	return testutils.Secrets{
		cre.DefaultSecretNamespace: {"REBALANCING_PRICE_API_TOKEN": apiToken},
	}
}

// stubHTTP registers an in-enclave HTTP stub and records the Authorization
// header values it was called with.
func stubHTTP(t *testing.T, statusCode uint32, body string) *[]string {
	t.Helper()

	capability, err := httpmock.NewClientCapability(t)
	require.NoError(t, err)

	captured := &[]string{}
	capability.SendRequest = func(_ context.Context, input *http.Request) (*http.Response, error) {
		if auth := input.MultiHeaders["Authorization"]; auth != nil {
			*captured = append(*captured, auth.Values...)
		}
		return &http.Response{StatusCode: statusCode, Body: []byte(body)}, nil
	}
	return captured
}

type position struct {
	collateral *big.Int
	debt       *big.Int
}

// stubEVM registers the EVM capability, answering positions() per borrower
// from the given map (unlisted borrowers read as zero/zero),
// liquidationThresholdBps() once for the whole pool, and capturing every
// WriteReport call.
func stubEVM(t *testing.T, positions map[common.Address]position, thresholdBps *big.Int, writeStatus evm.TxStatus, failPositionsFor ...common.Address) (writes *[]*evm.WriteReportRequest, thresholdCalls *int) {
	t.Helper()

	chainSelector, err := evm.ChainSelectorFromName(sepoliaChainName)
	require.NoError(t, err)

	capability, err := evmmock.NewClientCapability(chainSelector, t)
	require.NoError(t, err)

	positionsSelector := selector("positions(address)")
	thresholdSelector := selector("liquidationThresholdBps()")
	failing := map[common.Address]bool{}
	for _, a := range failPositionsFor {
		failing[a] = true
	}

	calls := 0
	capability.CallContract = func(_ context.Context, input *evm.CallContractRequest) (*evm.CallContractReply, error) {
		data := input.Call.Data
		switch {
		case len(data) >= 4 && string(data[:4]) == string(positionsSelector):
			addrType, _ := abi.NewType("address", "", nil)
			vals, err := (abi.Arguments{{Type: addrType}}).Unpack(data[4:])
			require.NoError(t, err)
			borrower := vals[0].(common.Address)
			if failing[borrower] {
				return nil, context.DeadlineExceeded
			}
			pos, ok := positions[borrower]
			if !ok {
				pos = position{collateral: big.NewInt(0), debt: big.NewInt(0)}
			}
			u256, _ := abi.NewType("uint256", "", nil)
			packed, err := (abi.Arguments{{Type: u256}, {Type: u256}}).Pack(pos.collateral, pos.debt)
			require.NoError(t, err)
			return &evm.CallContractReply{Data: packed}, nil
		case len(data) >= 4 && string(data[:4]) == string(thresholdSelector):
			calls++
			u256, _ := abi.NewType("uint256", "", nil)
			packed, err := (abi.Arguments{{Type: u256}}).Pack(thresholdBps)
			require.NoError(t, err)
			return &evm.CallContractReply{Data: packed}, nil
		default:
			t.Fatalf("unexpected CallContract data: %x", data)
			return nil, nil
		}
	}

	captured := &[]*evm.WriteReportRequest{}
	capability.WriteReport = func(_ context.Context, input *evm.WriteReportRequest) (*evm.WriteReportReply, error) {
		*captured = append(*captured, input)
		txHash := make([]byte, 32)
		txHash[31] = byte(len(*captured))
		return &evm.WriteReportReply{TxStatus: writeStatus, TxHash: txHash}, nil
	}
	return captured, &calls
}

// ─── Pure logic ────────────────────────────────────────────

func TestIsAdvised_RebalanceBand(t *testing.T) {
	price := big.NewInt(100_000_000_000)  // $1000.00000000, 8 decimals
	threshold := big.NewInt(8000)         // 80% liquidation threshold
	target := uint32(7000)                // advise above 70% LTV
	tenCollateral := weiAmount(10, 18)    // $10,000 worth

	t.Run("no debt is never advised", func(t *testing.T) {
		assert.False(t, isAdvised(tenCollateral, big.NewInt(0), price, 8, threshold, target))
	})
	t.Run("comfortable LTV is not advised", func(t *testing.T) {
		assert.False(t, isAdvised(tenCollateral, weiAmount(5000, 18), price, 8, threshold, target)) // 50%
	})
	t.Run("drifted above target is advised", func(t *testing.T) {
		assert.True(t, isAdvised(tenCollateral, weiAmount(7500, 18), price, 8, threshold, target)) // 75%
	})
	t.Run("exactly at target is not advised", func(t *testing.T) {
		assert.False(t, isAdvised(tenCollateral, weiAmount(7000, 18), price, 8, threshold, target)) // 70%
	})
	t.Run("undercollateralized is never advised", func(t *testing.T) {
		// 85% LTV is above threshold — liquidation-protection's verdict, not ours.
		assert.False(t, isAdvised(tenCollateral, weiAmount(8500, 18), price, 8, threshold, target))
	})
	t.Run("zero collateral value with debt is not advised", func(t *testing.T) {
		assert.False(t, isAdvised(big.NewInt(0), weiAmount(1, 18), price, 8, threshold, target))
	})
}

func TestEncodeRebalancingReportRoundTrips(t *testing.T) {
	encoded, err := encodeRebalancingReport(borrowerAddress, true, 1_700_000_000)
	require.NoError(t, err)

	args, err := rebalancingReportArgs()
	require.NoError(t, err)
	vals, err := args.Unpack(encoded)
	require.NoError(t, err)
	require.Len(t, vals, 3)

	assert.Equal(t, borrowerAddress, vals[0].(common.Address))
	assert.Equal(t, true, vals[1].(bool))
	assert.Equal(t, int64(1_700_000_000), vals[2].(*big.Int).Int64())
}

// ─── Handler ───────────────────────────────────────────────

func TestOnCronTrigger_InjectsEnclaveFetchedSecret(t *testing.T) {
	authHeaders := stubHTTP(t, 200, `{"data":{"price":"1000"}}`)
	stubEVM(t, map[common.Address]position{borrowerAddress: {weiAmount(10, 18), weiAmount(7500, 18)}}, big.NewInt(8000), evm.TxStatus_TX_STATUS_SUCCESS)
	runtime := testutils.NewTeeRuntime(t, testSecrets())

	_, err := onCronTrigger(testConfig(), runtime, nil)
	require.NoError(t, err)

	assert.Equal(t, []string{"Bearer " + apiToken}, *authHeaders)
}

func TestOnCronTrigger_SkipsWriteWhenNoConsumer(t *testing.T) {
	stubHTTP(t, 200, `{"data":{"price":"1000"}}`)
	stubEVM(t, map[common.Address]position{borrowerAddress: {weiAmount(10, 18), weiAmount(7500, 18)}}, big.NewInt(8000), evm.TxStatus_TX_STATUS_SUCCESS)
	runtime := testutils.NewTeeRuntime(t, testSecrets())

	result, err := onCronTrigger(testConfig(), runtime, nil)
	require.NoError(t, err)

	assert.Contains(t, result, "advised=true")
	assert.Contains(t, result, "no consumer configured")
}

func TestOnCronTrigger_WritesAdvisedTrueOnChain(t *testing.T) {
	stubHTTP(t, 200, `{"data":{"price":"1000"}}`)
	writes, thresholdCalls := stubEVM(t, map[common.Address]position{borrowerAddress: {weiAmount(10, 18), weiAmount(7500, 18)}}, big.NewInt(8000), evm.TxStatus_TX_STATUS_SUCCESS)
	runtime := testutils.NewTeeRuntime(t, testSecrets())

	result, err := onCronTrigger(configWithConsumer(), runtime, nil)
	require.NoError(t, err)
	require.Len(t, *writes, 1)
	assert.Equal(t, 1, *thresholdCalls, "liquidationThresholdBps must be read once per tick, not once per borrower")
	assert.Contains(t, result, "advised=true")

	args, err := rebalancingReportArgs()
	require.NoError(t, err)
	vals, err := args.Unpack((*writes)[0].Report.RawReport[cre.ReportMetadataHeaderLength:])
	require.NoError(t, err)
	assert.Equal(t, borrowerAddress, vals[0].(common.Address))
	assert.Equal(t, true, vals[1].(bool))
}

func TestOnCronTrigger_WritesAdvisedFalseForUndercollateralized(t *testing.T) {
	// 85% LTV: above the pool's 80% threshold — the liquidation band, not the
	// rebalance band. The verdict must be false so isAdvised reads back false.
	stubHTTP(t, 200, `{"data":{"price":"1000"}}`)
	writes, _ := stubEVM(t, map[common.Address]position{borrowerAddress: {weiAmount(10, 18), weiAmount(8500, 18)}}, big.NewInt(8000), evm.TxStatus_TX_STATUS_SUCCESS)
	runtime := testutils.NewTeeRuntime(t, testSecrets())

	result, err := onCronTrigger(configWithConsumer(), runtime, nil)
	require.NoError(t, err)
	require.Len(t, *writes, 1)
	assert.Contains(t, result, "advised=false")
}

func TestOnCronTrigger_WritesAdvisedFalseBelowTarget(t *testing.T) {
	stubHTTP(t, 200, `{"data":{"price":"1000"}}`)
	writes, _ := stubEVM(t, map[common.Address]position{borrowerAddress: {weiAmount(10, 18), weiAmount(5000, 18)}}, big.NewInt(8000), evm.TxStatus_TX_STATUS_SUCCESS)
	runtime := testutils.NewTeeRuntime(t, testSecrets())

	result, err := onCronTrigger(configWithConsumer(), runtime, nil)
	require.NoError(t, err)
	require.Len(t, *writes, 1)
	assert.Contains(t, result, "advised=false")
}

func TestOnCronTrigger_HealthyPositionWritesFalseEvenWithFreshTrueVerdict(t *testing.T) {
	// Mirrors liquidation-protection's healthy-position test: a position far
	// from the band must read advised=false regardless of any earlier true.
	stubHTTP(t, 200, `{"data":{"price":"1000"}}`)
	writes, _ := stubEVM(t, map[common.Address]position{borrowerAddress: {weiAmount(10, 18), weiAmount(1000, 18)}}, big.NewInt(8000), evm.TxStatus_TX_STATUS_SUCCESS)
	runtime := testutils.NewTeeRuntime(t, testSecrets())

	result, err := onCronTrigger(configWithConsumer(), runtime, nil)
	require.NoError(t, err)
	require.Len(t, *writes, 1)
	assert.Contains(t, result, "advised=false")
}

func TestOnCronTrigger_OneBorrowerFailureDoesNotAbortOthers(t *testing.T) {
	stubHTTP(t, 200, `{"data":{"price":"1000"}}`)
	writes, _ := stubEVM(t,
		map[common.Address]position{
			borrowerAddress:       {weiAmount(10, 18), weiAmount(7500, 18)},
			secondBorrowerAddress: {weiAmount(10, 18), weiAmount(5000, 18)},
		},
		big.NewInt(8000), evm.TxStatus_TX_STATUS_SUCCESS, secondBorrowerAddress)
	runtime := testutils.NewTeeRuntime(t, testSecrets())

	config := configWithConsumer()
	config.Borrowers = []string{borrowerAddress.Hex(), secondBorrowerAddress.Hex()}

	result, err := onCronTrigger(config, runtime, nil)
	require.NoError(t, err)
	assert.Contains(t, result, "1 advised, 1 written, 1 failed")
	require.Len(t, *writes, 1)
}

func TestOnCronTrigger_NoBorrowersIsSuccessfulNoOp(t *testing.T) {
	config := testConfig()
	config.Borrowers = nil
	runtime := testutils.NewTeeRuntime(t, testSecrets())

	result, err := onCronTrigger(config, runtime, nil)
	require.NoError(t, err)
	assert.Contains(t, result, "no borrowers configured")
}

func TestOnCronTrigger_RejectsInvalidBorrowerAddress(t *testing.T) {
	config := testConfig()
	config.Borrowers = []string{"not-an-address"}
	runtime := testutils.NewTeeRuntime(t, testSecrets())

	_, err := onCronTrigger(config, runtime, nil)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "not a valid address")
}

func TestOnCronTrigger_ErrorsOnNon2xx(t *testing.T) {
	stubHTTP(t, 401, "unauthorized")
	runtime := testutils.NewTeeRuntime(t, testSecrets())

	_, err := onCronTrigger(testConfig(), runtime, nil)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "status: 401")
}

// ─── Workflow Init ─────────────────────────────────────────

func TestInitWorkflow_RegistersTeeHandler(t *testing.T) {
	workflow, err := InitWorkflow(testConfig(), nil, nil)
	require.NoError(t, err)
	assert.Len(t, workflow, 1)
}

func TestInitWorkflow_RejectsOutOfRangeTargetBps(t *testing.T) {
	zero := testConfig()
	zero.RebalanceTargetBps = 0
	_, err := InitWorkflow(zero, nil, nil)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "rebalanceTargetBps")

	full := testConfig()
	full.RebalanceTargetBps = 10_000
	_, err = InitWorkflow(full, nil, nil)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "rebalanceTargetBps")
}
