package main

import (
	"context"
	"math/big"
	"strings"
	"testing"

	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/crypto"
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
	apiToken         = "test-verification-token"
	sepoliaChainName = "ethereum-testnet-sepolia"
	consumerAddress  = "0x00000000000000000000000000000000000CAFE"
)

var (
	vaultAddress = common.HexToAddress("0x000000000000000000000000000000000BEEF0")
)

func testConfig() *Config {
	return &Config{
		ChainSelectorName:           sepoliaChainName,
		VaultAddresses:              []string{vaultAddress.Hex()},
		VerificationURL:             "https://example.com/verify",
		SecretID:                    "VERIFICATION_API_TOKEN",
		ResponseConfirmedPath:       "verified",
		ConfirmationConsumerAddress: "0x0000000000000000000000000000000000000000",
		GasLimitWei:                 500000,
	}
}

func configWithConsumer() *Config {
	config := testConfig()
	config.ConfirmationConsumerAddress = consumerAddress
	return config
}

func testSecrets() testutils.Secrets {
	return testutils.Secrets{
		cre.DefaultSecretNamespace: {"VERIFICATION_API_TOKEN": apiToken},
	}
}

// docsSubmittedLog builds an evm.Log matching EscrowVault's
// DocsSubmitted(uint256 indexed milestoneIndex, bytes32 docHash) event, as the
// KeystoneForwarder's log trigger would deliver it.
func docsSubmittedLog(t *testing.T, vault common.Address, milestoneIndex uint64, docHash [32]byte) *evm.Log {
	t.Helper()
	sig := crypto.Keccak256Hash([]byte(docsSubmittedSignature))
	topic1 := common.LeftPadBytes(new(big.Int).SetUint64(milestoneIndex).Bytes(), 32)
	return &evm.Log{
		Address: vault.Bytes(),
		Topics:  [][]byte{sig.Bytes(), topic1},
		Data:    docHash[:],
	}
}

// stubHTTP registers an in-enclave HTTP stub and records the request URL and
// Authorization header values it was called with.
func stubHTTP(t *testing.T, statusCode uint32, body string) (urls *[]string, authHeaders *[]string) {
	t.Helper()

	capability, err := httpmock.NewClientCapability(t)
	require.NoError(t, err)

	urls = &[]string{}
	authHeaders = &[]string{}
	capability.SendRequest = func(_ context.Context, input *http.Request) (*http.Response, error) {
		*urls = append(*urls, input.Url)
		if auth := input.MultiHeaders["Authorization"]; auth != nil {
			*authHeaders = append(*authHeaders, auth.Values...)
		}
		return &http.Response{StatusCode: statusCode, Body: []byte(body)}, nil
	}
	return urls, authHeaders
}

// stubEVMWrite registers the EVM capability and records the write request.
func stubEVMWrite(t *testing.T, status evm.TxStatus) **evm.WriteReportRequest {
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
		return &evm.WriteReportReply{TxStatus: status, TxHash: txHash}, nil
	}
	return captured
}

// ─── Pure logic ────────────────────────────────────────────

func TestDecodeDocsSubmitted(t *testing.T) {
	t.Run("valid log", func(t *testing.T) {
		docHash := crypto.Keccak256Hash([]byte("deed-transfer.pdf"))
		log := docsSubmittedLog(t, vaultAddress, 3, docHash)

		index, hash, err := decodeDocsSubmitted(log)
		require.NoError(t, err)
		assert.Equal(t, uint64(3), index.Uint64())
		assert.Equal(t, docHash, common.Hash(hash))
	})

	t.Run("too few topics", func(t *testing.T) {
		_, _, err := decodeDocsSubmitted(&evm.Log{Topics: [][]byte{{0x01}}})
		require.Error(t, err)
		assert.Contains(t, err.Error(), "topics")
	})

	t.Run("wrong event signature", func(t *testing.T) {
		wrongSig := crypto.Keccak256Hash([]byte("SomethingElse(uint256)"))
		log := &evm.Log{
			Topics: [][]byte{wrongSig.Bytes(), common.LeftPadBytes([]byte{1}, 32)},
			Data:   make([]byte, 32),
		}
		_, _, err := decodeDocsSubmitted(log)
		require.Error(t, err)
		assert.Contains(t, err.Error(), "does not match DocsSubmitted")
	})

	t.Run("data too short for docHash", func(t *testing.T) {
		sig := crypto.Keccak256Hash([]byte(docsSubmittedSignature))
		log := &evm.Log{
			Topics: [][]byte{sig.Bytes(), common.LeftPadBytes([]byte{1}, 32)},
			Data:   []byte{0x01},
		}
		_, _, err := decodeDocsSubmitted(log)
		require.Error(t, err)
		assert.Contains(t, err.Error(), "docHash")
	})
}

func TestBuildVerificationURL(t *testing.T) {
	docHash := crypto.Keccak256Hash([]byte("deed-transfer.pdf"))
	got, err := buildVerificationURL("https://example.com/verify", vaultAddress, big.NewInt(7), docHash)
	require.NoError(t, err)

	assert.Contains(t, got, "vault="+vaultAddress.Hex())
	assert.Contains(t, got, "milestoneIndex=7")
	assert.Contains(t, got, "docHash=0x"+common.Bytes2Hex(docHash[:]))
}

func TestBuildIotDeliveryURL(t *testing.T) {
	docHash := crypto.Keccak256Hash([]byte("bill-of-lading.pdf"))
	got, err := buildIotDeliveryURL("https://iot.example.com/v1/shipments/delivery", "SHP-12345", vaultAddress, big.NewInt(2), docHash)
	require.NoError(t, err)

	assert.Contains(t, got, "shipmentId=SHP-12345")
	assert.Contains(t, got, "vault="+vaultAddress.Hex())
	assert.Contains(t, got, "milestoneIndex=2")
	assert.Contains(t, got, "docHash=0x"+common.Bytes2Hex(docHash[:]))
}

func TestValidateBulkDeliveryIoT(t *testing.T) {
	valid := &BulkDeliveryIoT{
		ProviderURL:           "https://iot.example.com/v1/shipments/delivery",
		SecretID:              "IOT_PROVIDER_TOKEN",
		ResponseDeliveredPath: "delivered",
		Shipments:             map[string]string{vaultAddress.Hex(): "SHP-1"},
	}

	t.Run("nil is valid (IoT leg disabled)", func(t *testing.T) {
		require.NoError(t, validateBulkDeliveryIoT(nil))
	})
	t.Run("valid config passes", func(t *testing.T) {
		require.NoError(t, validateBulkDeliveryIoT(valid))
	})
	t.Run("missing provider URL", func(t *testing.T) {
		c := *valid
		c.ProviderURL = ""
		require.ErrorContains(t, validateBulkDeliveryIoT(&c), "providerUrl")
	})
	t.Run("missing secret id", func(t *testing.T) {
		c := *valid
		c.SecretID = ""
		require.ErrorContains(t, validateBulkDeliveryIoT(&c), "iotSecretId")
	})
	t.Run("missing response path", func(t *testing.T) {
		c := *valid
		c.ResponseDeliveredPath = ""
		require.ErrorContains(t, validateBulkDeliveryIoT(&c), "responseDeliveredPath")
	})
	t.Run("no shipments", func(t *testing.T) {
		c := *valid
		c.Shipments = map[string]string{}
		require.ErrorContains(t, validateBulkDeliveryIoT(&c), "shipments")
	})
	t.Run("invalid vault address", func(t *testing.T) {
		c := *valid
		c.Shipments = map[string]string{"not-an-address": "SHP-1"}
		require.ErrorContains(t, validateBulkDeliveryIoT(&c), "not a valid vault address")
	})
	t.Run("empty shipment id", func(t *testing.T) {
		c := *valid
		c.Shipments = map[string]string{vaultAddress.Hex(): ""}
		require.ErrorContains(t, validateBulkDeliveryIoT(&c), "shipment id is empty")
	})
}

func TestExtractBool(t *testing.T) {
	t.Run("top-level bool", func(t *testing.T) {
		b, err := extractBool([]byte(`{"verified": true}`), "verified")
		require.NoError(t, err)
		assert.True(t, b)
	})
	t.Run("nested bool", func(t *testing.T) {
		b, err := extractBool([]byte(`{"data":{"verified": false}}`), "data.verified")
		require.NoError(t, err)
		assert.False(t, b)
	})
	t.Run("missing key", func(t *testing.T) {
		_, err := extractBool([]byte(`{}`), "verified")
		require.Error(t, err)
		assert.Contains(t, err.Error(), `key "verified" not found`)
	})
	t.Run("non-bool leaf", func(t *testing.T) {
		_, err := extractBool([]byte(`{"verified": "yes"}`), "verified")
		require.Error(t, err)
	})
}

func TestEncodeConfirmationReportRoundTrips(t *testing.T) {
	encoded, err := encodeConfirmationReport(vaultAddress, big.NewInt(5), true)
	require.NoError(t, err)

	args, err := confirmationReportArgs()
	require.NoError(t, err)
	vals, err := args.Unpack(encoded)
	require.NoError(t, err)
	require.Len(t, vals, 3)

	assert.Equal(t, vaultAddress, vals[0].(common.Address))
	assert.Equal(t, 0, big.NewInt(5).Cmp(vals[1].(*big.Int)))
	assert.Equal(t, true, vals[2].(bool))
}

func TestIsZeroAddress(t *testing.T) {
	assert.True(t, isZeroAddress(""))
	assert.True(t, isZeroAddress("0x0000000000000000000000000000000000000000"))
	assert.False(t, isZeroAddress(consumerAddress))
}

// ─── Handler ───────────────────────────────────────────────

func TestOnMilestoneClaimed_InjectsEnclaveFetchedSecret(t *testing.T) {
	docHash := crypto.Keccak256Hash([]byte("deed-transfer.pdf"))
	log := docsSubmittedLog(t, vaultAddress, 0, docHash)
	_, authHeaders := stubHTTP(t, 200, `{"verified": true}`)
	runtime := testutils.NewTeeRuntime(t, testSecrets())

	_, err := onMilestoneClaimed(testConfig(), runtime, log)
	require.NoError(t, err)

	assert.Equal(t, []string{"Bearer " + apiToken}, *authHeaders)
}

func TestOnMilestoneClaimed_QueriesClaimSpecificURL(t *testing.T) {
	docHash := crypto.Keccak256Hash([]byte("deed-transfer.pdf"))
	log := docsSubmittedLog(t, vaultAddress, 2, docHash)
	urls, _ := stubHTTP(t, 200, `{"verified": true}`)
	runtime := testutils.NewTeeRuntime(t, testSecrets())

	_, err := onMilestoneClaimed(testConfig(), runtime, log)
	require.NoError(t, err)

	require.Len(t, *urls, 1)
	assert.Contains(t, (*urls)[0], "vault="+vaultAddress.Hex())
	assert.Contains(t, (*urls)[0], "milestoneIndex=2")
}

func TestOnMilestoneClaimed_SkipsWriteWhenNoConsumer(t *testing.T) {
	docHash := crypto.Keccak256Hash([]byte("deed-transfer.pdf"))
	log := docsSubmittedLog(t, vaultAddress, 1, docHash)
	stubHTTP(t, 200, `{"verified": true}`)
	runtime := testutils.NewTeeRuntime(t, testSecrets())

	result, err := onMilestoneClaimed(testConfig(), runtime, log)
	require.NoError(t, err)

	assert.Contains(t, result, "confirmed")
	assert.Contains(t, result, "no consumer configured")
}

func TestOnMilestoneClaimed_SkipsWriteWhenNotConfirmed(t *testing.T) {
	docHash := crypto.Keccak256Hash([]byte("deed-transfer.pdf"))
	log := docsSubmittedLog(t, vaultAddress, 1, docHash)
	stubHTTP(t, 200, `{"verified": false}`)
	captured := stubEVMWrite(t, evm.TxStatus_TX_STATUS_SUCCESS)
	runtime := testutils.NewTeeRuntime(t, testSecrets())

	result, err := onMilestoneClaimed(configWithConsumer(), runtime, log)
	require.NoError(t, err)

	assert.Contains(t, result, "not confirmed")
	assert.Nil(t, *captured, "no report should be written on-chain when the condition is not confirmed")
}

func TestOnMilestoneClaimed_WritesConfirmationReportOnChain(t *testing.T) {
	docHash := crypto.Keccak256Hash([]byte("deed-transfer.pdf"))
	log := docsSubmittedLog(t, vaultAddress, 4, docHash)
	stubHTTP(t, 200, `{"verified": true}`)
	captured := stubEVMWrite(t, evm.TxStatus_TX_STATUS_SUCCESS)
	runtime := testutils.NewTeeRuntime(t, testSecrets())

	result, err := onMilestoneClaimed(configWithConsumer(), runtime, log)
	require.NoError(t, err)
	require.NotNil(t, *captured)

	assert.Equal(t, common.HexToAddress(consumerAddress).Bytes(), (*captured).Receiver)
	assert.Contains(t, result, "confirmed, tx")

	args, err := confirmationReportArgs()
	require.NoError(t, err)
	vals, err := args.Unpack((*captured).Report.RawReport[cre.ReportMetadataHeaderLength:])
	require.NoError(t, err)
	assert.Equal(t, vaultAddress, vals[0].(common.Address))
	assert.Equal(t, 0, big.NewInt(4).Cmp(vals[1].(*big.Int)))
	assert.Equal(t, true, vals[2].(bool))
}

func TestOnMilestoneClaimed_ErrorsWhenWriteReverts(t *testing.T) {
	docHash := crypto.Keccak256Hash([]byte("deed-transfer.pdf"))
	log := docsSubmittedLog(t, vaultAddress, 0, docHash)
	stubHTTP(t, 200, `{"verified": true}`)
	stubEVMWrite(t, evm.TxStatus_TX_STATUS_REVERTED)
	runtime := testutils.NewTeeRuntime(t, testSecrets())

	_, err := onMilestoneClaimed(configWithConsumer(), runtime, log)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "not successful")
}

func TestOnMilestoneClaimed_ErrorsOnNon2xx(t *testing.T) {
	docHash := crypto.Keccak256Hash([]byte("deed-transfer.pdf"))
	log := docsSubmittedLog(t, vaultAddress, 0, docHash)
	stubHTTP(t, 401, "unauthorized")
	runtime := testutils.NewTeeRuntime(t, testSecrets())

	_, err := onMilestoneClaimed(testConfig(), runtime, log)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "status: 401")
}

func TestOnMilestoneClaimed_ErrorsOnMalformedLog(t *testing.T) {
	runtime := testutils.NewTeeRuntime(t, testSecrets())
	_, err := onMilestoneClaimed(testConfig(), runtime, &evm.Log{Topics: [][]byte{{0x01}}})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "decode DocsSubmitted log")
}

// stubHTTPByURL registers an in-enclave HTTP stub whose response depends on
// the request URL (primary verification vs IoT provider), recording every
// URL and Authorization header it was called with.
func stubHTTPByURL(t *testing.T, respond func(url string) (uint32, string)) (urls *[]string, authHeaders *[]string) {
	t.Helper()

	capability, err := httpmock.NewClientCapability(t)
	require.NoError(t, err)

	urls = &[]string{}
	authHeaders = &[]string{}
	capability.SendRequest = func(_ context.Context, input *http.Request) (*http.Response, error) {
		*urls = append(*urls, input.Url)
		if auth := input.MultiHeaders["Authorization"]; auth != nil {
			*authHeaders = append(*authHeaders, auth.Values...)
		}
		status, body := respond(input.Url)
		return &http.Response{StatusCode: status, Body: []byte(body)}, nil
	}
	return urls, authHeaders
}

func iotConfig() *Config {
	config := configWithConsumer()
	config.BulkDeliveryIoT = &BulkDeliveryIoT{
		ProviderURL:           "https://iot.example.com/v1/shipments/delivery",
		SecretID:              "IOT_PROVIDER_TOKEN",
		ResponseDeliveredPath: "delivered",
		Shipments:             map[string]string{vaultAddress.Hex(): "SHP-12345"},
	}
	return config
}

func iotSecrets() testutils.Secrets {
	return testutils.Secrets{
		cre.DefaultSecretNamespace: {
			"VERIFICATION_API_TOKEN": apiToken,
			"IOT_PROVIDER_TOKEN":     "test-iot-provider-token",
		},
	}
}

func TestOnMilestoneClaimed_BulkDeliveryWritesOnlyWhenBothSourcesConfirm(t *testing.T) {
	docHash := crypto.Keccak256Hash([]byte("bill-of-lading.pdf"))
	log := docsSubmittedLog(t, vaultAddress, 1, docHash)
	urls, authHeaders := stubHTTPByURL(t, func(u string) (uint32, string) {
		if strings.Contains(u, "iot.example.com") {
			return 200, `{"delivered": true, "telemetry": "confidential-detail"}`
		}
		return 200, `{"verified": true}`
	})
	captured := stubEVMWrite(t, evm.TxStatus_TX_STATUS_SUCCESS)
	runtime := testutils.NewTeeRuntime(t, iotSecrets())

	result, err := onMilestoneClaimed(iotConfig(), runtime, log)
	require.NoError(t, err)
	require.NotNil(t, *captured)
	assert.Contains(t, result, "confirmed")

	// Both legs ran, each with its own credential.
	require.Len(t, *urls, 2)
	assert.Contains(t, strings.Join(*urls, "\n"), "shipmentId=SHP-12345")
	assert.ElementsMatch(t, []string{"Bearer " + apiToken, "Bearer test-iot-provider-token"}, *authHeaders)
}

func TestOnMilestoneClaimed_BulkDeliveryBlockedWhenIotDisagrees(t *testing.T) {
	docHash := crypto.Keccak256Hash([]byte("bill-of-lading.pdf"))
	log := docsSubmittedLog(t, vaultAddress, 1, docHash)
	// Primary source says confirmed; the IoT telemetry says the shipment was
	// NOT delivered. The DON must not attest.
	urls, _ := stubHTTPByURL(t, func(u string) (uint32, string) {
		if strings.Contains(u, "iot.example.com") {
			return 200, `{"delivered": false}`
		}
		return 200, `{"verified": true}`
	})
	captured := stubEVMWrite(t, evm.TxStatus_TX_STATUS_SUCCESS)
	runtime := testutils.NewTeeRuntime(t, iotSecrets())

	result, err := onMilestoneClaimed(iotConfig(), runtime, log)
	require.NoError(t, err)

	assert.Contains(t, result, "not confirmed")
	assert.Contains(t, result, "iotDelivered=false")
	assert.Nil(t, *captured, "no report may be written when the IoT provider disagrees")
	assert.Len(t, *urls, 2)
}

func TestOnMilestoneClaimed_BulkDeliverySkippedForUnmappedVault(t *testing.T) {
	otherVault := common.HexToAddress("0x00000000000000000000000000000000FEEDFACE")
	docHash := crypto.Keccak256Hash([]byte("deed-transfer.pdf"))
	log := docsSubmittedLog(t, otherVault, 0, docHash)
	urls, _ := stubHTTPByURL(t, func(u string) (uint32, string) {
		return 200, `{"verified": true}`
	})
	// No consumer configured — checking only which HTTP legs ran.
	config := testConfig()
	config.BulkDeliveryIoT = iotConfig().BulkDeliveryIoT
	runtime := testutils.NewTeeRuntime(t, iotSecrets())

	result, err := onMilestoneClaimed(config, runtime, log)
	require.NoError(t, err)
	assert.Contains(t, result, "confirmed")
	assert.Len(t, *urls, 1, "vaults without a mapped shipment must not hit the IoT provider")
}

func TestOnMilestoneClaimed_IotFailureAbortsTheClaim(t *testing.T) {
	docHash := crypto.Keccak256Hash([]byte("bill-of-lading.pdf"))
	log := docsSubmittedLog(t, vaultAddress, 1, docHash)
	stubHTTPByURL(t, func(u string) (uint32, string) {
		if strings.Contains(u, "iot.example.com") {
			return 500, `{"error": "provider exploded"}`
		}
		return 200, `{"verified": true}`
	})
	captured := stubEVMWrite(t, evm.TxStatus_TX_STATUS_SUCCESS)
	runtime := testutils.NewTeeRuntime(t, iotSecrets())

	_, err := onMilestoneClaimed(iotConfig(), runtime, log)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "IoT delivery request failed with status: 500")
	assert.Nil(t, *captured, "a failing IoT leg must fail closed, never attest")
}

func TestOnMilestoneClaimed_IotLegDoesNotLeakTelemetry(t *testing.T) {
	docHash := crypto.Keccak256Hash([]byte("bill-of-lading.pdf"))
	log := docsSubmittedLog(t, vaultAddress, 0, docHash)
	const sensitiveTelemetry = "gps-coordinates-and-temperature-trace-xyz"
	stubHTTPByURL(t, func(u string) (uint32, string) {
		if strings.Contains(u, "iot.example.com") {
			return 200, `{"delivered": true, "telemetry": "`+sensitiveTelemetry+`"}`
		}
		return 200, `{"verified": true, "note": "sensitive-note"}`
	})
	// No consumer configured — the run stops after the verdict, which is all
	// this test needs to inspect the enclave logs.
	config := testConfig()
	config.BulkDeliveryIoT = iotConfig().BulkDeliveryIoT
	runtime := testutils.NewTeeRuntime(t, iotSecrets())

	_, err := onMilestoneClaimed(config, runtime, log)
	require.NoError(t, err)

	for _, raw := range runtime.GetLogs() {
		line := string(raw)
		assert.False(t, strings.Contains(line, "test-iot-provider-token"), "log leaked the IoT secret: %s", line)
		assert.False(t, strings.Contains(line, sensitiveTelemetry), "log leaked raw telemetry: %s", line)
	}
}

func TestOnMilestoneClaimed_DoesNotLogSecretOrResponseBody(t *testing.T) {
	docHash := crypto.Keccak256Hash([]byte("deed-transfer.pdf"))
	log := docsSubmittedLog(t, vaultAddress, 0, docHash)
	const sensitiveField = "sensitive-verification-detail-xyz"
	stubHTTP(t, 200, `{"verified": true, "note": "`+sensitiveField+`"}`)
	runtime := testutils.NewTeeRuntime(t, testSecrets())

	_, err := onMilestoneClaimed(testConfig(), runtime, log)
	require.NoError(t, err)

	for _, raw := range runtime.GetLogs() {
		line := string(raw)
		assert.False(t, strings.Contains(line, apiToken), "log leaked the secret: %s", line)
		assert.False(t, strings.Contains(line, sensitiveField), "log leaked the raw response body: %s", line)
	}
}

func TestInitWorkflow_RegistersTeeHandler(t *testing.T) {
	workflow, err := InitWorkflow(testConfig(), nil, nil)
	require.NoError(t, err)
	assert.Len(t, workflow, 1)
}

func TestInitWorkflow_RevertsOnEmptyVaultAddresses(t *testing.T) {
	config := testConfig()
	config.VaultAddresses = nil

	_, err := InitWorkflow(config, nil, nil)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "vaultAddresses")
}

func TestInitWorkflow_RevertsOnUnknownChainSelectorName(t *testing.T) {
	config := testConfig()
	config.ChainSelectorName = "not-a-real-chain"

	_, err := InitWorkflow(config, nil, nil)
	require.Error(t, err)
}

func TestInitWorkflow_RevertsOnInvalidBulkDeliveryIoT(t *testing.T) {
	config := testConfig()
	config.BulkDeliveryIoT = &BulkDeliveryIoT{
		ProviderURL:           "https://iot.example.com/v1/shipments/delivery",
		SecretID:              "IOT_PROVIDER_TOKEN",
		ResponseDeliveredPath: "delivered",
		Shipments:             map[string]string{"not-an-address": "SHP-1"},
	}

	_, err := InitWorkflow(config, nil, nil)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "not a valid vault address")
}
