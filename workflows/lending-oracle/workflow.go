package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"log/slog"
	"math/big"
	"strings"

	"github.com/ethereum/go-ethereum/accounts/abi"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/crypto"

	"github.com/smartcontractkit/cre-sdk-go/capabilities/blockchain/evm"
	"github.com/smartcontractkit/cre-sdk-go/capabilities/networking/http"
	"github.com/smartcontractkit/cre-sdk-go/capabilities/scheduler/cron"
	"github.com/smartcontractkit/cre-sdk-go/cre"
)

// ─── Config ─────────────────────────────────────────────────
// The primary price source LendingPool itself reads on-chain via
// LendingOracleConsumer — the "first line of defense" collateralValueInDebtUnits()
// and isUndercollateralized() use for every borrow()/withdrawCollateral() call.
// This is *not* the same price liquidation-protection fetches: that workflow's
// VerificationURL is deliberately a different provider so LiquidationConsumer's
// eligibility verdict is a genuine independent corroboration of this feed, not
// the same number reported twice under two names (see docs/architecture.md's
// "Why a DON verdict is needed at all"). If this workflow and
// liquidation-protection ever end up pointed at the same upstream source, that
// property is gone even though the code still looks separated.
type Config struct {
	Schedule string `json:"schedule"` // 6-field cron (seconds first)

	ChainSelectorName string `json:"chainSelectorName"`

	// Price source. URL and secret are visible only inside the enclave. This
	// workflow uses the Confidential Workflow (TEE) path even though today's
	// source (a public, unauthenticated API) doesn't strictly need secrecy —
	// it's the only proven pattern for an external HTTP fetch in this
	// codebase (see workflow_test.go / docs/architecture.md: a plain,
	// non-TEE HTTP call needs DON-level consensus via RunInNodeMode, which
	// has no working example here), and it keeps this workflow ready to
	// swap in a real paid/authenticated feed later with no redesign.
	PriceURL          string `json:"priceUrl"`
	SecretID          string `json:"secretId"`
	ResponsePricePath string `json:"responsePricePath"` // dot-path to a numeric price
	PriceDecimals     uint32 `json:"priceDecimals"`     // scale applied to the fetched price; USD per whole collateral token

	// Must match the label LendingPool's collateralFeedId was derived from at
	// deploy time (DeployLending.s.sol's COLLATERAL_FEED_LABEL, default
	// "RWA/USD") — this workflow computes feedId the same way
	// LendingOracleConsumer.feedIdFor does (keccak256 of the label). A
	// mismatched label here reports under the wrong feed silently: LendingPool
	// would keep reading StalePrice on its own feed while this one succeeds.
	CollateralFeedLabel string `json:"collateralFeedLabel"`

	// On-chain delivery. Leave ConsumerAddress as the zero address to stop
	// after GenerateReport (useful for simulating before it's deployed).
	ConsumerAddress string `json:"consumerAddress"` // deployed LendingOracleConsumer
	GasLimitWei     uint64 `json:"gasLimitWei"`
}

// ─── Price parsing ───────────────────────────────────────────
// Same dot-path + exact-rational + round-half-up approach as
// liquidation-protection/workflow.go, reused here because it's already proven
// correct for this exact "scale a fetched decimal price" problem.

func extractNumber(body []byte, path string) (*big.Rat, error) {
	dec := json.NewDecoder(bytes.NewReader(body))
	dec.UseNumber()

	var root any
	if err := dec.Decode(&root); err != nil {
		return nil, fmt.Errorf("decode JSON body: %w", err)
	}

	cur := root
	for _, seg := range strings.Split(path, ".") {
		obj, ok := cur.(map[string]any)
		if !ok {
			return nil, fmt.Errorf("path %q: %q is not an object", path, seg)
		}
		next, ok := obj[seg]
		if !ok {
			return nil, fmt.Errorf("path %q: key %q not found", path, seg)
		}
		cur = next
	}

	var raw string
	switch v := cur.(type) {
	case json.Number:
		raw = v.String()
	case string:
		raw = strings.TrimSpace(v)
	default:
		return nil, fmt.Errorf("path %q: leaf is %T, want number or numeric string", path, cur)
	}

	rat, ok := new(big.Rat).SetString(raw)
	if !ok {
		return nil, fmt.Errorf("path %q: %q is not a number", path, raw)
	}
	return rat, nil
}

// quantize scales value by 10^decimals and rounds half-up to an integer.
func quantize(value *big.Rat, decimals uint32) (*big.Int, error) {
	if value.Sign() < 0 {
		return nil, fmt.Errorf("value %s is negative", value.RatString())
	}
	scale := new(big.Int).Exp(big.NewInt(10), big.NewInt(int64(decimals)), nil)
	scaled := new(big.Rat).Mul(value, new(big.Rat).SetInt(scale))
	scaled.Add(scaled, big.NewRat(1, 2))
	return new(big.Int).Quo(scaled.Num(), scaled.Denom()), nil
}

// feedIdFor mirrors LendingOracleConsumer.feedIdFor(string) exactly
// (keccak256(bytes(label))) so a report lands under the same feedId
// LendingPool reads.
func feedIdFor(label string) [32]byte {
	var id [32]byte
	copy(id[:], crypto.Keccak256([]byte(label)))
	return id
}

// ─── Report encoding ──────────────────────────────────────
// (feedId, value, decimals, updatedAt) — LendingOracleConsumer.sol decodes the
// report with these exact types.

func lendingOracleReportArgs() (abi.Arguments, error) {
	bytes32Type, err := abi.NewType("bytes32", "", nil)
	if err != nil {
		return nil, err
	}
	u256Type, err := abi.NewType("uint256", "", nil)
	if err != nil {
		return nil, err
	}
	u8Type, err := abi.NewType("uint8", "", nil)
	if err != nil {
		return nil, err
	}
	return abi.Arguments{{Type: bytes32Type}, {Type: u256Type}, {Type: u8Type}, {Type: u256Type}}, nil
}

func encodeLendingOracleReport(feedId [32]byte, value *big.Int, decimals uint8, updatedAt int64) ([]byte, error) {
	args, err := lendingOracleReportArgs()
	if err != nil {
		return nil, err
	}
	return args.Pack(feedId, value, decimals, big.NewInt(updatedAt))
}

func isZeroAddress(addr string) bool {
	return addr == "" || common.HexToAddress(addr) == (common.Address{})
}

// ─── TEE Cron Callback ────────────────────────────────────
// Receives a cre.TeeRuntime. The confidential leg (fetching the credential and
// calling the price source) runs first; UsingTheDons() is called exactly once,
// after which the resulting cre.Runtime is used for the report write — same
// call ordering as every other confidential workflow in this repo (see
// docs/architecture.md's "Confidential-workflow call ordering").
func onCronTrigger(config *Config, runtime cre.TeeRuntime, _ *cron.Payload) (string, error) {
	if config.CollateralFeedLabel == "" {
		return "", fmt.Errorf("collateralFeedLabel is not configured")
	}

	// ── In enclave: fetch the credential ──
	secret, err := runtime.GetSecret(&cre.SecretRequest{Id: config.SecretID}).Await()
	if err != nil {
		return "", fmt.Errorf("fetch secret %q inside the enclave: %w", config.SecretID, err)
	}

	// ── In enclave: fetch the price ──
	client := &http.Client{}
	response, err := client.SendRequestInTee(runtime, &http.Request{
		Url:    config.PriceURL,
		Method: "GET",
		MultiHeaders: map[string]*http.HeaderValues{
			"Authorization": {Values: []string{"Bearer " + secret.Value}},
		},
	}).Await()
	if err != nil {
		return "", fmt.Errorf("price request failed: %w", err)
	}
	if response.StatusCode < 200 || response.StatusCode > 299 {
		return "", fmt.Errorf("price request failed with status: %d", response.StatusCode)
	}

	rawPrice, err := extractNumber(response.Body, config.ResponsePricePath)
	if err != nil {
		return "", fmt.Errorf("extract price: %w", err)
	}
	price, err := quantize(rawPrice, config.PriceDecimals)
	if err != nil {
		return "", fmt.Errorf("quantize price: %w", err)
	}

	// ── Cross back to the DON ──
	donRuntime := runtime.UsingTheDons()

	feedId := feedIdFor(config.CollateralFeedLabel)
	updatedAt := donRuntime.Now().Unix()

	encoded, err := encodeLendingOracleReport(feedId, price, uint8(config.PriceDecimals), updatedAt)
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

	if isZeroAddress(config.ConsumerAddress) {
		return fmt.Sprintf("feed %q price=%s (no consumer configured, write skipped)", config.CollateralFeedLabel, price.String()), nil
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
		return "", fmt.Errorf("write price report on-chain: %w", err)
	}
	if reply.TxStatus != evm.TxStatus_TX_STATUS_SUCCESS {
		return "", fmt.Errorf("on-chain write not successful: tx status %s", reply.TxStatus)
	}

	txHash := common.BytesToHash(reply.TxHash).Hex()
	return fmt.Sprintf("feed %q price=%s, tx %s", config.CollateralFeedLabel, price.String(), txHash), nil
}

// ─── Workflow Init ──────────────────────────────────────────
func InitWorkflow(config *Config, _ *slog.Logger, _ cre.SecretsProvider) (cre.Workflow[*Config], error) {
	return cre.Workflow[*Config]{
		cre.HandlerInTee(
			cron.Trigger(&cron.Config{Schedule: config.Schedule}),
			onCronTrigger,
			cre.OneOfTees{cre.Nitro{Regions: []cre.NitroRegion{cre.NitroUsWest2}}},
		),
	}, nil
}
