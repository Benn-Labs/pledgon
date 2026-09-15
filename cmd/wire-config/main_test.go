package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func writeFile(t *testing.T, path, content string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
}

func readJSONField(t *testing.T, path, field string) string {
	t.Helper()
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var m map[string]any
	if err := json.Unmarshal(raw, &m); err != nil {
		t.Fatalf("invalid JSON in %s: %v", path, err)
	}
	v, ok := m[field].(string)
	if !ok {
		t.Fatalf("%s: field %q missing or not a string", path, field)
	}
	return v
}

// ─── wirings table integrity ────────────────────────────────

func TestWirings_NoDuplicateFieldPerWorkflow(t *testing.T) {
	seen := map[string]bool{}
	for _, w := range wirings {
		key := w.workflow + "." + w.configField
		if seen[key] {
			t.Errorf("duplicate wiring for %s", key)
		}
		seen[key] = true
	}
}

func TestWirings_NoEmptyFields(t *testing.T) {
	for _, w := range wirings {
		if w.workflow == "" || w.configField == "" || w.deploymentKey == "" {
			t.Errorf("wiring has an empty field: %+v", w)
		}
	}
}

func TestIsZeroAddress(t *testing.T) {
	if !isZeroAddress("") {
		t.Error(`isZeroAddress("") = false`)
	}
	if !isZeroAddress("0x0000000000000000000000000000000000000000") {
		t.Error("isZeroAddress(zero address) = false")
	}
	if !isZeroAddress("0X0000000000000000000000000000000000000000") {
		t.Error("isZeroAddress should be case-insensitive")
	}
	if isZeroAddress("0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA") {
		t.Error("isZeroAddress(real address) = true")
	}
}

// ─── patchAddressField ────────────────────────────────────

func TestPatchAddressField_ReplacesValuePreservesRest(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "config.json")
	writeFile(t, path, `{
  "chainSelectorName": "ethereum-testnet-sepolia",
  "vaultAddresses": ["0x0000000000000000000000000000000000000000"],
  "confirmationConsumerAddress": "0x0000000000000000000000000000000000000000",
  "gasLimitWei": 500000
}
`)

	err := patchAddressField(path, "confirmationConsumerAddress", "0x1111111111111111111111111111111111111111")
	if err != nil {
		t.Fatal(err)
	}

	raw, _ := os.ReadFile(path)
	var m map[string]any
	if err := json.Unmarshal(raw, &m); err != nil {
		t.Fatalf("output is not valid JSON: %v\n%s", err, raw)
	}

	if got := m["confirmationConsumerAddress"]; got != "0x1111111111111111111111111111111111111111" {
		t.Errorf("confirmationConsumerAddress = %v, want the new address", got)
	}
	if got := m["chainSelectorName"]; got != "ethereum-testnet-sepolia" {
		t.Errorf("chainSelectorName changed: %v", got)
	}
	if got := m["gasLimitWei"]; got != float64(500000) {
		t.Errorf("gasLimitWei changed: %v", got)
	}
	vaults, ok := m["vaultAddresses"].([]any)
	if !ok || len(vaults) != 1 || vaults[0] != "0x0000000000000000000000000000000000000000" {
		t.Errorf("vaultAddresses changed: %v", m["vaultAddresses"])
	}
}

func TestPatchAddressField_ErrorsIfFieldMissing(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "config.json")
	writeFile(t, path, `{"gasLimitWei": 500000}`)

	err := patchAddressField(path, "consumerAddress", "0x1111111111111111111111111111111111111111")
	if err == nil {
		t.Fatal("expected an error for a missing field")
	}
}

func TestPatchAddressField_ErrorsIfFileMissing(t *testing.T) {
	err := patchAddressField(filepath.Join(t.TempDir(), "nope.json"), "consumerAddress", "0x1111111111111111111111111111111111111111")
	if err == nil {
		t.Fatal("expected an error for a missing file")
	}
}

func TestPatchAddressField_ErrorsOnInvalidJSON(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "config.json")
	writeFile(t, path, `{not valid json`)

	err := patchAddressField(path, "consumerAddress", "0x1111111111111111111111111111111111111111")
	if err == nil {
		t.Fatal("expected an error for invalid JSON")
	}
}

// ─── run (end to end against a fake repo tree) ─────────────

func setupFakeRepo(t *testing.T) string {
	t.Helper()
	root := t.TempDir()

	writeFile(t, filepath.Join(root, "contracts", "evm", "deployments", "11155111.json"), `{
  "escrowConfirmationConsumer": "0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
  "complianceConsumer": "0xBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
  "escrowFactory": "0xCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC",
  "marketplace": "0xDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD",
  "lendingOracleConsumer": "0x0000000000000000000000000000000000000000",
  "liquidationConsumer": "0x0000000000000000000000000000000000000000",
  "lendingPool": "0x0000000000000000000000000000000000000000"
}
`)

	writeFile(t, filepath.Join(root, "workflows", "escrow-confirmation", "config.staging.json"), `{
  "chainSelectorName": "ethereum-testnet-sepolia",
  "vaultAddresses": ["0x0000000000000000000000000000000000000000"],
  "confirmationConsumerAddress": "0x0000000000000000000000000000000000000000",
  "gasLimitWei": 500000
}
`)
	writeFile(t, filepath.Join(root, "workflows", "compliance-check", "config.staging.json"), `{
  "chainSelectorName": "ethereum-testnet-sepolia",
  "consumerAddress": "0x0000000000000000000000000000000000000000",
  "gasLimitWei": 500000
}
`)
	writeFile(t, filepath.Join(root, "workflows", "liquidation-protection", "config.staging.json"), `{
  "chainSelectorName": "ethereum-testnet-sepolia",
  "lendingPoolAddress": "0x0000000000000000000000000000000000000000",
  "borrower": "0x0000000000000000000000000000000000000000",
  "consumerAddress": "0x0000000000000000000000000000000000000000",
  "gasLimitWei": 500000
}
`)

	return root
}

func TestRun_WiresDeployedAddressesIntoConfigs(t *testing.T) {
	root := setupFakeRepo(t)

	if err := run(root, "11155111", "staging"); err != nil {
		t.Fatal(err)
	}

	escrowConfig := filepath.Join(root, "workflows", "escrow-confirmation", "config.staging.json")
	if got := readJSONField(t, escrowConfig, "confirmationConsumerAddress"); got != "0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" {
		t.Errorf("confirmationConsumerAddress = %s", got)
	}

	complianceConfig := filepath.Join(root, "workflows", "compliance-check", "config.staging.json")
	if got := readJSONField(t, complianceConfig, "consumerAddress"); got != "0xBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB" {
		t.Errorf("consumerAddress = %s", got)
	}
}

func TestRun_LeavesNonDeploymentFieldsUntouched(t *testing.T) {
	root := setupFakeRepo(t)

	if err := run(root, "11155111", "staging"); err != nil {
		t.Fatal(err)
	}

	// vaultAddresses and borrower aren't in the deployment record — a real
	// deployment can't know them (per-trade vaults, a specific borrower to
	// monitor) — so they must be left exactly as they were.
	escrowConfig := filepath.Join(root, "workflows", "escrow-confirmation", "config.staging.json")
	raw, _ := os.ReadFile(escrowConfig)
	var m map[string]any
	json.Unmarshal(raw, &m)
	vaults := m["vaultAddresses"].([]any)
	if vaults[0] != "0x0000000000000000000000000000000000000000" {
		t.Errorf("vaultAddresses was touched: %v", vaults)
	}

	liqConfig := filepath.Join(root, "workflows", "liquidation-protection", "config.staging.json")
	if got := readJSONField(t, liqConfig, "borrower"); got != "0x0000000000000000000000000000000000000000" {
		t.Errorf("borrower was touched: %s", got)
	}
}

func TestRun_SkipsFieldsWithNoDeployedAddress(t *testing.T) {
	root := setupFakeRepo(t)

	if err := run(root, "11155111", "staging"); err != nil {
		t.Fatal(err)
	}

	// lendingOracleConsumer/liquidationConsumer/lendingPool are empty in the
	// fixture (lending wasn't deployed) — liquidation-protection's config must
	// be left at its placeholder, not overwritten with an empty string.
	liqConfig := filepath.Join(root, "workflows", "liquidation-protection", "config.staging.json")
	if got := readJSONField(t, liqConfig, "lendingPoolAddress"); got != "0x0000000000000000000000000000000000000000" {
		t.Errorf("lendingPoolAddress = %s, want the untouched placeholder", got)
	}
	if got := readJSONField(t, liqConfig, "consumerAddress"); got != "0x0000000000000000000000000000000000000000" {
		t.Errorf("consumerAddress = %s, want the untouched placeholder", got)
	}
}

func TestRun_WiresLendingWhenDeployed(t *testing.T) {
	root := setupFakeRepo(t)
	writeFile(t, filepath.Join(root, "contracts", "evm", "deployments", "11155111.json"), `{
  "escrowConfirmationConsumer": "0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
  "complianceConsumer": "0xBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
  "escrowFactory": "0xCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC",
  "marketplace": "0xDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD",
  "lendingOracleConsumer": "0xEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEE",
  "liquidationConsumer": "0xF0F0F0F0F0F0F0F0F0F0F0F0F0F0F0F0F0F0F0F0",
  "lendingPool": "0x1234123412341234123412341234123412341234"
}
`)

	if err := run(root, "11155111", "staging"); err != nil {
		t.Fatal(err)
	}

	liqConfig := filepath.Join(root, "workflows", "liquidation-protection", "config.staging.json")
	if got := readJSONField(t, liqConfig, "lendingPoolAddress"); got != "0x1234123412341234123412341234123412341234" {
		t.Errorf("lendingPoolAddress = %s", got)
	}
	if got := readJSONField(t, liqConfig, "consumerAddress"); got != "0xF0F0F0F0F0F0F0F0F0F0F0F0F0F0F0F0F0F0F0F0" {
		t.Errorf("consumerAddress = %s", got)
	}
}

func TestRun_ErrorsIfDeploymentsFileMissing(t *testing.T) {
	root := setupFakeRepo(t)
	if err := run(root, "1", "staging"); err == nil {
		t.Fatal("expected an error for a chain ID with no deployment record")
	}
}

func TestRun_TargetSelectsCorrectConfigFile(t *testing.T) {
	root := setupFakeRepo(t)
	// A real repo ships config.production.json for every workflow; mirror that
	// here so this run() call has one to wire for each.
	writeFile(t, filepath.Join(root, "workflows", "escrow-confirmation", "config.production.json"), `{
  "confirmationConsumerAddress": "0x0000000000000000000000000000000000000000"
}
`)
	writeFile(t, filepath.Join(root, "workflows", "compliance-check", "config.production.json"), `{
  "consumerAddress": "0x0000000000000000000000000000000000000000"
}
`)
	writeFile(t, filepath.Join(root, "workflows", "liquidation-protection", "config.production.json"), `{
  "lendingPoolAddress": "0x0000000000000000000000000000000000000000",
  "consumerAddress": "0x0000000000000000000000000000000000000000"
}
`)

	if err := run(root, "11155111", "production"); err != nil {
		t.Fatal(err)
	}

	prodConfig := filepath.Join(root, "workflows", "escrow-confirmation", "config.production.json")
	if got := readJSONField(t, prodConfig, "confirmationConsumerAddress"); got != "0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" {
		t.Errorf("production config not wired: %s", got)
	}

	stagingConfig := filepath.Join(root, "workflows", "escrow-confirmation", "config.staging.json")
	if got := readJSONField(t, stagingConfig, "confirmationConsumerAddress"); got != "0x0000000000000000000000000000000000000000" {
		t.Errorf("staging config should have been untouched by a production run: %s", got)
	}
}
