package main

import (
	"context"
	"math/big"
	"strings"
	"testing"

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
	feedLabel        = "RWA/USD"
)

func testConfig() *Config {
	return &Config{
		Schedule:            "0 */5 * * * *",
		ChainSelectorName:   sepoliaChainName,
		PriceURL:            "https://example.com/prices/eth-usd",
		SecretID:            "LENDING_ORACLE_API_TOKEN",
		ResponsePricePath:   "data.amount",
		PriceDecimals:       8,
		CollateralFeedLabel: feedLabel,
		ConsumerAddress:     "0x0000000000000000000000000000000000000000",
		GasLimitWei:         500000,
	}
}

func configWithConsumer() *Config {
	config := testConfig()
	config.ConsumerAddress = consumerAddress
	return config
}

func testSecrets() testutils.Secrets {
	return testutils.Secrets{
		cre.DefaultSecretNamespace: {"LENDING_ORACLE_API_TOKEN": apiToken},
	}
}

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

func stubEVM(t *testing.T, writeStatus evm.TxStatus) **evm.WriteReportRequest {
	t.Helper()

	chainSelector, err := evm.ChainSelectorFromName(sepoliaChainName)
	require.NoError(t, err)

	capability, err := evmmock.NewClientCapability(chainSelector, t)
	require.NoError(t, err)

	captured := new(*evm.WriteReportRequest)
	capability.WriteReport = func(_ context.Context, input *evm.WriteReportRequest) (*evm.WriteReportReply, error) {
		*captured = input
		txHash := make([]byte, 32)
		txHash[31] = 0x7b
		return &evm.WriteReportReply{TxStatus: writeStatus, TxHash: txHash}, nil
	}
	return captured
}

// ─── Pure logic ────────────────────────────────────────────

func TestExtractNumber(t *testing.T) {
	t.Run("nested numeric string", func(t *testing.T) {
		r, err := extractNumber([]byte(`{"data":{"amount":"2737.62"}}`), "data.amount")
		require.NoError(t, err)
		assert.Equal(t, "136881/50", r.RatString())
	})
	t.Run("missing key", func(t *testing.T) {
		_, err := extractNumber([]byte(`{"data":{}}`), "data.amount")
		require.Error(t, err)
	})
}

func TestQuantize(t *testing.T) {
	got, err := quantize(big.NewRat(273762, 100), 8) // 2737.62
	require.NoError(t, err)
	assert.Equal(t, "273762000000", got.String())
}

func TestFeedIdFor_MatchesConsumerConvention(t *testing.T) {
	// LendingOracleConsumer.feedIdFor(label) == keccak256(bytes(label)).
	// Pinned against the actual on-chain feedId LendingPool was deployed
	// with (default COLLATERAL_FEED_LABEL "RWA/USD") so a change here can't
	// silently drift from what LendingPool actually reads.
	id := feedIdFor("RWA/USD")
	assert.Equal(t, "29813ec3c22b3cf215a705311de0f162e36bdb1053984d1f488c68d186ad2d04", common.Bytes2Hex(id[:]))
}

func TestEncodeLendingOracleReportRoundTrips(t *testing.T) {
	feedId := feedIdFor(feedLabel)
	encoded, err := encodeLendingOracleReport(feedId, big.NewInt(273762000000), 8, 1_700_000_000)
	require.NoError(t, err)

	args, err := lendingOracleReportArgs()
	require.NoError(t, err)
	vals, err := args.Unpack(encoded)
	require.NoError(t, err)
	require.Len(t, vals, 4)

	assert.Equal(t, feedId, vals[0].([32]byte))
	assert.Equal(t, "273762000000", vals[1].(*big.Int).String())
	assert.Equal(t, uint8(8), vals[2].(uint8))
	assert.Equal(t, int64(1_700_000_000), vals[3].(*big.Int).Int64())
}

// ─── Handler ───────────────────────────────────────────────

func TestOnCronTrigger_InjectsEnclaveFetchedSecret(t *testing.T) {
	authHeaders := stubHTTP(t, 200, `{"data":{"amount":"2737.62"}}`)
	stubEVM(t, evm.TxStatus_TX_STATUS_SUCCESS)
	runtime := testutils.NewTeeRuntime(t, testSecrets())

	_, err := onCronTrigger(testConfig(), runtime, nil)
	require.NoError(t, err)

	assert.Equal(t, []string{"Bearer " + apiToken}, *authHeaders)
}

func TestOnCronTrigger_SkipsWriteWhenNoConsumer(t *testing.T) {
	stubHTTP(t, 200, `{"data":{"amount":"2737.62"}}`)
	stubEVM(t, evm.TxStatus_TX_STATUS_SUCCESS)
	runtime := testutils.NewTeeRuntime(t, testSecrets())

	result, err := onCronTrigger(testConfig(), runtime, nil)
	require.NoError(t, err)
	assert.Contains(t, result, "no consumer configured")
}

func TestOnCronTrigger_WritesReportOnChain(t *testing.T) {
	stubHTTP(t, 200, `{"data":{"amount":"2737.62"}}`)
	captured := stubEVM(t, evm.TxStatus_TX_STATUS_SUCCESS)
	runtime := testutils.NewTeeRuntime(t, testSecrets())

	result, err := onCronTrigger(configWithConsumer(), runtime, nil)
	require.NoError(t, err)
	require.NotNil(t, *captured)

	assert.Equal(t, common.HexToAddress(consumerAddress).Bytes(), (*captured).Receiver)
	assert.Contains(t, result, "273762000000")
	assert.Contains(t, result, "tx")

	args, err := lendingOracleReportArgs()
	require.NoError(t, err)
	vals, err := args.Unpack((*captured).Report.RawReport[cre.ReportMetadataHeaderLength:])
	require.NoError(t, err)
	assert.Equal(t, feedIdFor(feedLabel), vals[0].([32]byte))
	assert.Equal(t, "273762000000", vals[1].(*big.Int).String())
}

func TestOnCronTrigger_ErrorsWhenWriteReverts(t *testing.T) {
	stubHTTP(t, 200, `{"data":{"amount":"2737.62"}}`)
	stubEVM(t, evm.TxStatus_TX_STATUS_REVERTED)
	runtime := testutils.NewTeeRuntime(t, testSecrets())

	_, err := onCronTrigger(configWithConsumer(), runtime, nil)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "not successful")
}

func TestOnCronTrigger_ErrorsOnNon2xx(t *testing.T) {
	stubHTTP(t, 503, "service unavailable")
	runtime := testutils.NewTeeRuntime(t, testSecrets())

	_, err := onCronTrigger(testConfig(), runtime, nil)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "status: 503")
}

func TestOnCronTrigger_ErrorsOnMissingFeedLabel(t *testing.T) {
	config := testConfig()
	config.CollateralFeedLabel = ""
	runtime := testutils.NewTeeRuntime(t, testSecrets())

	_, err := onCronTrigger(config, runtime, nil)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "collateralFeedLabel")
}

func TestOnCronTrigger_DoesNotLogSecretOrResponseBody(t *testing.T) {
	const sensitivePrice = "2737.65432"
	stubHTTP(t, 200, `{"data":{"amount":"`+sensitivePrice+`"}}`)
	stubEVM(t, evm.TxStatus_TX_STATUS_SUCCESS)
	runtime := testutils.NewTeeRuntime(t, testSecrets())

	_, err := onCronTrigger(testConfig(), runtime, nil)
	require.NoError(t, err)

	for _, raw := range runtime.GetLogs() {
		line := string(raw)
		assert.False(t, strings.Contains(line, apiToken), "log leaked the secret: %s", line)
	}
}

func TestInitWorkflow_RegistersTeeHandler(t *testing.T) {
	workflow, err := InitWorkflow(testConfig(), nil, nil)
	require.NoError(t, err)
	assert.Len(t, workflow, 1)
}
