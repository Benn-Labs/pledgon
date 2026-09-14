package main

import (
	"context"
	"encoding/json"
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
	apiToken         = "test-kyc-provider-token"
	sepoliaChainName = "ethereum-testnet-sepolia"
	consumerAddress  = "0x00000000000000000000000000000000000CAFE"
)

var subjectAddress = common.HexToAddress("0x000000000000000000000000000000000BEEF0")

func testConfig() *Config {
	return &Config{
		AuthorizedKeys:          nil,
		VerificationURLTemplate: "https://example.com/kyc/cases/{caseId}/verdict",
		SecretID:                "COMPLIANCE_API_TOKEN",
		ResponseCompliantPath:   "compliant",
		ChainSelectorName:       sepoliaChainName,
		ConsumerAddress:         "0x0000000000000000000000000000000000000000",
		GasLimitWei:             500000,
	}
}

func configWithConsumer() *Config {
	config := testConfig()
	config.ConsumerAddress = consumerAddress
	return config
}

func testSecrets() testutils.Secrets {
	return testutils.Secrets{
		cre.DefaultSecretNamespace: {"COMPLIANCE_API_TOKEN": apiToken},
	}
}

func requestPayload(t *testing.T, subject common.Address, caseID string) *http.Payload {
	t.Helper()
	body, err := json.Marshal(ComplianceRequest{Subject: subject.Hex(), CaseID: caseID})
	require.NoError(t, err)
	return &http.Payload{Input: body}
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

func TestBuildCaseVerdictURL(t *testing.T) {
	t.Run("substitutes caseId", func(t *testing.T) {
		got, err := buildCaseVerdictURL("https://example.com/kyc/cases/{caseId}/verdict", "case abc/123")
		require.NoError(t, err)
		assert.Equal(t, "https://example.com/kyc/cases/case%20abc%2F123/verdict", got)
	})
	t.Run("rejects template with no placeholder", func(t *testing.T) {
		_, err := buildCaseVerdictURL("https://example.com/verdict", "case123")
		require.Error(t, err)
		assert.Contains(t, err.Error(), "{caseId}")
	})
}

func TestExtractBool(t *testing.T) {
	t.Run("top-level bool", func(t *testing.T) {
		b, err := extractBool([]byte(`{"compliant": true}`), "compliant")
		require.NoError(t, err)
		assert.True(t, b)
	})
	t.Run("nested bool", func(t *testing.T) {
		b, err := extractBool([]byte(`{"data":{"compliant": false}}`), "data.compliant")
		require.NoError(t, err)
		assert.False(t, b)
	})
	t.Run("missing key", func(t *testing.T) {
		_, err := extractBool([]byte(`{}`), "compliant")
		require.Error(t, err)
		assert.Contains(t, err.Error(), `key "compliant" not found`)
	})
}

func TestEncodeComplianceReportRoundTrips(t *testing.T) {
	encoded, err := encodeComplianceReport(subjectAddress, true, 1_700_000_000)
	require.NoError(t, err)

	args, err := complianceReportArgs()
	require.NoError(t, err)
	vals, err := args.Unpack(encoded)
	require.NoError(t, err)
	require.Len(t, vals, 3)

	assert.Equal(t, subjectAddress, vals[0].(common.Address))
	assert.Equal(t, true, vals[1].(bool))
	assert.Equal(t, int64(1_700_000_000), vals[2].(*big.Int).Int64())
}

func TestIsZeroAddress(t *testing.T) {
	assert.True(t, isZeroAddress(""))
	assert.True(t, isZeroAddress("0x0000000000000000000000000000000000000000"))
	assert.False(t, isZeroAddress(consumerAddress))
}

// ─── Handler ───────────────────────────────────────────────

func TestOnComplianceRequested_InjectsEnclaveFetchedSecret(t *testing.T) {
	payload := requestPayload(t, subjectAddress, "case-001")
	_, authHeaders := stubHTTP(t, 200, `{"compliant": true}`)
	runtime := testutils.NewTeeRuntime(t, testSecrets())

	_, err := onComplianceRequested(testConfig(), runtime, payload)
	require.NoError(t, err)

	assert.Equal(t, []string{"Bearer " + apiToken}, *authHeaders)
}

func TestOnComplianceRequested_QueriesCaseSpecificURL(t *testing.T) {
	payload := requestPayload(t, subjectAddress, "case-42")
	urls, _ := stubHTTP(t, 200, `{"compliant": true}`)
	runtime := testutils.NewTeeRuntime(t, testSecrets())

	_, err := onComplianceRequested(testConfig(), runtime, payload)
	require.NoError(t, err)

	require.Len(t, *urls, 1)
	assert.Contains(t, (*urls)[0], "case-42")
}

func TestOnComplianceRequested_RevertsOnInvalidSubject(t *testing.T) {
	payload := &http.Payload{Input: []byte(`{"subject":"not-an-address","caseId":"case-1"}`)}
	runtime := testutils.NewTeeRuntime(t, testSecrets())

	_, err := onComplianceRequested(testConfig(), runtime, payload)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "not a valid address")
}

func TestOnComplianceRequested_RevertsOnMissingCaseID(t *testing.T) {
	payload := &http.Payload{Input: []byte(`{"subject":"` + subjectAddress.Hex() + `"}`)}
	runtime := testutils.NewTeeRuntime(t, testSecrets())

	_, err := onComplianceRequested(testConfig(), runtime, payload)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "caseId is required")
}

func TestOnComplianceRequested_SkipsWriteWhenNoConsumer(t *testing.T) {
	payload := requestPayload(t, subjectAddress, "case-1")
	stubHTTP(t, 200, `{"compliant": true}`)
	runtime := testutils.NewTeeRuntime(t, testSecrets())

	result, err := onComplianceRequested(testConfig(), runtime, payload)
	require.NoError(t, err)

	assert.Contains(t, result, "compliant=true")
	assert.Contains(t, result, "no consumer configured")
}

func TestOnComplianceRequested_WritesTrueVerdictOnChain(t *testing.T) {
	payload := requestPayload(t, subjectAddress, "case-1")
	stubHTTP(t, 200, `{"compliant": true}`)
	captured := stubEVMWrite(t, evm.TxStatus_TX_STATUS_SUCCESS)
	runtime := testutils.NewTeeRuntime(t, testSecrets())

	result, err := onComplianceRequested(configWithConsumer(), runtime, payload)
	require.NoError(t, err)
	require.NotNil(t, *captured)

	assert.Equal(t, common.HexToAddress(consumerAddress).Bytes(), (*captured).Receiver)
	assert.Contains(t, result, "compliant=true, tx")

	args, err := complianceReportArgs()
	require.NoError(t, err)
	vals, err := args.Unpack((*captured).Report.RawReport[cre.ReportMetadataHeaderLength:])
	require.NoError(t, err)
	assert.Equal(t, subjectAddress, vals[0].(common.Address))
	assert.Equal(t, true, vals[1].(bool))
}

// A compliant:false verdict must still be written on-chain — it's the mechanism
// that overwrites a stale earlier compliant:true, unlike escrow-confirmation's
// not-confirmed case, which skips the write entirely.
func TestOnComplianceRequested_WritesFalseVerdictOnChainToo(t *testing.T) {
	payload := requestPayload(t, subjectAddress, "case-1")
	stubHTTP(t, 200, `{"compliant": false}`)
	captured := stubEVMWrite(t, evm.TxStatus_TX_STATUS_SUCCESS)
	runtime := testutils.NewTeeRuntime(t, testSecrets())

	result, err := onComplianceRequested(configWithConsumer(), runtime, payload)
	require.NoError(t, err)
	require.NotNil(t, *captured, "a false verdict must still be written on-chain")
	assert.Contains(t, result, "compliant=false, tx")

	args, err := complianceReportArgs()
	require.NoError(t, err)
	vals, err := args.Unpack((*captured).Report.RawReport[cre.ReportMetadataHeaderLength:])
	require.NoError(t, err)
	assert.Equal(t, false, vals[1].(bool))
}

func TestOnComplianceRequested_ErrorsWhenWriteReverts(t *testing.T) {
	payload := requestPayload(t, subjectAddress, "case-1")
	stubHTTP(t, 200, `{"compliant": true}`)
	stubEVMWrite(t, evm.TxStatus_TX_STATUS_REVERTED)
	runtime := testutils.NewTeeRuntime(t, testSecrets())

	_, err := onComplianceRequested(configWithConsumer(), runtime, payload)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "not successful")
}

func TestOnComplianceRequested_ErrorsOnNon2xx(t *testing.T) {
	payload := requestPayload(t, subjectAddress, "case-1")
	stubHTTP(t, 401, "unauthorized")
	runtime := testutils.NewTeeRuntime(t, testSecrets())

	_, err := onComplianceRequested(testConfig(), runtime, payload)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "status: 401")
}

func TestOnComplianceRequested_DoesNotLogSecretOrResponseBody(t *testing.T) {
	payload := requestPayload(t, subjectAddress, "case-1")
	const sensitiveField = "sensitive-pii-detail-xyz"
	stubHTTP(t, 200, `{"compliant": true, "matchedName": "`+sensitiveField+`"}`)
	runtime := testutils.NewTeeRuntime(t, testSecrets())

	_, err := onComplianceRequested(testConfig(), runtime, payload)
	require.NoError(t, err)

	for _, raw := range runtime.GetLogs() {
		line := string(raw)
		assert.False(t, strings.Contains(line, apiToken), "log leaked the secret: %s", line)
		assert.False(t, strings.Contains(line, sensitiveField), "log leaked PII from the response body: %s", line)
	}
}

func TestInitWorkflow_RegistersTeeHandler(t *testing.T) {
	workflow, err := InitWorkflow(testConfig(), nil, nil)
	require.NoError(t, err)
	assert.Len(t, workflow, 1)
}
