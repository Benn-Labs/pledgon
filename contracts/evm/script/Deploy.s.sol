// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {IERC20} from "../src/interfaces/IERC20.sol";
import {EscrowConfirmationConsumer} from "../src/escrow/EscrowConfirmationConsumer.sol";
import {EscrowFactory} from "../src/escrow/EscrowFactory.sol";
import {ArbitratorRegistry} from "../src/escrow/ArbitratorRegistry.sol";
import {TradeExpiryKeeper} from "../src/escrow/TradeExpiryKeeper.sol";
import {ComplianceConsumer} from "../src/compliance/ComplianceConsumer.sol";
import {Marketplace} from "../src/marketplace/Marketplace.sol";
import {LendingOracleConsumer} from "../src/lending/LendingOracleConsumer.sol";
import {LiquidationConsumer} from "../src/lending/LiquidationConsumer.sol";
import {LendingPool} from "../src/lending/LendingPool.sol";

/// @title Deploy
/// @notice Deploys the PLEDGON system contracts to whatever chain `forge script`
/// targets. Key material is supplied on the CLI (`--private-key` or
/// `--account`) — never read from an env var here.
///
/// Escrow and compliance always deploy. Lending deploys only if both token
/// addresses are set; a partial deployment (e.g. shipping escrow/marketplace
/// before lending's token pair is decided) is expected, not an error case.
///
/// Required env vars:
///   FORWARDER_ADDRESS          KeystoneForwarder for the target chain — the
///                               production address from chain-selectors.md, or
///                               the MockKeystoneForwarder for a local/simulation
///                               run. One forwarder serves every consumer on a
///                               given chain; this deploy targets one chain.
///   DEFAULT_ARBITER_ADDRESS    Arbiter EscrowFactory falls back to when a
///                               trade creator doesn't pick an accredited one
///                               of their own (see ArbitratorRegistry.sol /
///                               EscrowFactory._resolveArbiter). A real address
///                               someone actively arbitrates disputes from —
///                               no fallback default, since silently pointing
///                               this at nothing would leave every trade with
///                               an arbiter that can never actually rule.
///   OWNER_ADDRESS               Owns ArbitratorRegistry and EscrowFactory
///                               (accreditation, vault-creation fee/recipient)
///                               after deploy — typically the deployer's own
///                               address (`cast wallet address --account ...`),
///                               a multisig, or whoever should hold admin
///                               rights going forward. Not defaulted to
///                               `msg.sender`: see `run()`'s doc comment for
///                               why that's unsafe inside a forge script.
///
/// Optional env vars (lending is skipped entirely unless both token addresses
/// are set):
///   COLLATERAL_TOKEN_ADDRESS
///   DEBT_TOKEN_ADDRESS          must share `decimals()` with the collateral
///                               token — see LendingPool's own doc comment
///   COLLATERAL_FEED_LABEL       default "RWA/USD"; hashed to the feedId
///                               LendingOracleConsumer keys its price by
///   LIQUIDATION_THRESHOLD_BPS   default 8000 (80% LTV)
///
/// Optional env vars for compliance (see ComplianceConsumer.sol / EscrowFactory
/// .sol for what these mean):
///   COMPLIANCE_MAX_VALIDITY_DAYS   default 180 — how long a KYC verdict stays
///                                   valid before tierOf() reads it back as 0
///   TIER0_CAP_USD                  default 999 — rolling volume a buyer may
///                                   move with no compliance report at all
///   TIER1_CAP_USD                  default 10000 — cap once tier-1 (basic KYC)
///                                   verified; tier 2 (enhanced) is uncapped
///
/// Optional env vars for the vault-creation fee (see EscrowFactory.sol's
/// contract-level doc comment for why it's ETH, owner-adjustable, and
/// pull-withdrawn rather than pushed):
///   FEE_RECIPIENT_ADDRESS      default: the broadcasting account
///   VAULT_CREATION_FEE_WEI     default 0 (fees off) — wei required as
///                               msg.value on every createTrade/createTradeFor
///
/// Usage:
///   forge script script/Deploy.s.sol --rpc-url <url> --private-key $PRIVATE_KEY --broadcast
///
/// Writes every deployed address to deployments/<chainId>.json — copy the
/// relevant ones into the matching workflow's config.*.json
/// (confirmationConsumerAddress, consumerAddress, lendingPoolAddress, etc.).
contract Deploy is Script {
    function run() external {
        address forwarder = vm.envAddress("FORWARDER_ADDRESS");
        address defaultArbiter = vm.envAddress("DEFAULT_ARBITER_ADDRESS");
        // The account that ends up owning ArbitratorRegistry and EscrowFactory
        // — deliberately NOT defaulted to `msg.sender`. Inside a forge script,
        // `msg.sender` is forge-std's fixed DEFAULT_SENDER
        // (0x1804c8AB1F12E6bbf3894d4083f33e07309d1f38), not whoever
        // `--account`/`--private-key` actually broadcasts as; nobody holds
        // that address's key, so anything owned by it is permanently locked
        // out of every onlyOwner function. Pass the real address explicitly
        // (e.g. from `cast wallet address --account deployer`) — see
        // DeployEscrowFactory.s.sol's doc comment, where this was first
        // caught after it actually happened.
        address owner = vm.envAddress("OWNER_ADDRESS");

        uint256 maxValidity = vm.envOr("COMPLIANCE_MAX_VALIDITY_DAYS", uint256(180)) * 1 days;
        uint256 tier0CapUsd = vm.envOr("TIER0_CAP_USD", uint256(999));
        uint256 tier1CapUsd = vm.envOr("TIER1_CAP_USD", uint256(10_000));
        address feeRecipient = vm.envOr("FEE_RECIPIENT_ADDRESS", owner);
        uint256 vaultCreationFee = vm.envOr("VAULT_CREATION_FEE_WEI", uint256(0));
        // Per-consumer workflow bindings (WorkflowBoundReceiver). Bytes32 0 =
        // unbound = accepts any DON-signed workflow — fine for `cre workflow
        // simulate` (MockForwarder carries no metadata), never for production.
        // Bind by passing each workflow's ID once it's known (redeploy the
        // consumer and update the workflow config's receiver if it changed).
        bytes32 escrowConfirmationWorkflowId = vm.envOr("ESCROW_CONFIRMATION_WORKFLOW_ID", bytes32(0));
        bytes32 complianceWorkflowId = vm.envOr("COMPLIANCE_WORKFLOW_ID", bytes32(0));
        bytes32 tradeExpiryWorkflowId = vm.envOr("TRADE_EXPIRY_WORKFLOW_ID", bytes32(0));

        vm.startBroadcast();

        EscrowConfirmationConsumer confirmationConsumer =
            new EscrowConfirmationConsumer(forwarder, escrowConfirmationWorkflowId);
        ComplianceConsumer complianceConsumer = new ComplianceConsumer(forwarder, maxValidity, complianceWorkflowId);
        // Transfer ownership afterwards (ArbitratorRegistry.transferOwnership)
        // if accreditation decisions should live with a different key.
        ArbitratorRegistry arbitratorRegistry = new ArbitratorRegistry(owner);
        // EscrowFactory's own ownership (vault-creation fee/recipient) is
        // separate from ArbitratorRegistry's — same "owner, transfer later if
        // needed" default, via EscrowFactory.transferOwnership.
        EscrowFactory factory = new EscrowFactory(
            confirmationConsumer,
            complianceConsumer,
            tier0CapUsd,
            tier1CapUsd,
            arbitratorRegistry,
            defaultArbiter,
            owner,
            feeRecipient,
            vaultCreationFee
        );
        Marketplace marketplace = new Marketplace(factory);
        TradeExpiryKeeper tradeExpiryKeeper = new TradeExpiryKeeper(forwarder, tradeExpiryWorkflowId);

        if (
            escrowConfirmationWorkflowId == bytes32(0) || complianceWorkflowId == bytes32(0)
                || tradeExpiryWorkflowId == bytes32(0)
        ) {
            console.log("WARNING: one or more consumers deployed UNBOUND (workflow id 0)");
            console.log("         onReport accepts any DON-signed workflow - bind before production");
        }

        console.log("EscrowConfirmationConsumer:", address(confirmationConsumer));
        console.log("ComplianceConsumer:        ", address(complianceConsumer));
        console.log("ArbitratorRegistry:        ", address(arbitratorRegistry));
        console.log("EscrowFactory:             ", address(factory));
        console.log("Marketplace:               ", address(marketplace));
        console.log("TradeExpiryKeeper:         ", address(tradeExpiryKeeper));

        (address lendingOracleConsumer, address liquidationConsumer, address lendingPool) = _maybeDeployLending(forwarder);

        vm.stopBroadcast();

        _writeDeploymentJson(
            address(confirmationConsumer),
            address(complianceConsumer),
            address(arbitratorRegistry),
            address(factory),
            address(marketplace),
            address(tradeExpiryKeeper),
            lendingOracleConsumer,
            liquidationConsumer,
            lendingPool
        );
    }

    function _maybeDeployLending(address forwarder)
        private
        returns (address lendingOracleConsumer, address liquidationConsumer, address lendingPool)
    {
        address collateralToken = vm.envOr("COLLATERAL_TOKEN_ADDRESS", address(0));
        address debtToken = vm.envOr("DEBT_TOKEN_ADDRESS", address(0));

        if (collateralToken == address(0) || debtToken == address(0)) {
            console.log("Skipping lending: COLLATERAL_TOKEN_ADDRESS / DEBT_TOKEN_ADDRESS not both set");
            return (address(0), address(0), address(0));
        }

        string memory feedLabel = vm.envOr("COLLATERAL_FEED_LABEL", string("RWA/USD"));
        uint256 thresholdBps = vm.envOr("LIQUIDATION_THRESHOLD_BPS", uint256(8000));
        uint256 borrowRateBps = vm.envOr("BORROW_RATE_BPS", uint256(500));
        // Freshness/expiry bounds for the lending pipeline — see the
        // consumers' and pool's natspec for what 0 vs non-zero means.
        uint256 maxPriceAge = vm.envOr("MAX_PRICE_AGE", uint256(15 minutes));
        uint256 maxVerdictAge = vm.envOr("MAX_VERDICT_AGE", uint256(15 minutes));
        uint256 maxDeviationBps = vm.envOr("MAX_PRICE_DEVIATION_BPS", uint256(5000));
        // Workflow bindings — bytes32 0 = unbound (simulation only); see the
        // identical comment on the escrow-side consumers in run().
        bytes32 lendingOracleWorkflowId = vm.envOr("LENDING_ORACLE_WORKFLOW_ID", bytes32(0));
        bytes32 liquidationWorkflowId = vm.envOr("LIQUIDATION_WORKFLOW_ID", bytes32(0));

        LendingOracleConsumer oracleConsumer =
            new LendingOracleConsumer(forwarder, maxDeviationBps, maxPriceAge, lendingOracleWorkflowId);
        LiquidationConsumer liqConsumer = new LiquidationConsumer(forwarder, maxVerdictAge, liquidationWorkflowId);
        LendingPool pool = new LendingPool(
            IERC20(collateralToken),
            IERC20(debtToken),
            oracleConsumer,
            liqConsumer,
            oracleConsumer.feedIdFor(feedLabel),
            thresholdBps,
            borrowRateBps,
            maxPriceAge
        );

        console.log("LendingOracleConsumer:     ", address(oracleConsumer));
        console.log("LiquidationConsumer:       ", address(liqConsumer));
        console.log("LendingPool:               ", address(pool));

        return (address(oracleConsumer), address(liqConsumer), address(pool));
    }

    function _writeDeploymentJson(
        address confirmationConsumer,
        address complianceConsumer,
        address arbitratorRegistry,
        address factory,
        address marketplace,
        address tradeExpiryKeeper,
        address lendingOracleConsumer,
        address liquidationConsumer,
        address lendingPool
    ) private {
        string memory json = "deployment";
        vm.serializeAddress(json, "escrowConfirmationConsumer", confirmationConsumer);
        vm.serializeAddress(json, "complianceConsumer", complianceConsumer);
        vm.serializeAddress(json, "arbitratorRegistry", arbitratorRegistry);
        vm.serializeAddress(json, "escrowFactory", factory);
        vm.serializeAddress(json, "marketplace", marketplace);
        vm.serializeAddress(json, "tradeExpiryKeeper", tradeExpiryKeeper);
        vm.serializeAddress(json, "lendingOracleConsumer", lendingOracleConsumer);
        vm.serializeAddress(json, "liquidationConsumer", liquidationConsumer);
        string memory finalJson = vm.serializeAddress(json, "lendingPool", lendingPool);

        string memory path = string.concat("deployments/", vm.toString(block.chainid), ".json");
        vm.writeJson(finalJson, path);
        console.log("Wrote deployment addresses to", path);
    }
}
