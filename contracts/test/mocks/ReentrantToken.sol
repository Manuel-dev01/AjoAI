// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { ICircle } from "../../src/interfaces/ICircle.sol";

/// @dev Malicious token: on transfer to the attacker recipient, it re-enters the circle's
///      triggerPayout to attempt a double payout. The ReentrancyGuard + CEI must defeat it.
contract ReentrantToken is ERC20 {
    address public circle;
    address public attacker;
    bool public armed;
    uint256 public reentryAttempts;
    uint256 public reentrySuccesses;

    constructor() ERC20("Reentrant", "RE") { }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function setTarget(address _circle, address _attacker) external {
        circle = _circle;
        attacker = _attacker;
    }

    function arm(bool v) external {
        armed = v;
    }

    function _update(address from, address to, uint256 value) internal override {
        super._update(from, to, value);
        if (armed && to == attacker && circle != address(0)) {
            armed = false; // single shot, avoid infinite loop on the swallowed path
            reentryAttempts++;
            // Try to re-enter the payout. The ReentrancyGuard must make this revert; we swallow
            // the revert so the OUTER payout can complete, then assert no double-payment occurred.
            try ICircle(circle).triggerPayout() {
                reentrySuccesses++;
            } catch { }
        }
    }
}
