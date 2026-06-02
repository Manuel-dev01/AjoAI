// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { IYieldAdapter } from "../interfaces/IYieldAdapter.sol";

/// @title SimulatedYieldAdapter — LOUD simulated yield venue (CLAUDE.md §1.9).
/// @notice Parks principal and returns it on withdrawal. `yieldBps` is a SIMULATED rate; any
///         simulated yield is paid from a pre-funded buffer in this adapter, never minted, so the
///         circle's "no wei created" invariant still holds (the buffer is real tokens). Defaults to
///         0 bps so unit/invariant tests see a clean principal round-trip. isSimulated() == true.
contract SimulatedYieldAdapter is IYieldAdapter {
    using SafeERC20 for IERC20;

    address public owner;
    uint16 public yieldBps; // simulated yield applied on withdrawAll (e.g. 50 = 0.5%)

    // balances[token][circle]
    mapping(address => mapping(address => uint256)) public balances;

    event SimulatedDeposit(address indexed token, address indexed circle, uint256 amount);
    event SimulatedWithdraw(
        address indexed token, address indexed circle, uint256 principal, uint256 yieldAccrued
    );

    error NotOwner();
    error InsufficientBuffer();

    constructor(uint16 _yieldBps) {
        owner = msg.sender;
        yieldBps = _yieldBps;
    }

    function setYieldBps(uint16 _bps) external {
        if (msg.sender != owner) revert NotOwner();
        yieldBps = _bps;
    }

    /// @notice Owner can pre-fund the buffer used to pay simulated yield.
    function fundBuffer(address token, uint256 amount) external {
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
    }

    function deposit(address token, uint256 amount) external {
        balances[token][msg.sender] += amount; // circle already transferred tokens in
        emit SimulatedDeposit(token, msg.sender, amount);
    }

    function withdrawAll(address token) external returns (uint256 principal, uint256 yieldAccrued) {
        principal = balances[token][msg.sender];
        balances[token][msg.sender] = 0;
        yieldAccrued = (principal * yieldBps) / 10_000;
        uint256 total = principal + yieldAccrued;
        if (IERC20(token).balanceOf(address(this)) < total) revert InsufficientBuffer();
        IERC20(token).safeTransfer(msg.sender, total);
        emit SimulatedWithdraw(token, msg.sender, principal, yieldAccrued);
    }

    function balanceOf(address token, address circle) external view returns (uint256) {
        uint256 p = balances[token][circle];
        return p + (p * yieldBps) / 10_000;
    }

    function isSimulated() external pure returns (bool) {
        return true;
    }
}
