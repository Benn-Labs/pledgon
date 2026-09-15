// Command wire-config copies addresses from a Deploy.s.sol deployment record
// (contracts/evm/deployments/<chainId>.json) into the matching fields of each
// workflow's config.<target>.json. It is deliberately narrow: it only touches
// the specific fields listed in `wirings` below, leaves every other config
// value (URLs, secret IDs, thresholds, and per-workflow inputs like
// vaultAddresses/borrower that a deployment record can't supply) untouched,
// and fails loudly rather than guessing when a field or file is missing.
//
// Usage:
//
//	go run ./cmd/wire-config --chain-id 11155111 --target staging
package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
)

// wiring maps one deployment record field to one workflow config field.
type wiring struct {
	workflow      string
	configField   string
	deploymentKey string
}

var wirings = []wiring{
	{workflow: "escrow-confirmation", configField: "confirmationConsumerAddress", deploymentKey: "escrowConfirmationConsumer"},
	{workflow: "compliance-check", configField: "consumerAddress", deploymentKey: "complianceConsumer"},
	{workflow: "liquidation-protection", configField: "lendingPoolAddress", deploymentKey: "lendingPool"},
	{workflow: "liquidation-protection", configField: "consumerAddress", deploymentKey: "liquidationConsumer"},
}

func main() {
	chainID := flag.String("chain-id", "", "chain ID matching contracts/evm/deployments/<chainId>.json (required)")
	target := flag.String("target", "staging", "config target: staging or production")
	flag.Parse()

	if *chainID == "" {
		fmt.Fprintln(os.Stderr, "usage: wire-config --chain-id <id> [--target staging|production]")
		os.Exit(1)
	}

	if err := run(".", *chainID, *target); err != nil {
		fmt.Fprintln(os.Stderr, "wire-config:", err)
		os.Exit(1)
	}
}

func run(root, chainID, target string) error {
	deploymentsPath := filepath.Join(root, "contracts", "evm", "deployments", chainID+".json")
	raw, err := os.ReadFile(deploymentsPath)
	if err != nil {
		return fmt.Errorf("read %s: %w", deploymentsPath, err)
	}

	var deployments map[string]string
	if err := json.Unmarshal(raw, &deployments); err != nil {
		return fmt.Errorf("parse %s: %w", deploymentsPath, err)
	}

	for _, w := range wirings {
		address := deployments[w.deploymentKey]
		if isZeroAddress(address) {
			// Deploy.s.sol writes the zero address for anything it skipped
			// (e.g. lending, when its token pair isn't configured) — vm
			// .serializeAddress has no concept of "absent," so a zero address
			// is how "not deployed" actually shows up in the record.
			fmt.Printf("skip %s.%s: %q was not deployed (zero address) in %s\n", w.workflow, w.configField, w.deploymentKey, deploymentsPath)
			continue
		}

		configPath := filepath.Join(root, "workflows", w.workflow, fmt.Sprintf("config.%s.json", target))
		if err := patchAddressField(configPath, w.configField, address); err != nil {
			return fmt.Errorf("patch %s: %w", configPath, err)
		}
		fmt.Printf("%s: %s = %s\n", configPath, w.configField, address)
	}

	return nil
}

// patchAddressField replaces the value of one top-level "field": "0x..." pair
// in a JSON file, editing the raw bytes rather than unmarshal/remarshal so
// formatting, key order, and every other value are left exactly as they were.
func patchAddressField(path, field, value string) error {
	raw, err := os.ReadFile(path)
	if err != nil {
		return err
	}

	var config map[string]json.RawMessage
	if err := json.Unmarshal(raw, &config); err != nil {
		return fmt.Errorf("parse: %w", err)
	}
	if _, ok := config[field]; !ok {
		return fmt.Errorf("field %q not found", field)
	}

	pattern := regexp.MustCompile(`"` + regexp.QuoteMeta(field) + `"\s*:\s*"[^"]*"`)
	replacement := fmt.Sprintf(`"%s": "%s"`, field, value)
	updated := pattern.ReplaceAll(raw, []byte(replacement))

	return os.WriteFile(path, updated, 0o644)
}

func isZeroAddress(addr string) bool {
	return addr == "" || strings.EqualFold(addr, "0x0000000000000000000000000000000000000000")
}
