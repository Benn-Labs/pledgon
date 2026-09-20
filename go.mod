module pledgon-cre-workflows

go 1.25.3

// Pinned to the same cre-sdk-go version as benn-cre (../cre-cli/benn-cre), which
// has Confidential Workflows support (cre.HandlerInTee / cre.TeeRuntime) verified
// working against the CRE CLI in this environment.
require (
	github.com/ethereum/go-ethereum v1.17.2
	github.com/smartcontractkit/cre-sdk-go v1.18.0
	github.com/smartcontractkit/cre-sdk-go/capabilities/networking/http v1.4.1-0.20260806122424-24d22c8dc5bd
	github.com/stretchr/testify v1.11.1
)

require (
	github.com/smartcontractkit/cre-sdk-go/capabilities/blockchain/evm v1.0.0-beta.15.0.20260806122424-24d22c8dc5bd
	github.com/smartcontractkit/cre-sdk-go/capabilities/scheduler/cron v1.3.1-0.20260806122424-24d22c8dc5bd
)

require (
	github.com/ProjectZKM/Ziren/crates/go-runtime/zkvm_runtime v0.0.0-20251001021608-1fe7b43fc4d6 // indirect
	github.com/davecgh/go-spew v1.1.2-0.20180830191138-d8f796af33cc // indirect
	github.com/decred/dcrd/dcrec/secp256k1/v4 v4.0.1 // indirect
	github.com/go-viper/mapstructure/v2 v2.4.0 // indirect
	github.com/holiman/uint256 v1.3.2 // indirect
	github.com/pmezard/go-difflib v1.0.1-0.20181226105442-5d4384ee4fb2 // indirect
	github.com/shopspring/decimal v1.4.0 // indirect
	github.com/smartcontractkit/chainlink-protos/cre/go v0.0.0-20260804200254-c1accce563a8 // indirect
	golang.org/x/sys v0.41.0 // indirect
	google.golang.org/protobuf v1.36.11 // indirect
	gopkg.in/yaml.v3 v3.0.1 // indirect
)
