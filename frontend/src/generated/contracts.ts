//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// ComplianceConsumer
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

export const complianceConsumerAbi = [
  {
    type: 'constructor',
    inputs: [
      { name: '_forwarder', internalType: 'address', type: 'address' },
      { name: '_maxValidity', internalType: 'uint256', type: 'uint256' },
    ],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'MAX_TIER',
    outputs: [{ name: '', internalType: 'uint8', type: 'uint8' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'forwarder',
    outputs: [{ name: '', internalType: 'address', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'maxValidity',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: '', internalType: 'bytes', type: 'bytes' },
      { name: 'report', internalType: 'bytes', type: 'bytes' },
    ],
    name: 'onReport',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [{ name: 'interfaceId', internalType: 'bytes4', type: 'bytes4' }],
    name: 'supportsInterface',
    outputs: [{ name: '', internalType: 'bool', type: 'bool' }],
    stateMutability: 'pure',
  },
  {
    type: 'function',
    inputs: [{ name: 'subject', internalType: 'address', type: 'address' }],
    name: 'tierOf',
    outputs: [{ name: '', internalType: 'uint8', type: 'uint8' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: 'subject', internalType: 'address', type: 'address' }],
    name: 'verifiedAt',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'subject',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      { name: 'tier', internalType: 'uint8', type: 'uint8', indexed: false },
      {
        name: 'verifiedAt',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
    ],
    name: 'ComplianceUpdated',
  },
  {
    type: 'error',
    inputs: [
      { name: 'subject', internalType: 'address', type: 'address' },
      { name: 'verifiedAt', internalType: 'uint256', type: 'uint256' },
      { name: 'blockTimestamp', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'FutureVerifiedAt',
  },
  {
    type: 'error',
    inputs: [{ name: 'tier', internalType: 'uint8', type: 'uint8' }],
    name: 'InvalidTier',
  },
  {
    type: 'error',
    inputs: [
      { name: 'subject', internalType: 'address', type: 'address' },
      { name: 'incomingVerifiedAt', internalType: 'uint256', type: 'uint256' },
      { name: 'storedVerifiedAt', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'StaleReport',
  },
  {
    type: 'error',
    inputs: [{ name: 'caller', internalType: 'address', type: 'address' }],
    name: 'UnauthorizedForwarder',
  },
  { type: 'error', inputs: [], name: 'ZeroAddress' },
] as const

//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// EscrowFactory
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

export const escrowFactoryAbi = [
  {
    type: 'constructor',
    inputs: [
      {
        name: '_confirmationConsumer',
        internalType: 'contract EscrowConfirmationConsumer',
        type: 'address',
      },
      {
        name: '_complianceConsumer',
        internalType: 'contract ComplianceConsumer',
        type: 'address',
      },
      { name: '_tier0CapUsd', internalType: 'uint256', type: 'uint256' },
      { name: '_tier1CapUsd', internalType: 'uint256', type: 'uint256' },
    ],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'VOLUME_WINDOW',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    name: 'allVaults',
    outputs: [{ name: '', internalType: 'address', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'complianceConsumer',
    outputs: [
      {
        name: '',
        internalType: 'contract ComplianceConsumer',
        type: 'address',
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'confirmationConsumer',
    outputs: [
      {
        name: '',
        internalType: 'contract EscrowConfirmationConsumer',
        type: 'address',
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'seller', internalType: 'address', type: 'address' },
      { name: 'arbiter', internalType: 'address', type: 'address' },
      { name: 'token', internalType: 'contract IERC20', type: 'address' },
      { name: 'bondAmount', internalType: 'uint256', type: 'uint256' },
      {
        name: 'milestoneAmounts',
        internalType: 'uint256[]',
        type: 'uint256[]',
      },
    ],
    name: 'createTrade',
    outputs: [{ name: 'vault', internalType: 'address', type: 'address' }],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [
      { name: 'buyer', internalType: 'address', type: 'address' },
      { name: 'seller', internalType: 'address', type: 'address' },
      { name: 'arbiter', internalType: 'address', type: 'address' },
      { name: 'token', internalType: 'contract IERC20', type: 'address' },
      { name: 'bondAmount', internalType: 'uint256', type: 'uint256' },
      {
        name: 'milestoneAmounts',
        internalType: 'uint256[]',
        type: 'uint256[]',
      },
    ],
    name: 'createTradeFor',
    outputs: [{ name: 'vault', internalType: 'address', type: 'address' }],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [{ name: 'buyer', internalType: 'address', type: 'address' }],
    name: 'currentPeriodVolume',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: '', internalType: 'address', type: 'address' }],
    name: 'isVault',
    outputs: [{ name: '', internalType: 'bool', type: 'bool' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'buyer', internalType: 'address', type: 'address' },
      { name: 'amount', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'recordVolume',
    outputs: [
      { name: 'periodVolume', internalType: 'uint256', type: 'uint256' },
    ],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'tier0CapUsd',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'tier1CapUsd',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'vaultCount',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: '', internalType: 'address', type: 'address' },
      { name: '', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'vaultsByBuyer',
    outputs: [{ name: '', internalType: 'address', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: '', internalType: 'address', type: 'address' },
      { name: '', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'vaultsBySeller',
    outputs: [{ name: '', internalType: 'address', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'vault',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'buyer',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'seller',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'arbiter',
        internalType: 'address',
        type: 'address',
        indexed: false,
      },
      {
        name: 'token',
        internalType: 'address',
        type: 'address',
        indexed: false,
      },
      {
        name: 'bondAmount',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
    ],
    name: 'VaultCreated',
  },
  {
    type: 'error',
    inputs: [
      { name: 'tier0CapUsd', internalType: 'uint256', type: 'uint256' },
      { name: 'tier1CapUsd', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'InvalidTierCaps',
  },
  {
    type: 'error',
    inputs: [{ name: 'caller', internalType: 'address', type: 'address' }],
    name: 'NotAVault',
  },
  { type: 'error', inputs: [], name: 'ZeroAddress' },
] as const

//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// EscrowVault
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

export const escrowVaultAbi = [
  {
    type: 'constructor',
    inputs: [
      { name: '_buyer', internalType: 'address', type: 'address' },
      { name: '_seller', internalType: 'address', type: 'address' },
      { name: '_arbiter', internalType: 'address', type: 'address' },
      { name: '_token', internalType: 'contract IERC20', type: 'address' },
      { name: '_bondAmount', internalType: 'uint256', type: 'uint256' },
      {
        name: '_milestoneAmounts',
        internalType: 'uint256[]',
        type: 'uint256[]',
      },
      { name: '_tier0Cap', internalType: 'uint256', type: 'uint256' },
      { name: '_tier1Cap', internalType: 'uint256', type: 'uint256' },
      {
        name: '_confirmationConsumer',
        internalType: 'contract EscrowConfirmationConsumer',
        type: 'address',
      },
      {
        name: '_complianceConsumer',
        internalType: 'contract ComplianceConsumer',
        type: 'address',
      },
    ],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'arbiter',
    outputs: [{ name: '', internalType: 'address', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'bondAmount',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'bondBalance',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'bondDeposited',
    outputs: [{ name: '', internalType: 'bool', type: 'bool' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'buyer',
    outputs: [{ name: '', internalType: 'address', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'complianceConsumer',
    outputs: [
      {
        name: '',
        internalType: 'contract ComplianceConsumer',
        type: 'address',
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: 'index', internalType: 'uint256', type: 'uint256' }],
    name: 'confirmMilestone',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'confirmationConsumer',
    outputs: [
      {
        name: '',
        internalType: 'contract EscrowConfirmationConsumer',
        type: 'address',
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'depositBond',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [
      { name: 'index', internalType: 'uint256', type: 'uint256' },
      { name: 'reason', internalType: 'string', type: 'string' },
    ],
    name: 'disputeMilestone',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'factory',
    outputs: [
      { name: '', internalType: 'contract IEscrowFactory', type: 'address' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'fund',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'funded',
    outputs: [{ name: '', internalType: 'bool', type: 'bool' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'milestoneCount',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    name: 'milestones',
    outputs: [
      { name: 'amount', internalType: 'uint256', type: 'uint256' },
      {
        name: 'status',
        internalType: 'enum EscrowVault.MilestoneStatus',
        type: 'uint8',
      },
      { name: 'docHash', internalType: 'bytes32', type: 'bytes32' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: 'index', internalType: 'uint256', type: 'uint256' }],
    name: 'releaseMilestoneViaDon',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [
      { name: 'index', internalType: 'uint256', type: 'uint256' },
      { name: 'releaseToSeller', internalType: 'bool', type: 'bool' },
    ],
    name: 'resolveDispute',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'seller',
    outputs: [{ name: '', internalType: 'address', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: 'to', internalType: 'address', type: 'address' }],
    name: 'slashBond',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [
      { name: 'index', internalType: 'uint256', type: 'uint256' },
      { name: 'docHash', internalType: 'bytes32', type: 'bytes32' },
    ],
    name: 'submitMilestoneDocs',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'tier0Cap',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'tier1Cap',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'token',
    outputs: [{ name: '', internalType: 'contract IERC20', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'totalAmount',
    outputs: [{ name: 'total', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'amount',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
    ],
    name: 'BondDeposited',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'amount',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
    ],
    name: 'BondReturned',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      { name: 'to', internalType: 'address', type: 'address', indexed: true },
      {
        name: 'amount',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
    ],
    name: 'BondSlashed',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'milestoneIndex',
        internalType: 'uint256',
        type: 'uint256',
        indexed: true,
      },
      {
        name: 'releasedToSeller',
        internalType: 'bool',
        type: 'bool',
        indexed: false,
      },
    ],
    name: 'DisputeResolved',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'milestoneIndex',
        internalType: 'uint256',
        type: 'uint256',
        indexed: true,
      },
      {
        name: 'raisedBy',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'reason',
        internalType: 'string',
        type: 'string',
        indexed: false,
      },
    ],
    name: 'Disputed',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'milestoneIndex',
        internalType: 'uint256',
        type: 'uint256',
        indexed: true,
      },
      {
        name: 'docHash',
        internalType: 'bytes32',
        type: 'bytes32',
        indexed: false,
      },
    ],
    name: 'DocsSubmitted',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'totalAmount',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
    ],
    name: 'Funded',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'milestoneIndex',
        internalType: 'uint256',
        type: 'uint256',
        indexed: true,
      },
      { name: 'viaDon', internalType: 'bool', type: 'bool', indexed: false },
    ],
    name: 'MilestoneReleased',
  },
  { type: 'error', inputs: [], name: 'AlreadyFunded' },
  {
    type: 'error',
    inputs: [{ name: 'arbiter', internalType: 'address', type: 'address' }],
    name: 'ArbiterConflict',
  },
  { type: 'error', inputs: [], name: 'BondAlreadyDeposited' },
  { type: 'error', inputs: [], name: 'BondNotDeposited' },
  {
    type: 'error',
    inputs: [
      { name: 'buyer', internalType: 'address', type: 'address' },
      { name: 'periodVolume', internalType: 'uint256', type: 'uint256' },
      { name: 'cap', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'ComplianceRequired',
  },
  {
    type: 'error',
    inputs: [{ name: 'index', internalType: 'uint256', type: 'uint256' }],
    name: 'DonNotConfirmed',
  },
  {
    type: 'error',
    inputs: [{ name: 'index', internalType: 'uint256', type: 'uint256' }],
    name: 'InvalidMilestoneIndex',
  },
  {
    type: 'error',
    inputs: [
      { name: 'index', internalType: 'uint256', type: 'uint256' },
      {
        name: 'actual',
        internalType: 'enum EscrowVault.MilestoneStatus',
        type: 'uint8',
      },
    ],
    name: 'InvalidMilestoneStatus',
  },
  { type: 'error', inputs: [], name: 'NoMilestones' },
  {
    type: 'error',
    inputs: [{ name: 'caller', internalType: 'address', type: 'address' }],
    name: 'NotArbiter',
  },
  {
    type: 'error',
    inputs: [{ name: 'caller', internalType: 'address', type: 'address' }],
    name: 'NotBuyer',
  },
  { type: 'error', inputs: [], name: 'NotFunded' },
  {
    type: 'error',
    inputs: [{ name: 'caller', internalType: 'address', type: 'address' }],
    name: 'NotPartyToTrade',
  },
  {
    type: 'error',
    inputs: [{ name: 'caller', internalType: 'address', type: 'address' }],
    name: 'NotSeller',
  },
  { type: 'error', inputs: [], name: 'TransferFailed' },
  { type: 'error', inputs: [], name: 'ZeroAddress' },
] as const

//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// Marketplace
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

export const marketplaceAbi = [
  {
    type: 'constructor',
    inputs: [
      {
        name: '_factory',
        internalType: 'contract EscrowFactory',
        type: 'address',
      },
    ],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [{ name: 'listingId', internalType: 'uint256', type: 'uint256' }],
    name: 'cancelListing',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [
      { name: 'token', internalType: 'contract IERC20', type: 'address' },
      { name: 'bondAmount', internalType: 'uint256', type: 'uint256' },
      {
        name: 'milestoneAmounts',
        internalType: 'uint256[]',
        type: 'uint256[]',
      },
      { name: 'arbiter', internalType: 'address', type: 'address' },
      { name: 'metadataURI', internalType: 'string', type: 'string' },
    ],
    name: 'createListing',
    outputs: [{ name: 'listingId', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'factory',
    outputs: [
      { name: '', internalType: 'contract EscrowFactory', type: 'address' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'listingCount',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: 'listingId', internalType: 'uint256', type: 'uint256' }],
    name: 'listingMilestones',
    outputs: [{ name: '', internalType: 'uint256[]', type: 'uint256[]' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: 'listingId', internalType: 'uint256', type: 'uint256' }],
    name: 'listingTotalAmount',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: 'listingId', internalType: 'uint256', type: 'uint256' }],
    name: 'listings',
    outputs: [
      { name: 'seller', internalType: 'address', type: 'address' },
      { name: 'arbiter', internalType: 'address', type: 'address' },
      { name: 'token', internalType: 'contract IERC20', type: 'address' },
      { name: 'bondAmount', internalType: 'uint256', type: 'uint256' },
      { name: 'metadataURI', internalType: 'string', type: 'string' },
      {
        name: 'status',
        internalType: 'enum Marketplace.ListingStatus',
        type: 'uint8',
      },
      { name: 'vault', internalType: 'address', type: 'address' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: 'listingId', internalType: 'uint256', type: 'uint256' }],
    name: 'purchase',
    outputs: [{ name: 'vault', internalType: 'address', type: 'address' }],
    stateMutability: 'nonpayable',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'listingId',
        internalType: 'uint256',
        type: 'uint256',
        indexed: true,
      },
    ],
    name: 'ListingCancelled',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'listingId',
        internalType: 'uint256',
        type: 'uint256',
        indexed: true,
      },
      {
        name: 'seller',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'token',
        internalType: 'address',
        type: 'address',
        indexed: false,
      },
      {
        name: 'bondAmount',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
      {
        name: 'totalAmount',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
      {
        name: 'metadataURI',
        internalType: 'string',
        type: 'string',
        indexed: false,
      },
    ],
    name: 'ListingCreated',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'listingId',
        internalType: 'uint256',
        type: 'uint256',
        indexed: true,
      },
      {
        name: 'buyer',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'vault',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
    ],
    name: 'ListingPurchased',
  },
  {
    type: 'error',
    inputs: [{ name: 'listingId', internalType: 'uint256', type: 'uint256' }],
    name: 'InvalidListingId',
  },
  {
    type: 'error',
    inputs: [
      { name: 'listingId', internalType: 'uint256', type: 'uint256' },
      {
        name: 'actual',
        internalType: 'enum Marketplace.ListingStatus',
        type: 'uint8',
      },
    ],
    name: 'ListingNotActive',
  },
  { type: 'error', inputs: [], name: 'NoMilestones' },
  {
    type: 'error',
    inputs: [{ name: 'caller', internalType: 'address', type: 'address' }],
    name: 'NotSeller',
  },
  { type: 'error', inputs: [], name: 'ZeroAddress' },
] as const
