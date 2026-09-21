package main

import (
	"fmt"
	"log/slog"
	"math/big"

	"github.com/ethereum/go-ethereum/accounts/abi"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/crypto"

	"github.com/smartcontractkit/cre-sdk-go/capabilities/blockchain/evm"
	"github.com/smartcontractkit/cre-sdk-go/capabilities/scheduler/cron"
	"github.com/smartcontractkit/cre-sdk-go/cre"
)

// ─── Config ─────────────────────────────────────────────────
// Unlike escrow-confirmation (which needs a hand-maintained list of vaults,
// since each one's off-chain verification source is unique), expiry applies
// uniformly to every vault EscrowFactory ever deployed — so this workflow
// discovers them from the factory each run instead of taking a static list.
type Config struct {
	Schedule string `json:"schedule"` // 6-field cron (seconds first)

	ChainSelectorName    string `json:"chainSelectorName"`
	EscrowFactoryAddress string `json:"escrowFactoryAddress"` // deployed EscrowFactory

	// On-chain delivery. Leave KeeperAddress as the zero address to stop after
	// discovery (useful for simulating before TradeExpiryKeeper is deployed).
	KeeperAddress string `json:"keeperAddress"` // deployed TradeExpiryKeeper
	GasLimitWei   uint64 `json:"gasLimitWei"`
}

// ─── Raw calldata helpers ────────────────────────────────────
// No generated bindings, same approach as liquidation-protection/workflow.go.
// Every read here is a deterministic on-chain fact (a count, an address, a
// bool, a timestamp) — nothing confidential, so this workflow never needs a
// TEE handler, unlike the other three in this repo.

func selector(signature string) []byte {
	return crypto.Keccak256([]byte(signature))[:4]
}

func encodeUint256Arg(signature string, arg *big.Int) ([]byte, error) {
	u256Type, err := abi.NewType("uint256", "", nil)
	if err != nil {
		return nil, err
	}
	packed, err := (abi.Arguments{{Type: u256Type}}).Pack(arg)
	if err != nil {
		return nil, err
	}
	return append(selector(signature), packed...), nil
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

func decodeBoolReply(data []byte) (bool, error) {
	boolType, err := abi.NewType("bool", "", nil)
	if err != nil {
		return false, err
	}
	vals, err := (abi.Arguments{{Type: boolType}}).Unpack(data)
	if err != nil {
		return false, err
	}
	return vals[0].(bool), nil
}

func decodeAddressReply(data []byte) (common.Address, error) {
	addrType, err := abi.NewType("address", "", nil)
	if err != nil {
		return common.Address{}, err
	}
	vals, err := (abi.Arguments{{Type: addrType}}).Unpack(data)
	if err != nil {
		return common.Address{}, err
	}
	return vals[0].(common.Address), nil
}

func callUint256(runtime cre.Runtime, client *evm.Client, to common.Address, signature string) (*big.Int, error) {
	reply, err := client.CallContract(runtime, &evm.CallContractRequest{
		Call: &evm.CallMsg{To: to.Bytes(), Data: selector(signature)},
	}).Await()
	if err != nil {
		return nil, fmt.Errorf("call %s on %s: %w", signature, to.Hex(), err)
	}
	return decodeUint256Reply(reply.Data)
}

func callUint256Indexed(runtime cre.Runtime, client *evm.Client, to common.Address, signature string, index *big.Int) (*big.Int, error) {
	calldata, err := encodeUint256Arg(signature, index)
	if err != nil {
		return nil, fmt.Errorf("encode %s call: %w", signature, err)
	}
	reply, err := client.CallContract(runtime, &evm.CallContractRequest{
		Call: &evm.CallMsg{To: to.Bytes(), Data: calldata},
	}).Await()
	if err != nil {
		return nil, fmt.Errorf("call %s(%s) on %s: %w", signature, index, to.Hex(), err)
	}
	return decodeUint256Reply(reply.Data)
}

func callBool(runtime cre.Runtime, client *evm.Client, to common.Address, signature string) (bool, error) {
	reply, err := client.CallContract(runtime, &evm.CallContractRequest{
		Call: &evm.CallMsg{To: to.Bytes(), Data: selector(signature)},
	}).Await()
	if err != nil {
		return false, fmt.Errorf("call %s on %s: %w", signature, to.Hex(), err)
	}
	return decodeBoolReply(reply.Data)
}

func callAddressIndexed(runtime cre.Runtime, client *evm.Client, to common.Address, signature string, index *big.Int) (common.Address, error) {
	calldata, err := encodeUint256Arg(signature, index)
	if err != nil {
		return common.Address{}, fmt.Errorf("encode %s call: %w", signature, err)
	}
	reply, err := client.CallContract(runtime, &evm.CallContractRequest{
		Call: &evm.CallMsg{To: to.Bytes(), Data: calldata},
	}).Await()
	if err != nil {
		return common.Address{}, fmt.Errorf("call %s(%s) on %s: %w", signature, index, to.Hex(), err)
	}
	return decodeAddressReply(reply.Data)
}

// ─── Report encoding ──────────────────────────────────────
// (vault, isMilestone, milestoneIndex) — TradeExpiryKeeper.sol decodes the
// report with these exact types. milestoneIndex is 0 and ignored for a
// funding expiry.

func expiryReportArgs() (abi.Arguments, error) {
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

func encodeExpiryReport(vault common.Address, isMilestone bool, milestoneIndex *big.Int) ([]byte, error) {
	args, err := expiryReportArgs()
	if err != nil {
		return nil, err
	}
	return args.Pack(vault, isMilestone, milestoneIndex)
}

func isZeroAddress(addr string) bool {
	return addr == "" || common.HexToAddress(addr) == (common.Address{})
}

// ─── Discovery ────────────────────────────────────────────
// expiryItem is one past-deadline action found on one vault: either the
// funding deadline itself, or one DocsSubmitted milestone's confirmation
// window.
type expiryItem struct {
	vault          common.Address
	isMilestone    bool
	milestoneIndex *big.Int
}

// discoverExpired walks every vault EscrowFactory has ever deployed and
// returns everything past its deadline right now. Vaults and milestones are
// independent per-item checks — a trade can need both a funding expiry (if
// somehow still unfunded past deadline) and, on a separate trade, a milestone
// expiry, in the same tick.
func discoverExpired(runtime cre.Runtime, client *evm.Client, factory common.Address, now int64) ([]expiryItem, error) {
	count, err := callUint256(runtime, client, factory, "vaultCount()")
	if err != nil {
		return nil, fmt.Errorf("read vaultCount(): %w", err)
	}

	var items []expiryItem
	for i := int64(0); i < count.Int64(); i++ {
		vault, err := callAddressIndexed(runtime, client, factory, "allVaults(uint256)", big.NewInt(i))
		if err != nil {
			return nil, fmt.Errorf("read allVaults(%d): %w", i, err)
		}

		cancelled, err := callBool(runtime, client, vault, "cancelled()")
		if err != nil {
			return nil, fmt.Errorf("read cancelled() on %s: %w", vault.Hex(), err)
		}
		if cancelled {
			continue
		}

		funded, err := callBool(runtime, client, vault, "funded()")
		if err != nil {
			return nil, fmt.Errorf("read funded() on %s: %w", vault.Hex(), err)
		}
		if !funded {
			fundingDeadline, err := callUint256(runtime, client, vault, "fundingDeadline()")
			if err != nil {
				return nil, fmt.Errorf("read fundingDeadline() on %s: %w", vault.Hex(), err)
			}
			if fundingDeadline.Sign() != 0 && fundingDeadline.Int64() <= now {
				items = append(items, expiryItem{vault: vault, isMilestone: false, milestoneIndex: big.NewInt(0)})
			}
		}

		milestoneCount, err := callUint256(runtime, client, vault, "milestoneCount()")
		if err != nil {
			return nil, fmt.Errorf("read milestoneCount() on %s: %w", vault.Hex(), err)
		}
		for m := int64(0); m < milestoneCount.Int64(); m++ {
			deadline, err := callUint256Indexed(runtime, client, vault, "milestoneDeadline(uint256)", big.NewInt(m))
			if err != nil {
				return nil, fmt.Errorf("read milestoneDeadline(%d) on %s: %w", m, vault.Hex(), err)
			}
			if deadline.Sign() != 0 && deadline.Int64() <= now {
				items = append(items, expiryItem{vault: vault, isMilestone: true, milestoneIndex: big.NewInt(m)})
			}
		}
	}
	return items, nil
}

// ─── Cron Callback ────────────────────────────────────────
// Plain cre.Runtime, not TeeRuntime — nothing here is confidential, so there's
// no enclave leg and no UsingTheDons() crossover to make.
func onCronTrigger(config *Config, runtime cre.Runtime, _ *cron.Payload) (string, error) {
	if isZeroAddress(config.EscrowFactoryAddress) {
		return "", fmt.Errorf("escrowFactoryAddress is not configured")
	}

	chainSelector, err := evm.ChainSelectorFromName(config.ChainSelectorName)
	if err != nil {
		return "", fmt.Errorf("resolve chain selector %q: %w", config.ChainSelectorName, err)
	}
	evmClient := &evm.Client{ChainSelector: chainSelector}
	factory := common.HexToAddress(config.EscrowFactoryAddress)

	items, err := discoverExpired(runtime, evmClient, factory, runtime.Now().Unix())
	if err != nil {
		return "", fmt.Errorf("discover expired trades: %w", err)
	}

	if isZeroAddress(config.KeeperAddress) {
		return fmt.Sprintf("found %d expired item(s) (no keeper configured, writes skipped)", len(items)), nil
	}
	keeper := common.HexToAddress(config.KeeperAddress)

	written, failed := 0, 0
	for _, item := range items {
		if err := relayExpiry(runtime, evmClient, keeper, item, config.GasLimitWei); err != nil {
			runtime.Logger().Error("relay expiry failed", "vault", item.vault.Hex(), "isMilestone", item.isMilestone, "error", err)
			failed++
			continue
		}
		written++
	}

	return fmt.Sprintf("found %d expired item(s): %d relayed, %d failed", len(items), written, failed), nil
}

// relayExpiry generates a DON report for one expired item and delivers it to
// the keeper. A single item's failure (e.g. someone else already expired it
// between discovery and delivery) doesn't abort the rest of the tick.
func relayExpiry(runtime cre.Runtime, client *evm.Client, keeper common.Address, item expiryItem, gasLimitWei uint64) error {
	encoded, err := encodeExpiryReport(item.vault, item.isMilestone, item.milestoneIndex)
	if err != nil {
		return fmt.Errorf("encode report payload: %w", err)
	}

	report, err := runtime.GenerateReport(&cre.ReportRequest{
		EncodedPayload: encoded,
		EncoderName:    "evm",
		SigningAlgo:    "ecdsa",
		HashingAlgo:    "keccak256",
	}).Await()
	if err != nil {
		return fmt.Errorf("generate report: %w", err)
	}

	reply, err := client.WriteReport(runtime, &evm.WriteCreReportRequest{
		Receiver:  keeper.Bytes(),
		Report:    report,
		GasConfig: &evm.GasConfig{GasLimit: gasLimitWei},
	}).Await()
	if err != nil {
		return fmt.Errorf("write report on-chain: %w", err)
	}
	if reply.TxStatus != evm.TxStatus_TX_STATUS_SUCCESS {
		return fmt.Errorf("on-chain write not successful: tx status %s", reply.TxStatus)
	}
	return nil
}

// ─── Workflow Init ──────────────────────────────────────────
func InitWorkflow(config *Config, _ *slog.Logger, _ cre.SecretsProvider) (cre.Workflow[*Config], error) {
	return cre.Workflow[*Config]{
		cre.Handler(
			cron.Trigger(&cron.Config{Schedule: config.Schedule}),
			onCronTrigger,
		),
	}, nil
}
