// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @title IYieldAdapter — pluggable venue for parking idle pot funds between payouts.
/// @notice Behind an interface so a real venue (Aave/Mento) or a LOUD simulated adapter
///         (CLAUDE.md §1.9) can be swapped. The circle pulls funds back in full before payout.
interface IYieldAdapter {
    /// @notice Deposit `amount` of `token` (already transferred to this adapter by the circle).
    function deposit(address token, uint256 amount) external;

    /// @notice Withdraw everything (principal + accrued yield) back to the circle.
    /// @return principal the amount originally deposited
    /// @return yieldAccrued extra earned (0 for the simulated-zero case)
    function withdrawAll(address token) external returns (uint256 principal, uint256 yieldAccrued);

    /// @notice Current balance attributable to the circle (principal + accrued).
    function balanceOf(address token, address circle) external view returns (uint256);

    /// @notice True if this is a simulated (non-real-yield) adapter — surfaced loudly in logs/UI.
    function isSimulated() external view returns (bool);
}
