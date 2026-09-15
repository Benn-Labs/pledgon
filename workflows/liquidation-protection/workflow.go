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
// One deployment monitors one borrower's position, same shape as the RWA oracle
// workflow monitoring one feed — see docs/architecture.md for the scaling
// tradeoff this implies (N borrowers means N deployments, for now).
type Config struct {
	Schedule string `json:"schedule"` // 6-field cron (seconds first)

	ChainSelectorName  string `json:"chainSelectorName"`
	LendingPoolAddress string `json:"lendingPoolAddress"` // deployed LendingPool
	Borrower           string `json:"borrower"`           // the position this deployment monitors

	// Confidential, independent price source. Corroborates LendingPool's own
	// on-chain oracle reading before attesting eligibility — this cross-check is
	// what protects against a single manipulated or stale on-chain feed causing a
	// wrongful liquidation. The URL and API key are visible only inside the
	// enclave.
	VerificationURL   string `json:"verificationUrl"`
	SecretID          string `json:"secretId"`
	ResponsePricePath string `json:"responsePricePath"` // dot-path to a numeric price
	PriceDecimals     uint32 `json:"priceDecimals"`     // scale applied to the fetched price; must match LendingPool's own feed convention (USD per whole collateral token)

	// On-chain delivery. Leave ConsumerAddress as the zero address to stop after
	// GenerateReport (useful for simulating before it's deployed).
	ConsumerAddress string `json:"consumerAddress"` // deployed LiquidationConsumer
	GasLimitWei     uint64 `json:"gasLimitWei"`
}

const bpsDenominator = 10_000

// ─── Independent price parsing ──────────────────────────────
// Same dot-path + exact-rational + round-half-up approach as the RWA oracle
// workflow (benn-cre/hello-confidential), reused here because it's already
// proven correct for this exact "scale a fetched decimal price" problem.

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

// ─── On-chain reads (raw calldata — no generated bindings) ──

func selector(signature string) []byte {
	return crypto.Keccak256([]byte(signature))[:4]
}

func encodePositionsCall(borrower common.Address) ([]byte, error) {
	addrType, err := abi.NewType("address", "", nil)
	if err != nil {
		return nil, err
	}
	packed, err := abi.Arguments{{Type: addrType}}.Pack(borrower)
	if err != nil {
		return nil, err
	}
	return append(selector("positions(address)"), packed...), nil
}

func decodePositionsReply(data []byte) (collateralAmount, debtAmount *big.Int, err error) {
	u256Type, err := abi.NewType("uint256", "", nil)
	if err != nil {
		return nil, nil, err
	}
	vals, err := (abi.Arguments{{Type: u256Type}, {Type: u256Type}}).Unpack(data)
	if err != nil {
		return nil, nil, err
	}
	return vals[0].(*big.Int), vals[1].(*big.Int), nil
}

func decodeUint256Reply(data []byte) (*big.Int, error) {
	u256Type, err := abi.NewType("uint256", "", nil)
	if err != nil {
		return nil, err
	}
	vals, err := (abi.Arguments{{Type: u256Type}}).Unpack(data)
	if err != nil {
		return nil, err
	}
	return vals[0].(*big.Int), nil
}

// isUndercollateralized mirrors LendingPool.sol's own _isUndercollateralized
// exactly: collateralValue * thresholdBps < debtAmount * BPS_DENOMINATOR, where
// collateralValue = collateralAmount * price / 10^priceDecimals.
func isUndercollateralized(collateralAmount, debtAmount, price *big.Int, priceDecimals uint32, thresholdBps *big.Int) bool {
	if debtAmount.Sign() == 0 {
		return false
	}
	scale := new(big.Int).Exp(big.NewInt(10), big.NewInt(int64(priceDecimals)), nil)
	collateralValue := new(big.Int).Div(new(big.Int).Mul(collateralAmount, price), scale)

	lhs := new(big.Int).Mul(collateralValue, thresholdBps)
	rhs := new(big.Int).Mul(debtAmount, big.NewInt(bpsDenominator))
	return lhs.Cmp(rhs) < 0
}

// ─── Report encoding ──────────────────────────────────────
// (borrower, eligible, checkedAt) — LiquidationConsumer.sol decodes the report
// with these exact types.

func liquidationReportArgs() (abi.Arguments, error) {
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

func encodeLiquidationReport(borrower common.Address, eligible bool, checkedAt int64) ([]byte, error) {
	args, err := liquidationReportArgs()
	if err != nil {
		return nil, err
	}
	return args.Pack(borrower, eligible, big.NewInt(checkedAt))
}

func isZeroAddress(addr string) bool {
	return addr == "" || common.HexToAddress(addr) == (common.Address{})
}

// ─── TEE Cron Callback ──────────────────────────────────────
// Receives a cre.TeeRuntime. The confidential leg (fetching the credential and
// calling the independent price source) runs first; UsingTheDons() is called
// exactly once, after which everything — the on-chain position/threshold reads
// and the report write — uses the resulting cre.Runtime.
func onCronTrigger(config *Config, runtime cre.TeeRuntime, _ *cron.Payload) (string, error) {
	if !common.IsHexAddress(config.Borrower) {
		return "", fmt.Errorf("borrower %q is not a valid address", config.Borrower)
	}
	borrower := common.HexToAddress(config.Borrower)

	// ── In enclave: fetch the credential ──
	secret, err := runtime.GetSecret(&cre.SecretRequest{Id: config.SecretID}).Await()
	if err != nil {
		return "", fmt.Errorf("fetch secret %q inside the enclave: %w", config.SecretID, err)
	}

	// ── In enclave: fetch the independent, corroborating price ──
	client := &http.Client{}
	response, err := client.SendRequestInTee(runtime, &http.Request{
		Url:    config.VerificationURL,
		Method: "GET",
		MultiHeaders: map[string]*http.HeaderValues{
			"Authorization": {Values: []string{"Bearer " + secret.Value}},
		},
	}).Await()
	if err != nil {
		return "", fmt.Errorf("confidential price request failed: %w", err)
	}
	if response.StatusCode < 200 || response.StatusCode > 299 {
		return "", fmt.Errorf("confidential price request failed with status: %d", response.StatusCode)
	}

	rawPrice, err := extractNumber(response.Body, config.ResponsePricePath)
	if err != nil {
		return "", fmt.Errorf("extract price: %w", err)
	}
	price, err := quantize(rawPrice, config.PriceDecimals)
	if err != nil {
		return "", fmt.Errorf("quantize price: %w", err)
	}

	// ── Cross back to the DON. Only the eligibility verdict crosses out — never
	// the secret or the raw price-provider response. ──
	donRuntime := runtime.UsingTheDons()

	chainSelector, err := evm.ChainSelectorFromName(config.ChainSelectorName)
	if err != nil {
		return "", fmt.Errorf("resolve chain selector %q: %w", config.ChainSelectorName, err)
	}
	evmClient := &evm.Client{ChainSelector: chainSelector}
	poolAddress := common.HexToAddress(config.LendingPoolAddress)

	positionsCalldata, err := encodePositionsCall(borrower)
	if err != nil {
		return "", fmt.Errorf("encode positions() call: %w", err)
	}
	positionsReply, err := evmClient.CallContract(donRuntime, &evm.CallContractRequest{
		Call: &evm.CallMsg{To: poolAddress.Bytes(), Data: positionsCalldata},
	}).Await()
	if err != nil {
		return "", fmt.Errorf("read positions(%s): %w", borrower.Hex(), err)
	}
	collateralAmount, debtAmount, err := decodePositionsReply(positionsReply.Data)
	if err != nil {
		return "", fmt.Errorf("decode positions() reply: %w", err)
	}

	thresholdReply, err := evmClient.CallContract(donRuntime, &evm.CallContractRequest{
		Call: &evm.CallMsg{To: poolAddress.Bytes(), Data: selector("liquidationThresholdBps()")},
	}).Await()
	if err != nil {
		return "", fmt.Errorf("read liquidationThresholdBps(): %w", err)
	}
	thresholdBps, err := decodeUint256Reply(thresholdReply.Data)
	if err != nil {
		return "", fmt.Errorf("decode liquidationThresholdBps() reply: %w", err)
	}

	eligible := isUndercollateralized(collateralAmount, debtAmount, price, config.PriceDecimals, thresholdBps)
	checkedAt := donRuntime.Now().Unix()

	// A false verdict is written too — like compliance-check, it's the mechanism
	// that overwrites a stale earlier true (the borrower may have repaid or
	// added collateral since).
	encoded, err := encodeLiquidationReport(borrower, eligible, checkedAt)
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
		return fmt.Sprintf("borrower %s eligible=%t (no consumer configured, write skipped)", borrower.Hex(), eligible), nil
	}

	reply, err := evmClient.WriteReport(donRuntime, &evm.WriteCreReportRequest{
		Receiver:  common.HexToAddress(config.ConsumerAddress).Bytes(),
		Report:    report,
		GasConfig: &evm.GasConfig{GasLimit: config.GasLimitWei},
	}).Await()
	if err != nil {
		return "", fmt.Errorf("write liquidation report on-chain: %w", err)
	}
	if reply.TxStatus != evm.TxStatus_TX_STATUS_SUCCESS {
		return "", fmt.Errorf("on-chain write not successful: tx status %s", reply.TxStatus)
	}

	txHash := common.BytesToHash(reply.TxHash).Hex()
	return fmt.Sprintf("borrower %s eligible=%t, tx %s", borrower.Hex(), eligible, txHash), nil
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
