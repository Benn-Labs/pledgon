package main

import (
	"context"
	"math/big"
	"strings"
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
	apiToken         = "test-price-provider-token"
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
		Schedule:           "0 */5 * * * *",
		ChainSelectorName:  sepoliaChainName,
		LendingPoolAddress: poolAddress,
		Borrowers:          []string{borrowerAddress.Hex()},
		VerificationURL:    "https://example.com/price/collateral",
		SecretID:           "LENDING_PRICE_API_TOKEN",
		ResponsePricePath:  "data.price",
		PriceDecimals:      8,
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
		cre.DefaultSecretNamespace: {"LENDING_PRICE_API_TOKEN": apiToken},
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
// from the given map (unlisted borrowers read as zero/zero) and
// liquidationThresholdBps() once for the whole pool. Returns every
// WriteReport call made, plus how many times the threshold was read (should
// be exactly once per tick, never once per borrower) and how many times
// positions() failed borrowers were hit.
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

func TestExtractNumber(t *testing.T) {
	t.Run("nested numeric string", func(t *testing.T) {
		r, err := extractNumber([]byte(`{"data":{"price":"1000.50"}}`), "data.price")
		require.NoError(t, err)
		assert.Equal(t, "2001/2", r.RatString())
	})
	t.Run("missing key", func(t *testing.T) {
		_, err := extractNumber([]byte(`{"data":{}}`), "data.price")
		require.Error(t, err)
	})
}

func TestQuantize(t *testing.T) {
	got, err := quantize(big.NewRat(100050, 100), 8) // 1000.50
	require.NoError(t, err)
	assert.Equal(t, "100050000000", got.String())
}

func TestIsUndercollateralized(t *testing.T) {
	price := big.NewInt(100_000_000_000) // $1000.00000000, 8 decimals
	thresholdBps := big.NewInt(8000)     // 80%

	t.Run("safe within threshold", func(t *testing.T) {
		collateral := weiAmount(10, 18) // $10,000 worth
		debt := weiAmount(7000, 18)
		assert.False(t, isUndercollateralized(collateral, debt, price, 8, thresholdBps))
	})
	t.Run("undercollateralized beyond threshold", func(t *testing.T) {
		collateral := weiAmount(10, 18) // $10,000 worth, 80% = $8,000 max debt
		debt := weiAmount(9000, 18)
		assert.True(t, isUndercollateralized(collateral, debt, price, 8, thresholdBps))
	})
	t.Run("no debt is never eligible", func(t *testing.T) {
		assert.False(t, isUndercollateralized(big.NewInt(0), big.NewInt(0), price, 8, thresholdBps))
	})
}

func TestSourcesDisagree(t *testing.T) {
	onchain := big.NewInt(100_000_000_000) // $1000, 8 decimals

	t.Run("identical prices agree", func(t *testing.T) {
		assert.False(t, sourcesDisagree(new(big.Int).Set(onchain), onchain, 500))
	})
	t.Run("small deviation agrees", func(t *testing.T) {
		within := big.NewInt(101_000_000_000) // +1%
		assert.False(t, sourcesDisagree(within, onchain, 500))
	})
	t.Run("large deviation disagrees", func(t *testing.T) {
		far := big.NewInt(110_000_000_000) // +10%
		assert.True(t, sourcesDisagree(far, onchain, 500))
	})
	t.Run("zero onchain value disagrees with any positive price", func(t *testing.T) {
		assert.True(t, sourcesDisagree(big.NewInt(1), big.NewInt(0), 500))
		assert.False(t, sourcesDisagree(big.NewInt(0), big.NewInt(0), 500))
	})
	t.Run("independent price crash disagrees", func(t *testing.T) {
		crashed := big.NewInt(10_000_000_000) // -90%
		assert.True(t, sourcesDisagree(crashed, onchain, 500))
	})
}

// stubEVMWithFeed extends stubEVM with the three reads the cross-source
// deviation check performs: pool.collateralFeedId(), pool.oracleConsumer()
// and oracleConsumer.latestRound(feedId). Existing tests keep using stubEVM,
// whose fatal-on-unknown-call default proves the deviation check never
// touches the feed when it is disabled.
func stubEVMWithFeed(
	t *testing.T,
	positions map[common.Address]position,
	thresholdBps *big.Int,
	feedValue *big.Int,
	feedDecimals uint8,
	feedUpdatedAt *big.Int,
	writeStatus evm.TxStatus,
) (writes *[]*evm.WriteReportRequest, feedReads *int) {
	t.Helper()

	chainSelector, err := evm.ChainSelectorFromName(sepoliaChainName)
	require.NoError(t, err)

	capability, err := evmmock.NewClientCapability(chainSelector, t)
	require.NoError(t, err)

	positionsSelector := selector("positions(address)")
	thresholdSelector := selector("liquidationThresholdBps()")
	feedIdSelector := selector("collateralFeedId()")
	consumerSelector := selector("oracleConsumer()")
	latestSelector := selector("latestRound(bytes32)")

	reads := 0
	capability.CallContract = func(_ context.Context, input *evm.CallContractRequest) (*evm.CallContractReply, error) {
		data := input.Call.Data
		switch {
		case len(data) >= 4 && string(data[:4]) == string(positionsSelector):
			addrType, _ := abi.NewType("address", "", nil)
			vals, err := (abi.Arguments{{Type: addrType}}).Unpack(data[4:])
			require.NoError(t, err)
			borrower := vals[0].(common.Address)
			pos, ok := positions[borrower]
			if !ok {
				pos = position{collateral: big.NewInt(0), debt: big.NewInt(0)}
			}
			u256, _ := abi.NewType("uint256", "", nil)
			packed, err := (abi.Arguments{{Type: u256}, {Type: u256}}).Pack(pos.collateral, pos.debt)
			require.NoError(t, err)
			return &evm.CallContractReply{Data: packed}, nil
		case len(data) >= 4 && string(data[:4]) == string(thresholdSelector):
			u256, _ := abi.NewType("uint256", "", nil)
			packed, err := (abi.Arguments{{Type: u256}}).Pack(thresholdBps)
			require.NoError(t, err)
			return &evm.CallContractReply{Data: packed}, nil
		case len(data) >= 4 && string(data[:4]) == string(feedIdSelector):
			bytes32Type, _ := abi.NewType("bytes32", "", nil)
			packed, err := (abi.Arguments{{Type: bytes32Type}}).Pack([32]byte{1, 2, 3})
			require.NoError(t, err)
			return &evm.CallContractReply{Data: packed}, nil
		case len(data) >= 4 && string(data[:4]) == string(consumerSelector):
			addrType, _ := abi.NewType("address", "", nil)
			packed, err := (abi.Arguments{{Type: addrType}}).Pack(common.HexToAddress("0x00000000000000000000000000000000C011A7E0"))
			require.NoError(t, err)
			return &evm.CallContractReply{Data: packed}, nil
		case len(data) >= 4 && string(data[:4]) == string(latestSelector):
			reads++
			u256Type, _ := abi.NewType("uint256", "", nil)
			u8Type, _ := abi.NewType("uint8", "", nil)
			packed, err := (abi.Arguments{{Type: u256Type}, {Type: u8Type}, {Type: u256Type}}).Pack(feedValue, feedDecimals, feedUpdatedAt)
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
	return captured, &reads
}

func configWithDeviation(maxBps uint32) *Config {
	config := configWithConsumer()
	config.MaxSourceDeviationBps = maxBps
	return config
}

func TestOnCronTrigger_SourceDeviationWithinBound_Attests(t *testing.T) {
	// Both sources at $1000.00000000 (8 decimals) — zero deviation.
	stubHTTP(t, 200, `{"data":{"price":"1000"}}`)
	writes, feedReads := stubEVMWithFeed(t,
		map[common.Address]position{borrowerAddress: {weiAmount(10, 18), weiAmount(9000, 18)}},
		big.NewInt(8000), big.NewInt(100_000_000_000), 8, big.NewInt(1_700_000_000),
		evm.TxStatus_TX_STATUS_SUCCESS)
	runtime := testutils.NewTeeRuntime(t, testSecrets())

	result, err := onCronTrigger(configWithDeviation(500), runtime, nil)
	require.NoError(t, err)
	assert.Equal(t, 1, *feedReads, "feed round must be read exactly once per tick")
	require.Len(t, *writes, 1)
	assert.Contains(t, result, "eligible=true")
}

func TestOnCronTrigger_SourceDeviationBeyondBound_SkipsAttestation(t *testing.T) {
	// Independent source says $5000, on-chain feed says $1000: a 400%
	// divergence. Neither an eligible=true nor an eligible=false verdict may
	// be written — the DON can't tell which source is lying.
	stubHTTP(t, 200, `{"data":{"price":"5000"}}`)
	writes, _ := stubEVMWithFeed(t,
		map[common.Address]position{borrowerAddress: {weiAmount(10, 18), weiAmount(9000, 18)}},
		big.NewInt(8000), big.NewInt(100_000_000_000), 8, big.NewInt(1_700_000_000),
		evm.TxStatus_TX_STATUS_SUCCESS)
	runtime := testutils.NewTeeRuntime(t, testSecrets())

	result, err := onCronTrigger(configWithDeviation(500), runtime, nil)
	require.NoError(t, err)
	assert.Contains(t, result, "skipped")
	assert.Contains(t, result, "diverge beyond 500 bps")
	assert.Len(t, *writes, 0, "no verdict of either kind may be written while sources disagree")
}

func TestOnCronTrigger_UnseededOnChainFeed_SkipsAttestation(t *testing.T) {
	stubHTTP(t, 200, `{"data":{"price":"1000"}}`)
	writes, _ := stubEVMWithFeed(t,
		map[common.Address]position{borrowerAddress: {weiAmount(10, 18), weiAmount(9000, 18)}},
		big.NewInt(8000), big.NewInt(0), 8, big.NewInt(0), // updatedAt 0 = no round stored
		evm.TxStatus_TX_STATUS_SUCCESS)
	runtime := testutils.NewTeeRuntime(t, testSecrets())

	result, err := onCronTrigger(configWithDeviation(500), runtime, nil)
	require.NoError(t, err)
	assert.Contains(t, result, "unseeded feed")
	assert.Len(t, *writes, 0)
}

func TestOnCronTrigger_DecimalsMismatch_SkipsAttestation(t *testing.T) {
	stubHTTP(t, 200, `{"data":{"price":"1000"}}`)
	// On-chain feed reports 6 decimals while the independent source is
	// configured for 8 — the two values aren't comparable.
	writes, _ := stubEVMWithFeed(t,
		map[common.Address]position{borrowerAddress: {weiAmount(10, 18), weiAmount(9000, 18)}},
		big.NewInt(8000), big.NewInt(1_000_000), 6, big.NewInt(1_700_000_000),
		evm.TxStatus_TX_STATUS_SUCCESS)
	runtime := testutils.NewTeeRuntime(t, testSecrets())

	result, err := onCronTrigger(configWithDeviation(500), runtime, nil)
	require.NoError(t, err)
	assert.Contains(t, result, "decimals mismatch")
	assert.Len(t, *writes, 0)
}

func TestEncodeLiquidationReportRoundTrips(t *testing.T) {
	encoded, err := encodeLiquidationReport(borrowerAddress, true, 1_700_000_000)
	require.NoError(t, err)

	args, err := liquidationReportArgs()
	require.NoError(t, err)
	vals, err := args.Unpack(encoded)
	require.NoError(t, err)
	require.Len(t, vals, 3)

	assert.Equal(t, borrowerAddress, vals[0].(common.Address))
	assert.Equal(t, true, vals[1].(bool))
	assert.Equal(t, int64(1_700_000_000), vals[2].(*big.Int).Int64())
}

func TestPositionsCallRoundTrips(t *testing.T) {
	calldata, err := encodePositionsCall(borrowerAddress)
	require.NoError(t, err)
	assert.Equal(t, selector("positions(address)"), calldata[:4])

	u256, _ := abi.NewType("uint256", "", nil)
	packed, err := (abi.Arguments{{Type: u256}, {Type: u256}}).Pack(big.NewInt(10), big.NewInt(20))
	require.NoError(t, err)

	collateral, debt, err := decodePositionsReply(packed)
	require.NoError(t, err)
	assert.Equal(t, int64(10), collateral.Int64())
	assert.Equal(t, int64(20), debt.Int64())
}

// ─── Handler ───────────────────────────────────────────────

func TestOnCronTrigger_InjectsEnclaveFetchedSecret(t *testing.T) {
	authHeaders := stubHTTP(t, 200, `{"data":{"price":"1000"}}`)
	stubEVM(t, map[common.Address]position{borrowerAddress: {weiAmount(10, 18), weiAmount(1000, 18)}}, big.NewInt(8000), evm.TxStatus_TX_STATUS_SUCCESS)
	runtime := testutils.NewTeeRuntime(t, testSecrets())

	_, err := onCronTrigger(testConfig(), runtime, nil)
	require.NoError(t, err)

	assert.Equal(t, []string{"Bearer " + apiToken}, *authHeaders)
}

func TestOnCronTrigger_SkipsWriteWhenNoConsumer(t *testing.T) {
	stubHTTP(t, 200, `{"data":{"price":"1000"}}`)
	stubEVM(t, map[common.Address]position{borrowerAddress: {weiAmount(10, 18), weiAmount(1000, 18)}}, big.NewInt(8000), evm.TxStatus_TX_STATUS_SUCCESS)
	runtime := testutils.NewTeeRuntime(t, testSecrets())

	result, err := onCronTrigger(testConfig(), runtime, nil)
	require.NoError(t, err)

	assert.Contains(t, result, "eligible=false")
	assert.Contains(t, result, "no consumer configured")
}

func TestOnCronTrigger_WritesEligibleTrueOnChain(t *testing.T) {
	stubHTTP(t, 200, `{"data":{"price":"100"}}`) // $100/token independent price -> way undercollateralized
	writes, _ := stubEVM(t, map[common.Address]position{borrowerAddress: {weiAmount(10, 18), weiAmount(1000, 18)}}, big.NewInt(8000), evm.TxStatus_TX_STATUS_SUCCESS)
	runtime := testutils.NewTeeRuntime(t, testSecrets())

	result, err := onCronTrigger(configWithConsumer(), runtime, nil)
	require.NoError(t, err)
	require.Len(t, *writes, 1)

	assert.Equal(t, common.HexToAddress(consumerAddress).Bytes(), (*writes)[0].Receiver)
	assert.Contains(t, result, "eligible=true, tx")

	args, err := liquidationReportArgs()
	require.NoError(t, err)
	vals, err := args.Unpack((*writes)[0].Report.RawReport[cre.ReportMetadataHeaderLength:])
	require.NoError(t, err)
	assert.Equal(t, borrowerAddress, vals[0].(common.Address))
	assert.Equal(t, true, vals[1].(bool))
}

// A safe verdict (eligible:false) must still be written on-chain — same
// asymmetry as compliance-check: it overwrites a stale earlier true, since a
// borrower can add collateral or repay and become safe again.
func TestOnCronTrigger_WritesEligibleFalseOnChainToo(t *testing.T) {
	stubHTTP(t, 200, `{"data":{"price":"1000"}}`) // healthy price -> safe
	writes, _ := stubEVM(t, map[common.Address]position{borrowerAddress: {weiAmount(10, 18), weiAmount(1000, 18)}}, big.NewInt(8000), evm.TxStatus_TX_STATUS_SUCCESS)
	runtime := testutils.NewTeeRuntime(t, testSecrets())

	result, err := onCronTrigger(configWithConsumer(), runtime, nil)
	require.NoError(t, err)
	require.Len(t, *writes, 1, "a safe verdict must still be written on-chain")
	assert.Contains(t, result, "eligible=false, tx")

	args, err := liquidationReportArgs()
	require.NoError(t, err)
	vals, err := args.Unpack((*writes)[0].Report.RawReport[cre.ReportMetadataHeaderLength:])
	require.NoError(t, err)
	assert.Equal(t, false, vals[1].(bool))
}

func TestOnCronTrigger_ErrorsWhenWriteReverts(t *testing.T) {
	stubHTTP(t, 200, `{"data":{"price":"100"}}`)
	stubEVM(t, map[common.Address]position{borrowerAddress: {weiAmount(10, 18), weiAmount(1000, 18)}}, big.NewInt(8000), evm.TxStatus_TX_STATUS_REVERTED)
	runtime := testutils.NewTeeRuntime(t, testSecrets())

	_, err := onCronTrigger(configWithConsumer(), runtime, nil)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "failed")
}

func TestOnCronTrigger_ErrorsOnNon2xx(t *testing.T) {
	stubHTTP(t, 401, "unauthorized")
	runtime := testutils.NewTeeRuntime(t, testSecrets())

	_, err := onCronTrigger(testConfig(), runtime, nil)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "status: 401")
}

func TestOnCronTrigger_ErrorsOnInvalidBorrower(t *testing.T) {
	config := testConfig()
	config.Borrowers = []string{"not-an-address"}
	runtime := testutils.NewTeeRuntime(t, testSecrets())

	_, err := onCronTrigger(config, runtime, nil)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "not a valid address")
}

// An empty close-watch tier is a normal outcome of cmd/discover-borrowers'
// LTV-based classification (nobody's currently near the threshold) — not a
// misconfiguration, so this must succeed, not error.
func TestOnCronTrigger_EmptyBorrowersSucceedsAsNoOp(t *testing.T) {
	config := testConfig()
	config.Borrowers = nil
	runtime := testutils.NewTeeRuntime(t, testSecrets())

	result, err := onCronTrigger(config, runtime, nil)
	require.NoError(t, err)
	assert.Contains(t, result, "no borrowers configured")
}

func TestOnCronTrigger_DoesNotLogSecretOrResponseBody(t *testing.T) {
	const sensitivePrice = "1234.56789"
	stubHTTP(t, 200, `{"data":{"price":"`+sensitivePrice+`"}}`)
	stubEVM(t, map[common.Address]position{borrowerAddress: {weiAmount(10, 18), weiAmount(1000, 18)}}, big.NewInt(8000), evm.TxStatus_TX_STATUS_SUCCESS)
	runtime := testutils.NewTeeRuntime(t, testSecrets())

	_, err := onCronTrigger(testConfig(), runtime, nil)
	require.NoError(t, err)

	for _, raw := range runtime.GetLogs() {
		line := string(raw)
		assert.False(t, strings.Contains(line, apiToken), "log leaked the secret: %s", line)
		assert.False(t, strings.Contains(line, sensitivePrice), "log leaked the raw price response: %s", line)
	}
}

// ─── Multi-borrower ──────────────────────────────────────────

func TestOnCronTrigger_MultipleBorrowers_MixedEligibility(t *testing.T) {
	stubHTTP(t, 200, `{"data":{"price":"100"}}`) // $100/token
	positions := map[common.Address]position{
		borrowerAddress:       {weiAmount(10, 18), weiAmount(1000, 18)}, // $1000 worth of collateral, $1000 debt -> undercollateralized
		secondBorrowerAddress: {weiAmount(100, 18), weiAmount(100, 18)}, // $10,000 worth of collateral, $100 debt -> safe
	}
	writes, _ := stubEVM(t, positions, big.NewInt(8000), evm.TxStatus_TX_STATUS_SUCCESS)
	runtime := testutils.NewTeeRuntime(t, testSecrets())

	config := configWithConsumer()
	config.Borrowers = []string{borrowerAddress.Hex(), secondBorrowerAddress.Hex()}

	result, err := onCronTrigger(config, runtime, nil)
	require.NoError(t, err)
	require.Len(t, *writes, 2)

	assert.Contains(t, result, "checked 2 borrower(s): 1 eligible, 2 written, 0 failed")

	args, err := liquidationReportArgs()
	require.NoError(t, err)

	firstVals, err := args.Unpack((*writes)[0].Report.RawReport[cre.ReportMetadataHeaderLength:])
	require.NoError(t, err)
	assert.Equal(t, borrowerAddress, firstVals[0].(common.Address))
	assert.Equal(t, true, firstVals[1].(bool))

	secondVals, err := args.Unpack((*writes)[1].Report.RawReport[cre.ReportMetadataHeaderLength:])
	require.NoError(t, err)
	assert.Equal(t, secondBorrowerAddress, secondVals[0].(common.Address))
	assert.Equal(t, false, secondVals[1].(bool))
}

func TestOnCronTrigger_ReadsThresholdOnceRegardlessOfBorrowerCount(t *testing.T) {
	thirdBorrower := common.HexToAddress("0x0000000000000000000000000000000000C0FFE")
	stubHTTP(t, 200, `{"data":{"price":"1000"}}`)
	positions := map[common.Address]position{
		borrowerAddress:       {weiAmount(10, 18), weiAmount(100, 18)},
		secondBorrowerAddress: {weiAmount(10, 18), weiAmount(100, 18)},
		thirdBorrower:         {weiAmount(10, 18), weiAmount(100, 18)},
	}
	_, thresholdCalls := stubEVM(t, positions, big.NewInt(8000), evm.TxStatus_TX_STATUS_SUCCESS)
	runtime := testutils.NewTeeRuntime(t, testSecrets())

	config := configWithConsumer()
	config.Borrowers = []string{borrowerAddress.Hex(), secondBorrowerAddress.Hex(), thirdBorrower.Hex()}

	_, err := onCronTrigger(config, runtime, nil)
	require.NoError(t, err)
	assert.Equal(t, 1, *thresholdCalls, "liquidationThresholdBps() must be read once per tick, not once per borrower")
}

func TestOnCronTrigger_OneBorrowerFailingDoesNotAbortOthers(t *testing.T) {
	stubHTTP(t, 200, `{"data":{"price":"1000"}}`)
	positions := map[common.Address]position{
		secondBorrowerAddress: {weiAmount(10, 18), weiAmount(100, 18)},
	}
	writes, _ := stubEVM(t, positions, big.NewInt(8000), evm.TxStatus_TX_STATUS_SUCCESS, borrowerAddress)
	runtime := testutils.NewTeeRuntime(t, testSecrets())

	config := configWithConsumer()
	config.Borrowers = []string{borrowerAddress.Hex(), secondBorrowerAddress.Hex()}

	result, err := onCronTrigger(config, runtime, nil)
	require.NoError(t, err, "one borrower's read failure must not fail the whole tick when others succeed")
	require.Len(t, *writes, 1)
	assert.Contains(t, result, "checked 2 borrower(s): 0 eligible, 1 written, 1 failed")
}

func TestInitWorkflow_RegistersTeeHandler(t *testing.T) {
	workflow, err := InitWorkflow(testConfig(), nil, nil)
	require.NoError(t, err)
	assert.Len(t, workflow, 1)
}
