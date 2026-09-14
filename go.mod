module deeds-cre-workflows

go 1.25.3

// Pinned to the same cre-sdk-go version as benn-cre (../cre-cli/benn-cre), which
// has Confidential Workflows support (cre.HandlerInTee / cre.TeeRuntime) verified
// working against the CRE CLI in this environment.
require (
	github.com/ethereum/go-ethereum v1.17.2
	github.com/smartcontractkit/cre-sdk-go v1.18.0
	github.com/smartcontractkit/cre-sdk-go/capabilities/networking/http v1.4.1-0.20260806122424-24d22c8dc5bd
	github.com/smartcontractkit/cre-sdk-go/capabilities/scheduler/cron v1.3.1-0.20260806122424-24d22c8dc5bd
	github.com/stretchr/testify v1.11.1
)

require github.com/smartcontractkit/cre-sdk-go/capabilities/blockchain/evm v1.0.0-beta.15.0.20260806122424-24d22c8dc5bd
