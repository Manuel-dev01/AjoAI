// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @title ICircle — rotating savings circle (ajo/esusu/chama/stokvel) escrow + rotation
/// @notice Source of truth for money logic. The agent only TRIGGERS legal transitions;
///         the contract ENFORCES every rule (CLAUDE.md §1). Single token per circle.
interface ICircle {
    enum State {
        Forming,
        Active,
        Completed,
        Defaulted,
        Dissolved
    }

    // ─── FORMING ───────────────────────────────────────────
    function join(bytes calldata selfProof) external; // verify personhood + post deposit
    function setRotation(address[] calldata order) external; // organizer: recipient order
    function setYieldAdapter(address adapter) external; // organizer: attach yield adapter pre-start
    function start() external; // FORMING -> Active
    function dissolve() external; // FORMING -> Dissolved (full refunds)

    // ─── ACTIVE (per round) ────────────────────────────────
    function contribute() external; // member pays the current round (on-time or late/grace)
    function markDelinquent(address member) external; // agent: post-grace miss -> consume deposit
    function cure() external; // delinquent member re-deposits to clear delinquency
    function triggerPayout() external; // agent: pay current round's recipient the full pot
    function forceDefaultUncured() external; // agent: settle a stuck (uncured-recipient) round after timeout
    function parkIdleFunds() external; // agent: idle funds -> yield
    function withdrawIdleFunds() external; // agent: yield -> contract before payout

    // ─── EXIT / END ────────────────────────────────────────
    function requestExit() external; // non-received member, FORMING only (v1)
    function finalize() external; // all received -> Completed; else settle terminal

    // ─── VIEWS ─────────────────────────────────────────────
    function state() external view returns (State);
    function currentRound() external view returns (uint256);
    function recipientOf(uint256 round) external view returns (address);
    function hasReceived(address member) external view returns (bool);
    function isDelinquent(address member) external view returns (bool);
    function intendedPot() external view returns (uint256);
    /// @return inSum total value that entered the circle (deposits+contributions+penalties)
    /// @return outSum total value that left/was-earmarked (payouts+returns+distributions)
    function reconcile() external view returns (uint256 inSum, uint256 outSum);

    // ─── EVENTS (each maps an action -> tx hash for the agent log + demo) ───
    event MemberJoined(address indexed member, uint256 deposit, uint256 slot);
    event RotationSet(address[] order);
    event CircleStarted(uint256 startTime, uint256 slots);
    event Contributed(address indexed member, uint256 indexed round, uint256 amount, bool late);
    event LatePaid(address indexed member, uint256 indexed round, uint256 penalty);
    event Delinquent(address indexed member, uint256 indexed round, uint256 depositConsumed);
    event Cured(address indexed member, uint256 redeposit);
    event IdleFundsParked(uint256 amount);
    event IdleFundsWithdrawn(uint256 amount, uint256 yieldAccrued);
    event YieldAdapterSet(address adapter);
    event PaidOut(address indexed recipient, uint256 indexed round, uint256 pot);
    event PayoutWithheld(address indexed recipient, uint256 indexed round);
    event MemberExited(address indexed member, uint256 refund);
    event ReputationWritten(address indexed member, int256 delta, string reason);
    event CircleCompleted();
    event CircleDefaulted(uint256 distributed);
    event CircleDissolved();
}
