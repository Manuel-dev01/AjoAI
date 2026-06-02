// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @title ISelfVerifier — proof-of-personhood gate (Self Protocol) for "one human, one slot".
/// @notice The circle calls verify() on join. A real adapter wraps Self's on-chain verification
///         (live on Celo Sepolia, VERIFICATION.md §C). address(0) verifier = OPEN mode for dev,
///         which the circle emits loudly. Returns a stable humanId so the same human can't take
///         two slots in one circle (CLAUDE.md §1.6).
interface ISelfVerifier {
    /// @return humanId a unique, stable identifier for the verified human (e.g. Self nullifier)
    function verify(address account, bytes calldata proof) external returns (bytes32 humanId);
}
