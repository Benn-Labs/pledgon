package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"log/slog"
	"math/big"
	"net/url"
	"strings"

	"github.com/ethereum/go-ethereum/accounts/abi"
	"github.com/ethereum/go-ethereum/common"

	"github.com/smartcontractkit/cre-sdk-go/capabilities/blockchain/evm"
	"github.com/smartcontractkit/cre-sdk-go/capabilities/networking/http"
	"github.com/smartcontractkit/cre-sdk-go/cre"
)

// ─── Config ─────────────────────────────────────────────────
// All requirement-bearing values live here so they can change without a code
// edit. Units are explicit in the field names.
type Config struct {
	// Public keys permitted to invoke this webhook. Empty accepts any signer —
	// fine for `cre workflow simulate`, never for a production deployment. The
	// SDK's AuthorizedKey carries a raw ECDSA public key, not an address; confirm
	// the exact encoding CRE expects for your signer against `cre workflow
	// simulate` output before deploying with a non-empty list.
	AuthorizedKeys []string `json:"authorizedKeys"`

	// Confidential KYC/AML/sanctions provider. The URL and API key are visible
	// only inside the enclave — and so is whatever PII the provider's response
	// carries, since the request never includes raw PII (see CaseID below).
	VerificationURLTemplate string `json:"verificationUrlTemplate"` // e.g. "https://kyc-provider.example.com/cases/{caseId}/verdict"
	SecretID                string `json:"secretId"`                // Vault DON secret id, mapped in secrets.yaml
	ResponseCompliantPath   string `json:"responseCompliantPath"`   // dot-path to a boolean, e.g. "compliant"

	// On-chain delivery. Leave ConsumerAddress as the zero address to stop after
	// GenerateReport (useful for simulating before it's deployed).
	ChainSelectorName string `json:"chainSelectorName"` // CRE chain selector name, e.g. "ethereum-testnet-sepolia"
	ConsumerAddress   string `json:"consumerAddress"`   // deployed ComplianceConsumer
	GasLimitWei       uint64 `json:"gasLimitWei"`
}

// ComplianceRequest is the webhook's JSON body. It deliberately carries no PII:
// HTTP trigger delivery runs on Workflow DON nodes like any other trigger — it is
// NOT confidential, unlike the handler body once it's inside the enclave. CaseID
// is an opaque reference the KYC provider issued when the subject completed
// verification directly with the provider (out of band, before this webhook is
// ever called); the enclave uses it to fetch that provider's verdict, and only
// the verdict crosses back out.
type ComplianceRequest struct {
	Subject string `json:"subject"` // the address the verdict is recorded against
	CaseID  string `json:"caseId"`  // opaque KYC/case reference — never raw PII
}

// ─── Verdict source ───────────────────────────────────────
// Runs inside the enclave. The provider's response — which may itself carry PII
// (matched name, sanctions hits, etc.) — never crosses UsingTheDons(); only the
// derived boolean does.

func buildCaseVerdictURL(template, caseID string) (string, error) {
	if !strings.Contains(template, "{caseId}") {
		return "", fmt.Errorf("verificationUrlTemplate must contain a {caseId} placeholder")
	}
	raw := strings.ReplaceAll(template, "{caseId}", url.PathEscape(caseID))
	u, err := url.Parse(raw)
	if err != nil {
		return "", fmt.Errorf("parse verification URL: %w", err)
	}
	return u.String(), nil
}

// extractBool walks a dot-separated path into a JSON object and returns the leaf
// as a bool.
func extractBool(body []byte, path string) (bool, error) {
	dec := json.NewDecoder(bytes.NewReader(body))

	var root any
	if err := dec.Decode(&root); err != nil {
		return false, fmt.Errorf("decode JSON body: %w", err)
	}

	cur := root
	for _, seg := range strings.Split(path, ".") {
		obj, ok := cur.(map[string]any)
		if !ok {
			return false, fmt.Errorf("path %q: %q is not an object", path, seg)
		}
		next, ok := obj[seg]
		if !ok {
			return false, fmt.Errorf("path %q: key %q not found", path, seg)
		}
		cur = next
	}

	b, ok := cur.(bool)
	if !ok {
		return false, fmt.Errorf("path %q: leaf is %T, want bool", path, cur)
	}
	return b, nil
}

// complianceReportArgs is (address subject, bool compliant, uint256 verifiedAt).
// ComplianceConsumer.sol decodes the report with these exact types.
func complianceReportArgs() (abi.Arguments, error) {
	addrType, err := abi.NewType("address", "", nil)
	if err != nil {
		return nil, err
	}
	boolType, err := abi.NewType("bool", "", nil)
	if err != nil {
		return nil, err
	}
	u256Type, err := abi.NewType("uint256", "", nil)
	if err != nil {
		return nil, err
	}
	return abi.Arguments{{Type: addrType}, {Type: boolType}, {Type: u256Type}}, nil
}

func encodeComplianceReport(subject common.Address, compliant bool, verifiedAt int64) ([]byte, error) {
	args, err := complianceReportArgs()
	if err != nil {
		return nil, err
	}
	return args.Pack(subject, compliant, big.NewInt(verifiedAt))
}

func isZeroAddress(addr string) bool {
	return addr == "" || common.HexToAddress(addr) == (common.Address{})
}

// ─── TEE Webhook Callback ─────────────────────────────────
// Receives a cre.TeeRuntime. Everything runs inside the enclave until the
// explicit UsingTheDons() crossover.
func onComplianceRequested(config *Config, runtime cre.TeeRuntime, trigger *http.Payload) (string, error) {
	var req ComplianceRequest
	if err := json.Unmarshal(trigger.Input, &req); err != nil {
		return "", fmt.Errorf("decode request body: %w", err)
	}
	if !common.IsHexAddress(req.Subject) {
		return "", fmt.Errorf("subject %q is not a valid address", req.Subject)
	}
	if req.CaseID == "" {
		return "", fmt.Errorf("caseId is required")
	}
	subject := common.HexToAddress(req.Subject)

	// ── In enclave: fetch the provider credential ──
	secret, err := runtime.GetSecret(&cre.SecretRequest{Id: config.SecretID}).Await()
	if err != nil {
		return "", fmt.Errorf("fetch secret %q inside the enclave: %w", config.SecretID, err)
	}

	// ── In enclave: ask the provider for this case's verdict. The provider looks
	// up the subject's PII server-side from caseId; none of it is sent here. ──
	verifyURL, err := buildCaseVerdictURL(config.VerificationURLTemplate, req.CaseID)
	if err != nil {
		return "", fmt.Errorf("build verification URL: %w", err)
	}

	client := &http.Client{}
	response, err := client.SendRequestInTee(runtime, &http.Request{
		Url:    verifyURL,
		Method: "GET",
		MultiHeaders: map[string]*http.HeaderValues{
			"Authorization": {Values: []string{"Bearer " + secret.Value}},
		},
	}).Await()
	if err != nil {
		return "", fmt.Errorf("confidential verification request failed: %w", err)
	}
	if response.StatusCode < 200 || response.StatusCode > 299 {
		return "", fmt.Errorf("confidential verification request failed with status: %d", response.StatusCode)
	}

	compliant, err := extractBool(response.Body, config.ResponseCompliantPath)
	if err != nil {
		return "", fmt.Errorf("extract compliance verdict: %w", err)
	}

	// ── Cross back to the DON ──
	// Only the boolean verdict and the subject address cross out. The provider
	// credential and the raw response body — which may carry PII — do not.
	donRuntime := runtime.UsingTheDons()
	verifiedAt := donRuntime.Now().Unix()

	// Unlike a one-off confirmation, a compliant:false verdict is recorded too —
	// "checked and failed" must overwrite a stale "checked and passed", and the
	// vault's isCompliant() read needs the current answer either way.
	encoded, err := encodeComplianceReport(subject, compliant, verifiedAt)
	if err != nil {
		return "", fmt.Errorf("encode report payload: %w", err)
	}

	report, err := donRuntime.GenerateReport(&cre.ReportRequest{
		EncodedPayload: encoded,
		EncoderName:    "evm",
		SigningAlgo:    "ecdsa",
		HashingAlgo:    "keccak256",
	}).Await()
	if err != nil {
		return "", fmt.Errorf("generate report on the DON: %w", err)
	}

	// ── Deliver on-chain (skipped when no consumer is configured) ──
	if isZeroAddress(config.ConsumerAddress) {
		return fmt.Sprintf("subject %s compliant=%t (no consumer configured, write skipped)", subject.Hex(), compliant), nil
	}

	chainSelector, err := evm.ChainSelectorFromName(config.ChainSelectorName)
	if err != nil {
		return "", fmt.Errorf("resolve chain selector %q: %w", config.ChainSelectorName, err)
	}

	evmClient := &evm.Client{ChainSelector: chainSelector}
	reply, err := evmClient.WriteReport(donRuntime, &evm.WriteCreReportRequest{
		Receiver:  common.HexToAddress(config.ConsumerAddress).Bytes(),
		Report:    report,
		GasConfig: &evm.GasConfig{GasLimit: config.GasLimitWei},
	}).Await()
	if err != nil {
		return "", fmt.Errorf("write compliance report on-chain: %w", err)
	}
	if reply.TxStatus != evm.TxStatus_TX_STATUS_SUCCESS {
		return "", fmt.Errorf("on-chain write not successful: tx status %s", reply.TxStatus)
	}

	txHash := common.BytesToHash(reply.TxHash).Hex()
	return fmt.Sprintf("subject %s compliant=%t, tx %s", subject.Hex(), compliant, txHash), nil
}

// ─── Workflow Init ──────────────────────────────────────────
func InitWorkflow(config *Config, _ *slog.Logger, _ cre.SecretsProvider) (cre.Workflow[*Config], error) {
	authorizedKeys := make([]*http.AuthorizedKey, len(config.AuthorizedKeys))
	for i, k := range config.AuthorizedKeys {
		authorizedKeys[i] = &http.AuthorizedKey{Type: http.KeyType_KEY_TYPE_ECDSA_EVM, PublicKey: k}
	}

	trigger := http.Trigger(&http.Config{AuthorizedKeys: authorizedKeys})

	return cre.Workflow[*Config]{
		cre.HandlerInTee(
			trigger,
			onComplianceRequested,
			cre.OneOfTees{cre.Nitro{Regions: []cre.NitroRegion{cre.NitroUsWest2}}},
		),
	}, nil
}
