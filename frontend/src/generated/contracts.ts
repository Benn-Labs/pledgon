//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// ArbitratorRegistry
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

export const arbitratorRegistryAbi = [
  {
    type: 'constructor',
    inputs: [{ name: '_owner', internalType: 'address', type: 'address' }],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [{ name: 'arbitrator', internalType: 'address', type: 'address' }],
    name: 'accredit',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'accreditedCount',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    name: 'allAccredited',
    outputs: [{ name: '', internalType: 'address', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: 'arbitrator', internalType: 'address', type: 'address' }],
    name: 'isAccredited',
    outputs: [{ name: '', internalType: 'bool', type: 'bool' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'owner',
    outputs: [{ name: '', internalType: 'address', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: 'arbitrator', internalType: 'address', type: 'address' }],
    name: 'revoke',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [{ name: 'newOwner', internalType: 'address', type: 'address' }],
    name: 'transferOwnership',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'arbitrator',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
    ],
    name: 'ArbitratorAccredited',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'arbitrator',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
    ],
    name: 'ArbitratorRevoked',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'previousOwner',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'newOwner',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
    ],
    name: 'OwnershipTransferred',
  },
  {
    type: 'error',
    inputs: [{ name: 'caller', internalType: 'address', type: 'address' }],
    name: 'NotOwner',
  },
  { type: 'error', inputs: [], name: 'ZeroAddress' },
] as const

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
      {
        name: '_arbitratorRegistry',
        internalType: 'contract ArbitratorRegistry',
        type: 'address',
      },
      { name: '_defaultArbiter', internalType: 'address', type: 'address' },
      { name: '_owner', internalType: 'address', type: 'address' },
      { name: '_feeRecipient', internalType: 'address', type: 'address' },
      { name: '_vaultCreationFee', internalType: 'uint256', type: 'uint256' },
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
    name: 'arbitratorRegistry',
    outputs: [
      {
        name: '',
        internalType: 'contract ArbitratorRegistry',
        type: 'address',
      },
    ],
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
      { name: 'fundingWindow', internalType: 'uint256', type: 'uint256' },
      {
        name: 'milestoneConfirmWindow',
        internalType: 'uint256',
        type: 'uint256',
      },
      { name: 'deliveryWindow', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'createTrade',
    outputs: [{ name: 'vault', internalType: 'address', type: 'address' }],
    stateMutability: 'payable',
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
      { name: 'fundingWindow', internalType: 'uint256', type: 'uint256' },
      {
        name: 'milestoneConfirmWindow',
        internalType: 'uint256',
        type: 'uint256',
      },
      { name: 'deliveryWindow', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'createTradeFor',
    outputs: [{ name: 'vault', internalType: 'address', type: 'address' }],
    stateMutability: 'payable',
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
    inputs: [],
    name: 'defaultArbiter',
    outputs: [{ name: '', internalType: 'address', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'feeRecipient',
    outputs: [{ name: '', internalType: 'address', type: 'address' }],
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
    inputs: [],
    name: 'owner',
    outputs: [{ name: '', internalType: 'address', type: 'address' }],
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
    inputs: [
      { name: 'newRecipient', internalType: 'address', type: 'address' },
    ],
    name: 'setFeeRecipient',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [{ name: 'newFee', internalType: 'uint256', type: 'uint256' }],
    name: 'setVaultCreationFee',
    outputs: [],
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
    inputs: [{ name: 'newOwner', internalType: 'address', type: 'address' }],
    name: 'transferOwnership',
    outputs: [],
    stateMutability: 'nonpayable',
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
    inputs: [],
    name: 'vaultCreationFee',
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
    type: 'function',
    inputs: [],
    name: 'withdrawFees',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'previousRecipient',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'newRecipient',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
    ],
    name: 'FeeRecipientUpdated',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'recipient',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'amount',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
    ],
    name: 'FeesWithdrawn',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'previousOwner',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'newOwner',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
    ],
    name: 'OwnershipTransferred',
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
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'previousFee',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
      {
        name: 'newFee',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
    ],
    name: 'VaultCreationFeeUpdated',
  },
  { type: 'error', inputs: [], name: 'FeeTransferFailed' },
  {
    type: 'error',
    inputs: [
      { name: 'sent', internalType: 'uint256', type: 'uint256' },
      { name: 'required', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'IncorrectFeeAmount',
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
  {
    type: 'error',
    inputs: [{ name: 'arbiter', internalType: 'address', type: 'address' }],
    name: 'NotAccreditedArbiter',
  },
  {
    type: 'error',
    inputs: [{ name: 'caller', internalType: 'address', type: 'address' }],
    name: 'NotOwner',
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
      { name: '_fundingWindow', internalType: 'uint256', type: 'uint256' },
      {
        name: '_milestoneConfirmWindow',
        internalType: 'uint256',
        type: 'uint256',
      },
      { name: '_deliveryWindow', internalType: 'uint256', type: 'uint256' },
    ],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'BPS_DENOMINATOR',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: 'index', internalType: 'uint256', type: 'uint256' }],
    name: 'acceptSettlement',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'acceptTradeExit',
    outputs: [],
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
    inputs: [{ name: 'index', internalType: 'uint256', type: 'uint256' }],
    name: 'cancelSettlementProposal',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'cancelTrade',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'cancelTradeExitProposal',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'cancelled',
    outputs: [{ name: '', internalType: 'bool', type: 'bool' }],
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
    inputs: [{ name: 'index', internalType: 'uint256', type: 'uint256' }],
    name: 'deliveryDeadline',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'deliveryWindow',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
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
    inputs: [{ name: 'index', internalType: 'uint256', type: 'uint256' }],
    name: 'expireDelivery',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'expireFunding',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [{ name: 'index', internalType: 'uint256', type: 'uint256' }],
    name: 'expireMilestone',
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
    name: 'fundedAt',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'fundingDeadline',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'milestoneConfirmWindow',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
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
    inputs: [{ name: 'index', internalType: 'uint256', type: 'uint256' }],
    name: 'milestoneDeadline',
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
      { name: 'docsSubmittedAt', internalType: 'uint256', type: 'uint256' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'index', internalType: 'uint256', type: 'uint256' },
      { name: 'sellerBps', internalType: 'uint16', type: 'uint16' },
    ],
    name: 'proposeSettlement',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'proposeTradeExit',
    outputs: [],
    stateMutability: 'nonpayable',
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
      { name: 'sellerBps', internalType: 'uint16', type: 'uint16' },
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
    inputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    name: 'settlementProposals',
    outputs: [
      { name: 'sellerBps', internalType: 'uint16', type: 'uint16' },
      { name: 'proposedBy', internalType: 'address', type: 'address' },
      { name: 'active', internalType: 'bool', type: 'bool' },
    ],
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
    type: 'function',
    inputs: [],
    name: 'tradeExitProposal',
    outputs: [
      { name: 'proposedBy', internalType: 'address', type: 'address' },
      { name: 'active', internalType: 'bool', type: 'bool' },
    ],
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
        name: 'amountReleased',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
    ],
    name: 'ConfirmationExpired',
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
        name: 'amountRefunded',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
    ],
    name: 'DeliveryExpired',
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
        name: 'sellerBps',
        internalType: 'uint16',
        type: 'uint16',
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
        name: 'bondRefunded',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
    ],
    name: 'FundingExpired',
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
        name: 'sellerBps',
        internalType: 'uint16',
        type: 'uint16',
        indexed: false,
      },
    ],
    name: 'SettlementAccepted',
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
    ],
    name: 'SettlementCancelled',
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
        name: 'proposedBy',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'sellerBps',
        internalType: 'uint16',
        type: 'uint16',
        indexed: false,
      },
    ],
    name: 'SettlementProposed',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'canceledBy',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'bondRefunded',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
    ],
    name: 'TradeCancelled',
  },
  { type: 'event', anonymous: false, inputs: [], name: 'TradeExitCancelled' },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'proposedBy',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
    ],
    name: 'TradeExitProposed',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'buyerRefund',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
      {
        name: 'sellerBondRefund',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
    ],
    name: 'TradeExited',
  },
  { type: 'error', inputs: [], name: 'AlreadyCancelled' },
  { type: 'error', inputs: [], name: 'AlreadyFunded' },
  {
    type: 'error',
    inputs: [{ name: 'arbiter', internalType: 'address', type: 'address' }],
    name: 'ArbiterConflict',
  },
  { type: 'error', inputs: [], name: 'BondAlreadyDeposited' },
  { type: 'error', inputs: [], name: 'BondNotDeposited' },
  { type: 'error', inputs: [], name: 'CannotCancelAfterFunded' },
  {
    type: 'error',
    inputs: [
      { name: 'buyer', internalType: 'address', type: 'address' },
      { name: 'periodVolume', internalType: 'uint256', type: 'uint256' },
      { name: 'cap', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'ComplianceRequired',
  },
  { type: 'error', inputs: [], name: 'DeliveryNotYetExpired' },
  {
    type: 'error',
    inputs: [{ name: 'index', internalType: 'uint256', type: 'uint256' }],
    name: 'DonNotConfirmed',
  },
  { type: 'error', inputs: [], name: 'FundingDeadlinePassed' },
  { type: 'error', inputs: [], name: 'FundingNotYetExpired' },
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
  {
    type: 'error',
    inputs: [{ name: 'sellerBps', internalType: 'uint16', type: 'uint16' }],
    name: 'InvalidSplit',
  },
  { type: 'error', inputs: [], name: 'MilestoneNotYetExpired' },
  { type: 'error', inputs: [], name: 'NoActiveExitProposal' },
  {
    type: 'error',
    inputs: [{ name: 'index', internalType: 'uint256', type: 'uint256' }],
    name: 'NoActiveProposal',
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
  {
    type: 'error',
    inputs: [{ name: 'caller', internalType: 'address', type: 'address' }],
    name: 'NotCounterparty',
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
  { type: 'error', inputs: [], name: 'TradeAlreadySettled' },
  { type: 'error', inputs: [], name: 'TransferFailed' },
  { type: 'error', inputs: [], name: 'ZeroAddress' },
] as const

//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// LendingOracleConsumer
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

export const lendingOracleConsumerAbi = [
  {
    type: 'constructor',
    inputs: [{ name: '_forwarder', internalType: 'address', type: 'address' }],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [{ name: 'label', internalType: 'string', type: 'string' }],
    name: 'feedIdFor',
    outputs: [{ name: '', internalType: 'bytes32', type: 'bytes32' }],
    stateMutability: 'pure',
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
    inputs: [{ name: 'feedId', internalType: 'bytes32', type: 'bytes32' }],
    name: 'latestRound',
    outputs: [
      { name: 'value', internalType: 'uint256', type: 'uint256' },
      { name: 'decimals', internalType: 'uint8', type: 'uint8' },
      { name: 'updatedAt', internalType: 'uint256', type: 'uint256' },
    ],
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
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'feedId',
        internalType: 'bytes32',
        type: 'bytes32',
        indexed: true,
      },
      {
        name: 'value',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
      {
        name: 'decimals',
        internalType: 'uint8',
        type: 'uint8',
        indexed: false,
      },
      {
        name: 'updatedAt',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
    ],
    name: 'PriceUpdated',
  },
  {
    type: 'error',
    inputs: [
      { name: 'feedId', internalType: 'bytes32', type: 'bytes32' },
      { name: 'incomingUpdatedAt', internalType: 'uint256', type: 'uint256' },
      { name: 'storedUpdatedAt', internalType: 'uint256', type: 'uint256' },
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
// LendingPool
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

export const lendingPoolAbi = [
  {
    type: 'constructor',
    inputs: [
      {
        name: '_collateralToken',
        internalType: 'contract IERC20',
        type: 'address',
      },
      { name: '_debtToken', internalType: 'contract IERC20', type: 'address' },
      {
        name: '_oracleConsumer',
        internalType: 'contract LendingOracleConsumer',
        type: 'address',
      },
      {
        name: '_liquidationConsumer',
        internalType: 'contract LiquidationConsumer',
        type: 'address',
      },
      { name: '_collateralFeedId', internalType: 'bytes32', type: 'bytes32' },
      {
        name: '_liquidationThresholdBps',
        internalType: 'uint256',
        type: 'uint256',
      },
      { name: '_borrowRateBps', internalType: 'uint256', type: 'uint256' },
    ],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'BPS_DENOMINATOR',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'SECONDS_PER_YEAR',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: 'amount', internalType: 'uint256', type: 'uint256' }],
    name: 'borrow',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'borrowIndex',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'borrowRateBps',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'collateralFeedId',
    outputs: [{ name: '', internalType: 'bytes32', type: 'bytes32' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'collateralToken',
    outputs: [{ name: '', internalType: 'contract IERC20', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'collateralAmount', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'collateralValueInDebtUnits',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'debtToken',
    outputs: [{ name: '', internalType: 'contract IERC20', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: 'amount', internalType: 'uint256', type: 'uint256' }],
    name: 'depositCollateral',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [{ name: 'amount', internalType: 'uint256', type: 'uint256' }],
    name: 'depositLiquidity',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [{ name: 'borrower', internalType: 'address', type: 'address' }],
    name: 'isUndercollateralized',
    outputs: [{ name: '', internalType: 'bool', type: 'bool' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'lastAccrualTimestamp',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: 'lender', internalType: 'address', type: 'address' }],
    name: 'lenderBalance',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: '', internalType: 'address', type: 'address' }],
    name: 'lenderShares',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: 'borrower', internalType: 'address', type: 'address' }],
    name: 'liquidate',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'liquidationConsumer',
    outputs: [
      {
        name: '',
        internalType: 'contract LiquidationConsumer',
        type: 'address',
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'liquidationThresholdBps',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'oracleConsumer',
    outputs: [
      {
        name: '',
        internalType: 'contract LendingOracleConsumer',
        type: 'address',
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: 'borrower', internalType: 'address', type: 'address' }],
    name: 'positions',
    outputs: [
      { name: 'collateralAmount', internalType: 'uint256', type: 'uint256' },
      { name: 'debtAmount', internalType: 'uint256', type: 'uint256' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: 'amount', internalType: 'uint256', type: 'uint256' }],
    name: 'repay',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'totalBorrows',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'totalShares',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'totalSupply',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: 'amount', internalType: 'uint256', type: 'uint256' }],
    name: 'withdrawCollateral',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [{ name: 'shares', internalType: 'uint256', type: 'uint256' }],
    name: 'withdrawLiquidity',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'borrower',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'amount',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
    ],
    name: 'Borrowed',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'borrower',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'amount',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
    ],
    name: 'CollateralDeposited',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'borrower',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'amount',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
    ],
    name: 'CollateralWithdrawn',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'borrower',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'liquidator',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'collateralSeized',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
      {
        name: 'debtRepaid',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
    ],
    name: 'Liquidated',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'lender',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'amount',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
      {
        name: 'shares',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
    ],
    name: 'LiquidityDeposited',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'lender',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'shares',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
      {
        name: 'amount',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
    ],
    name: 'LiquidityWithdrawn',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'borrower',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'amount',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
    ],
    name: 'Repaid',
  },
  {
    type: 'error',
    inputs: [
      { name: 'borrower', internalType: 'address', type: 'address' },
      { name: 'requested', internalType: 'uint256', type: 'uint256' },
      { name: 'available', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'InsufficientCollateral',
  },
  {
    type: 'error',
    inputs: [
      { name: 'requested', internalType: 'uint256', type: 'uint256' },
      { name: 'available', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'InsufficientLiquidity',
  },
  {
    type: 'error',
    inputs: [
      { name: 'lender', internalType: 'address', type: 'address' },
      { name: 'requested', internalType: 'uint256', type: 'uint256' },
      { name: 'available', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'InsufficientShares',
  },
  {
    type: 'error',
    inputs: [{ name: 'borrower', internalType: 'address', type: 'address' }],
    name: 'NoDebt',
  },
  {
    type: 'error',
    inputs: [{ name: 'borrower', internalType: 'address', type: 'address' }],
    name: 'PositionNotLiquidatable',
  },
  {
    type: 'error',
    inputs: [
      { name: 'borrower', internalType: 'address', type: 'address' },
      { name: 'requested', internalType: 'uint256', type: 'uint256' },
      { name: 'owed', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'RepayExceedsDebt',
  },
  {
    type: 'error',
    inputs: [{ name: 'feedId', internalType: 'bytes32', type: 'bytes32' }],
    name: 'StalePrice',
  },
  { type: 'error', inputs: [], name: 'TransferFailed' },
  {
    type: 'error',
    inputs: [{ name: 'borrower', internalType: 'address', type: 'address' }],
    name: 'WouldBeUndercollateralized',
  },
  { type: 'error', inputs: [], name: 'ZeroAddress' },
  { type: 'error', inputs: [], name: 'ZeroAmount' },
  { type: 'error', inputs: [], name: 'ZeroShares' },
] as const

//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// LiquidationConsumer
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

export const liquidationConsumerAbi = [
  {
    type: 'constructor',
    inputs: [{ name: '_forwarder', internalType: 'address', type: 'address' }],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [{ name: 'borrower', internalType: 'address', type: 'address' }],
    name: 'checkedAt',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
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
    inputs: [{ name: 'borrower', internalType: 'address', type: 'address' }],
    name: 'isEligible',
    outputs: [{ name: '', internalType: 'bool', type: 'bool' }],
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
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'borrower',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      { name: 'eligible', internalType: 'bool', type: 'bool', indexed: false },
      {
        name: 'checkedAt',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
    ],
    name: 'VerdictUpdated',
  },
  {
    type: 'error',
    inputs: [
      { name: 'borrower', internalType: 'address', type: 'address' },
      { name: 'incomingCheckedAt', internalType: 'uint256', type: 'uint256' },
      { name: 'storedCheckedAt', internalType: 'uint256', type: 'uint256' },
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
    inputs: [],
    name: 'BPS_DENOMINATOR',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'QUANTITY_SCALE',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
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
      { name: 'milestoneBps', internalType: 'uint16[]', type: 'uint16[]' },
      { name: 'arbiter', internalType: 'address', type: 'address' },
      { name: 'metadataURI', internalType: 'string', type: 'string' },
      { name: 'totalQuantity', internalType: 'uint256', type: 'uint256' },
      { name: 'unitPrice', internalType: 'uint256', type: 'uint256' },
      { name: 'bondRatePerUnit', internalType: 'uint256', type: 'uint256' },
      { name: 'fundingWindow', internalType: 'uint256', type: 'uint256' },
      {
        name: 'milestoneConfirmWindow',
        internalType: 'uint256',
        type: 'uint256',
      },
      { name: 'deliveryWindow', internalType: 'uint256', type: 'uint256' },
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
    name: 'listingMilestoneBps',
    outputs: [{ name: '', internalType: 'uint16[]', type: 'uint16[]' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: 'listingId', internalType: 'uint256', type: 'uint256' }],
    name: 'listingPricing',
    outputs: [
      { name: 'totalQuantity', internalType: 'uint256', type: 'uint256' },
      { name: 'remainingQuantity', internalType: 'uint256', type: 'uint256' },
      { name: 'unitPrice', internalType: 'uint256', type: 'uint256' },
      { name: 'bondRatePerUnit', internalType: 'uint256', type: 'uint256' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: 'listingId', internalType: 'uint256', type: 'uint256' }],
    name: 'listingVaultCount',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: '', internalType: 'uint256', type: 'uint256' },
      { name: '', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'listingVaults',
    outputs: [{ name: '', internalType: 'address', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: 'listingId', internalType: 'uint256', type: 'uint256' }],
    name: 'listingWindows',
    outputs: [
      { name: 'fundingWindow', internalType: 'uint256', type: 'uint256' },
      {
        name: 'milestoneConfirmWindow',
        internalType: 'uint256',
        type: 'uint256',
      },
      { name: 'deliveryWindow', internalType: 'uint256', type: 'uint256' },
    ],
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
      { name: 'metadataURI', internalType: 'string', type: 'string' },
      {
        name: 'status',
        internalType: 'enum Marketplace.ListingStatus',
        type: 'uint8',
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'listingId', internalType: 'uint256', type: 'uint256' },
      { name: 'quantity', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'previewPurchase',
    outputs: [
      {
        name: 'milestoneAmounts',
        internalType: 'uint256[]',
        type: 'uint256[]',
      },
      { name: 'bondAmount', internalType: 'uint256', type: 'uint256' },
      { name: 'totalAmount', internalType: 'uint256', type: 'uint256' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'listingId', internalType: 'uint256', type: 'uint256' },
      { name: 'quantity', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'purchase',
    outputs: [{ name: 'vault', internalType: 'address', type: 'address' }],
    stateMutability: 'payable',
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
        name: 'totalQuantity',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
      {
        name: 'unitPrice',
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
      {
        name: 'quantity',
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
    ],
    name: 'ListingPurchased',
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
    name: 'ListingSoldOut',
  },
  {
    type: 'error',
    inputs: [{ name: 'sum', internalType: 'uint256', type: 'uint256' }],
    name: 'InvalidBps',
  },
  {
    type: 'error',
    inputs: [{ name: 'listingId', internalType: 'uint256', type: 'uint256' }],
    name: 'InvalidListingId',
  },
  {
    type: 'error',
    inputs: [
      { name: 'requested', internalType: 'uint256', type: 'uint256' },
      { name: 'available', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'InvalidQuantity',
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
