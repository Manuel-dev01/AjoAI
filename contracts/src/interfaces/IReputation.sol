// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @title IReputation — ERC-8004 reputation write surface (CLAUDE.md §4 mapping).
/// @notice The circle calls this on contribution outcomes. Behind an interface so the
///         real ERC-8004 Reputation Registry adapter or a simulated one can be swapped.
///         A no-op (address(0)) is allowed; the circle never reverts on a reputation write.
interface IReputation {
    /// @param member  the subject
    /// @param delta   signed reputation signal (+ on-time, mild- late, strong- default, strong+ completion)
    /// @param reason  short machine tag ("on_time","late","default","completed")
    function write(address member, int256 delta, string calldata reason) external;
}
