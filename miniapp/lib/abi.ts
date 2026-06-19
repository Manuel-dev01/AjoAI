// Minimal ABIs for the miniapp (full ABIs live in config/abi/, emitted by Foundry).

export const circleAbi = [
  // writes
  { type: "function", name: "join", stateMutability: "nonpayable", inputs: [{ name: "selfProof", type: "bytes" }], outputs: [] },
  { type: "function", name: "contribute", stateMutability: "nonpayable", inputs: [], outputs: [] },
  { type: "function", name: "cure", stateMutability: "nonpayable", inputs: [], outputs: [] },
  { type: "function", name: "start", stateMutability: "nonpayable", inputs: [], outputs: [] },
  { type: "function", name: "dissolve", stateMutability: "nonpayable", inputs: [], outputs: [] },
  // views
  { type: "function", name: "state", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
  { type: "function", name: "currentRound", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "slots", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
  { type: "function", name: "intendedPot", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "contribution", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "deposit", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "token", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "period", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "penaltyBps", stateMutability: "view", inputs: [], outputs: [{ type: "uint16" }] },
  { type: "function", name: "penaltyPool", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "roundsPaid", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "membersLength", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "members", stateMutability: "view", inputs: [{ type: "uint256" }], outputs: [{ type: "address" }] },
  { type: "function", name: "memberIndex", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "organizer", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "recipientOf", stateMutability: "view", inputs: [{ type: "uint256" }], outputs: [{ type: "address" }] },
  { type: "function", name: "hasReceived", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "bool" }] },
  { type: "function", name: "isDelinquent", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "bool" }] },
  { type: "function", name: "everDelinquent", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "bool" }] },
  { type: "function", name: "isMember", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "bool" }] },
  { type: "function", name: "contributedInRound", stateMutability: "view", inputs: [{ type: "uint256" }, { type: "address" }], outputs: [{ type: "bool" }] },
  { type: "function", name: "windowClose", stateMutability: "view", inputs: [{ type: "uint256" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "graceClose", stateMutability: "view", inputs: [{ type: "uint256" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "parkedAmount", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "yieldAdapter", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  // events
  { type: "event", name: "MemberJoined", inputs: [{ name: "member", type: "address", indexed: true }, { name: "deposit", type: "uint256", indexed: false }, { name: "slot", type: "uint256", indexed: false }] },
  { type: "event", name: "Contributed", inputs: [{ name: "member", type: "address", indexed: true }, { name: "round", type: "uint256", indexed: true }, { name: "amount", type: "uint256", indexed: false }, { name: "late", type: "bool", indexed: false }] },
  { type: "event", name: "LatePaid", inputs: [{ name: "member", type: "address", indexed: true }, { name: "round", type: "uint256", indexed: true }, { name: "penalty", type: "uint256", indexed: false }] },
  { type: "event", name: "Delinquent", inputs: [{ name: "member", type: "address", indexed: true }, { name: "round", type: "uint256", indexed: true }, { name: "depositConsumed", type: "uint256", indexed: false }] },
  { type: "event", name: "PaidOut", inputs: [{ name: "recipient", type: "address", indexed: true }, { name: "round", type: "uint256", indexed: true }, { name: "pot", type: "uint256", indexed: false }] },
  { type: "event", name: "CircleStarted", inputs: [{ name: "startTime", type: "uint256", indexed: false }, { name: "slots", type: "uint256", indexed: false }] },
  { type: "event", name: "CircleDissolved", inputs: [] },
  { type: "event", name: "IdleFundsParked", inputs: [{ name: "amount", type: "uint256", indexed: false }] },
  { type: "event", name: "IdleFundsWithdrawn", inputs: [{ name: "principal", type: "uint256", indexed: false }, { name: "yieldAccrued", type: "uint256", indexed: false }] },
] as const;

export const factoryAbi = [
  { type: "function", name: "createCircle", stateMutability: "nonpayable", inputs: [
    { name: "token", type: "address" }, { name: "contribution", type: "uint256" }, { name: "period", type: "uint256" },
    { name: "graceWindow", type: "uint256" }, { name: "penaltyBps", type: "uint16" }, { name: "slots", type: "uint8" },
  ], outputs: [{ name: "circle", type: "address" }] },
  { type: "function", name: "allCirclesLength", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "allCircles", stateMutability: "view", inputs: [{ type: "uint256" }], outputs: [{ type: "address" }] },
  { type: "function", name: "circlesByOrganizer", stateMutability: "view", inputs: [{ type: "address" }, { type: "uint256" }], outputs: [{ type: "address" }] },
  { type: "event", name: "CircleCreated", inputs: [{ name: "circle", type: "address", indexed: true }, { name: "organizer", type: "address", indexed: true }] },
] as const;

export const erc20Abi = [
  { type: "function", name: "approve", stateMutability: "nonpayable", inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ type: "bool" }] },
  { type: "function", name: "allowance", stateMutability: "view", inputs: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "account", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "symbol", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
  // testnet mock only — public faucet
  { type: "function", name: "mint", stateMutability: "nonpayable", inputs: [{ name: "to", type: "address" }, { name: "amount", type: "uint256" }], outputs: [] },
] as const;

export const reputationAbi = [
  { type: "function", name: "getScore", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "int256" }] },
  { type: "function", name: "scoreOf", stateMutability: "view", inputs: [{ type: "address" }], outputs: [
    { name: "score", type: "int256" }, { name: "onTime", type: "uint64" }, { name: "late", type: "uint64" },
    { name: "defaults", type: "uint64" }, { name: "completed", type: "uint64" },
  ] },
] as const;

export const STATE_NAMES = ["Forming", "Active", "Completed", "Defaulted", "Dissolved"] as const;
export type CircleState = 0 | 1 | 2 | 3 | 4;
