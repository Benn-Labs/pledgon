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
	"github.com/ethereum/go-ethereum/crypto"

	"github.com/smartcontractkit/cre-sdk-go/capabilities/blockchain/evm"
	"github.com/smartcontractkit/cre-sdk-go/capabilities/networking/http"
	"github.com/smartcontractkit/cre-sdk-go/cre"
)

// ─── Config ─────────────────────────────────────────────────
// All requirement-bearing values live here so they can change without a code
// edit. Units are explicit in the field names.
type Config struct {
	ChainSelectorName string   `json:"chainSelectorName"` // CRE chain selector name, e.g. "ethereum-testnet-sepolia"
	VaultAddresses    []string `json:"vaultAddresses"`    // EscrowVault addresses to watch for DocsSubmitted

	// Confidential verification source. The URL and bearer token are visible only
	// inside the enclave; node operators never see either.
	VerificationURL       string `json:"verificationUrl"`       // e.g. a title-registry / payment-clearance lookup endpoint
	SecretID              string `json:"secretId"`              // Vault DON secret id, mapped in secrets.yaml
	ResponseConfirmedPath string `json:"responseConfirmedPath"` // dot-path to a boolean, e.g. "verified"

	// Optional second corroboration leg for BULK DELIVERIES (large-quantity
	// purchases shipped as freight/IoT-tracked consignments). When a watched
	// vault has a shipment mapped here, the milestone claim must also be
	// corroborated by the IoT sensor API provider — delivered quantity,
	// custody/handoff events and condition telemetry — before the DON
	// attests confirmation. Without this, a seller could anchor any docHash
	// to a bulk-delivery milestone and a single compromised verification
	// source would be enough to release the funds. Leave nil to keep the
	// original single-source behavior.
	BulkDeliveryIoT *BulkDeliveryIoT `json:"bulkDeliveryIoT"`

	// On-chain delivery. Leave ConfirmationConsumerAddress as the zero address to
	// stop after GenerateReport (useful for simulating before it's deployed).
	ConfirmationConsumerAddress string `json:"confirmationConsumerAddress"` // deployed EscrowConfirmationConsumer
	GasLimitWei                 uint64 `json:"gasLimitWei"`
}

// BulkDeliveryIoT wires an IoT sensor API provider into the verification
// path. Everything here is confidential: the provider URL, its credential
// and the raw telemetry never leave the enclave — only the final boolean
// verdict crosses UsingTheDons(), same as the primary source.
type BulkDeliveryIoT struct {
	// ProviderURL is the IoT provider's shipment-delivery endpoint, e.g.
	// "https://api.iot-provider.com/v1/shipments/delivery". The workflow
	// appends ?shipmentId=...&vault=...&milestoneIndex=...&docHash=... so the
	// provider answers for the exact claim being verified.
	ProviderURL string `json:"providerUrl"`
	// SecretID is the Vault DON secret holding the provider's API credential,
	// mapped in secrets.yaml (keep it separate from the primary source's
	// credential so the two can be rotated independently).
	SecretID string `json:"iotSecretId"`
	// ResponseDeliveredPath is the dot-path to a boolean in the provider's
	// response — true meaning "sensor telemetry attests the claimed shipment
	// quantity was delivered in acceptable condition".
	ResponseDeliveredPath string `json:"responseDeliveredPath"`
	// Shipments maps an EscrowVault address (the vault a bulk purchase
	// opened) to the IoT provider's shipment/tracking id for that
	// consignment. Vaults not listed here skip the IoT leg entirely.
	Shipments map[string]string `json:"shipments"`
}

// docsSubmittedSignature must match EscrowVault.sol's event exactly:
// event DocsSubmitted(uint256 indexed milestoneIndex, bytes32 docHash);
const docsSubmittedSignature = "DocsSubmitted(uint256,bytes32)"

// ─── Log decoding ─────────────────────────────────────────
// milestoneIndex is indexed (topic 1); docHash is not indexed, so it's the log's
// entire data word.

func decodeDocsSubmitted(log *evm.Log) (milestoneIndex *big.Int, docHash [32]byte, err error) {
	wantSig := crypto.Keccak256Hash([]byte(docsSubmittedSignature))
	if len(log.Topics) < 2 {
		return nil, docHash, fmt.Errorf("log has %d topics, want at least 2 (signature + milestoneIndex)", len(log.Topics))
	}
	if !bytes.Equal(log.Topics[0], wantSig.Bytes()) {
		return nil, docHash, fmt.Errorf("log signature topic %x does not match DocsSubmitted", log.Topics[0])
	}
	milestoneIndex = new(big.Int).SetBytes(log.Topics[1])

	if len(log.Data) < 32 {
		return nil, docHash, fmt.Errorf("log data is %d bytes, want at least 32 (docHash)", len(log.Data))
	}
	copy(docHash[:], log.Data[:32])

	return milestoneIndex, docHash, nil
}

// buildVerificationURL appends the claim being verified as query parameters, so
// the off-chain source can answer "was this specific milestone's condition met".
func buildVerificationURL(base string, vault common.Address, milestoneIndex *big.Int, docHash [32]byte) (string, error) {
	u, err := url.Parse(base)
	if err != nil {
		return "", fmt.Errorf("parse base URL: %w", err)
	}
	q := u.Query()
	q.Set("vault", vault.Hex())
	q.Set("milestoneIndex", milestoneIndex.String())
	q.Set("docHash", "0x"+common.Bytes2Hex(docHash[:]))
	u.RawQuery = q.Encode()
	return u.String(), nil
}

// buildIotDeliveryURL appends the shipment reference plus the claim being
// corroborated, so the IoT provider answers for the exact consignment and
// milestone: "did sensor telemetry observe this claim's delivery".
func buildIotDeliveryURL(base string, shipmentID string, vault common.Address, milestoneIndex *big.Int, docHash [32]byte) (string, error) {
	u, err := url.Parse(base)
	if err != nil {
		return "", fmt.Errorf("parse IoT provider URL: %w", err)
	}
	q := u.Query()
	q.Set("shipmentId", shipmentID)
	q.Set("vault", vault.Hex())
	q.Set("milestoneIndex", milestoneIndex.String())
	q.Set("docHash", "0x"+common.Bytes2Hex(docHash[:]))
	u.RawQuery = q.Encode()
	return u.String(), nil
}

// extractBool walks a dot-separated path into a JSON object and returns the leaf
// as a bool. Mirrors the dot-path convention used by the RWA oracle workflow.
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

// confirmationReportArgs is (address vault, uint256 milestoneIndex, bool confirmed).
// EscrowConfirmationConsumer.sol decodes the report with these exact types.
func confirmationReportArgs() (abi.Arguments, error) {
	addrType, err := abi.NewType("address", "", nil)
	if err != nil {
		return nil, err
	}
	u256Type, err := abi.NewType("uint256", "", nil)
	if err != nil {
		return nil, err
	}
	boolType, err := abi.NewType("bool", "", nil)
	if err != nil {
		return nil, err
	}
	return abi.Arguments{{Type: addrType}, {Type: u256Type}, {Type: boolType}}, nil
}

func encodeConfirmationReport(vault common.Address, milestoneIndex *big.Int, confirmed bool) ([]byte, error) {
	args, err := confirmationReportArgs()
	if err != nil {
		return nil, err
	}
	return args.Pack(vault, milestoneIndex, confirmed)
}

func isZeroAddress(addr string) bool {
	return addr == "" || common.HexToAddress(addr) == (common.Address{})
}

// ─── TEE Log Callback ─────────────────────────────────────
// Receives a cre.TeeRuntime. Everything runs inside the enclave until the
// explicit UsingTheDons() crossover.
func onMilestoneClaimed(config *Config, runtime cre.TeeRuntime, log *evm.Log) (string, error) {
	vault := common.BytesToAddress(log.Address)
	milestoneIndex, docHash, err := decodeDocsSubmitted(log)
	if err != nil {
		return "", fmt.Errorf("decode DocsSubmitted log: %w", err)
	}

	// ── In enclave: fetch the credential ──
	secret, err := runtime.GetSecret(&cre.SecretRequest{Id: config.SecretID}).Await()
	if err != nil {
		return "", fmt.Errorf("fetch secret %q inside the enclave: %w", config.SecretID, err)
	}

	// ── In enclave: ask the verification source whether the claimed condition
	// actually holds (e.g. title recorded, payment cleared) ──
	verifyURL, err := buildVerificationURL(config.VerificationURL, vault, milestoneIndex, docHash)
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

	confirmed, err := extractBool(response.Body, config.ResponseConfirmedPath)
	if err != nil {
		return "", fmt.Errorf("extract confirmation: %w", err)
	}

	// ── In enclave: bulk-delivery corroboration via the IoT sensor provider.
	// A bulk purchase's milestone claim only counts if the shipment's sensor
	// telemetry agrees with the primary source. This leg runs entirely before
	// UsingTheDons() — the provider credential and raw telemetry never cross
	// out, only the final AND of the two booleans does. ──
	iotNote := ""
	if iot := config.BulkDeliveryIoT; iot != nil {
		shipmentID, isBulk := iot.Shipments[vault.Hex()]
		if isBulk {
			iotSecret, err := runtime.GetSecret(&cre.SecretRequest{Id: iot.SecretID}).Await()
			if err != nil {
				return "", fmt.Errorf("fetch IoT provider secret %q inside the enclave: %w", iot.SecretID, err)
			}

			iotURL, err := buildIotDeliveryURL(iot.ProviderURL, shipmentID, vault, milestoneIndex, docHash)
			if err != nil {
				return "", err
			}
			iotResponse, err := client.SendRequestInTee(runtime, &http.Request{
				Url:    iotURL,
				Method: "GET",
				MultiHeaders: map[string]*http.HeaderValues{
					"Authorization": {Values: []string{"Bearer " + iotSecret.Value}},
				},
			}).Await()
			if err != nil {
				return "", fmt.Errorf("IoT delivery request failed: %w", err)
			}
			if iotResponse.StatusCode < 200 || iotResponse.StatusCode > 299 {
				return "", fmt.Errorf("IoT delivery request failed with status: %d", iotResponse.StatusCode)
			}

			iotDelivered, err := extractBool(iotResponse.Body, iot.ResponseDeliveredPath)
			if err != nil {
				return "", fmt.Errorf("extract IoT delivery verdict: %w", err)
			}
			iotNote = fmt.Sprintf(" (bulk delivery %s: iotDelivered=%t)", shipmentID, iotDelivered)
			confirmed = confirmed && iotDelivered
		}
	}

	// ── Cross back to the DON ──
	// Only the boolean verdict crosses out. The secret and the raw verification
	// response do not.
	donRuntime := runtime.UsingTheDons()

	if !confirmed {
		return fmt.Sprintf("vault %s milestone %s: not confirmed%s, no report written", vault.Hex(), milestoneIndex, iotNote), nil
	}

	encoded, err := encodeConfirmationReport(vault, milestoneIndex, true)
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
	if isZeroAddress(config.ConfirmationConsumerAddress) {
		return fmt.Sprintf("vault %s milestone %s confirmed%s (no consumer configured, write skipped)", vault.Hex(), milestoneIndex, iotNote), nil
	}

	chainSelector, err := evm.ChainSelectorFromName(config.ChainSelectorName)
	if err != nil {
		return "", fmt.Errorf("resolve chain selector %q: %w", config.ChainSelectorName, err)
	}

	evmClient := &evm.Client{ChainSelector: chainSelector}
	reply, err := evmClient.WriteReport(donRuntime, &evm.WriteCreReportRequest{
		Receiver:  common.HexToAddress(config.ConfirmationConsumerAddress).Bytes(),
		Report:    report,
		GasConfig: &evm.GasConfig{GasLimit: config.GasLimitWei},
	}).Await()
	if err != nil {
		return "", fmt.Errorf("write confirmation report on-chain: %w", err)
	}
	if reply.TxStatus != evm.TxStatus_TX_STATUS_SUCCESS {
		return "", fmt.Errorf("on-chain write not successful: tx status %s", reply.TxStatus)
	}

	txHash := common.BytesToHash(reply.TxHash).Hex()
	return fmt.Sprintf("vault %s milestone %s confirmed%s, tx %s", vault.Hex(), milestoneIndex, iotNote, txHash), nil
}

// validateBulkDeliveryIoT fails closed at workflow start rather than
// mid-tick: a half-configured IoT leg must never let a bulk claim through
// unverified.
func validateBulkDeliveryIoT(iot *BulkDeliveryIoT) error {
	if iot == nil {
		return nil
	}
	if iot.ProviderURL == "" {
		return fmt.Errorf("bulkDeliveryIoT.providerUrl is required when bulkDeliveryIoT is configured")
	}
	if iot.SecretID == "" {
		return fmt.Errorf("bulkDeliveryIoT.iotSecretId is required when bulkDeliveryIoT is configured")
	}
	if iot.ResponseDeliveredPath == "" {
		return fmt.Errorf("bulkDeliveryIoT.responseDeliveredPath is required when bulkDeliveryIoT is configured")
	}
	if len(iot.Shipments) == 0 {
		return fmt.Errorf("bulkDeliveryIoT.shipments must map at least one vault when bulkDeliveryIoT is configured")
	}
	for vault, shipmentID := range iot.Shipments {
		if !common.IsHexAddress(vault) {
			return fmt.Errorf("bulkDeliveryIoT.shipments: %q is not a valid vault address", vault)
		}
		if shipmentID == "" {
			return fmt.Errorf("bulkDeliveryIoT.shipments[%q]: shipment id is empty", vault)
		}
	}
	return nil
}

// ─── Workflow Init ──────────────────────────────────────────
func InitWorkflow(config *Config, _ *slog.Logger, _ cre.SecretsProvider) (cre.Workflow[*Config], error) {
	if len(config.VaultAddresses) == 0 {
		return nil, fmt.Errorf("vaultAddresses must list at least one EscrowVault to watch")
	}
	if err := validateBulkDeliveryIoT(config.BulkDeliveryIoT); err != nil {
		return nil, err
	}

	chainSelector, err := evm.ChainSelectorFromName(config.ChainSelectorName)
	if err != nil {
		return nil, fmt.Errorf("resolve chain selector %q: %w", config.ChainSelectorName, err)
	}

	addresses := make([][]byte, len(config.VaultAddresses))
	for i, a := range config.VaultAddresses {
		addresses[i] = common.HexToAddress(a).Bytes()
	}

	eventSig := crypto.Keccak256Hash([]byte(docsSubmittedSignature))

	trigger := evm.LogTrigger(chainSelector, &evm.FilterLogTriggerRequest{
		Addresses: addresses,
		Topics:    []*evm.TopicValues{{Values: [][]byte{eventSig.Bytes()}}},
	})

	return cre.Workflow[*Config]{
		cre.HandlerInTee(
			trigger,
			onMilestoneClaimed,
			cre.OneOfTees{cre.Nitro{Regions: []cre.NitroRegion{cre.NitroUsWest2}}},
		),
	}, nil
}
