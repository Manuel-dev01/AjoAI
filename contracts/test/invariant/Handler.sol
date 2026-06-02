// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import { CommonBase } from "forge-std/Base.sol";
import { StdUtils } from "forge-std/StdUtils.sol";
import { Circle } from "../../src/Circle.sol";
import { MockERC20 } from "../mocks/MockERC20.sol";

/// @dev Drives random legal-ish actions against a Circle for invariant fuzzing.
///      fail_on_revert = false (foundry.toml) so reverting actions are simply no-ops.
contract Handler is CommonBase, StdUtils {
    Circle public circle;
    MockERC20 public tok;
    address public agent;
    address[] public members;

    constructor(Circle _circle, MockERC20 _tok, address _agent, address[] memory _members) {
        circle = _circle;
        tok = _tok;
        agent = _agent;
        members = _members;
    }

    function _member(uint256 seed) internal view returns (address) {
        return members[seed % members.length];
    }

    function contribute(uint256 seed) external {
        address m = _member(seed);
        vm.prank(m);
        try circle.contribute() { } catch { }
    }

    function warp(uint256 secs) external {
        secs = bound(secs, 1, 3 days);
        vm.warp(block.timestamp + secs);
    }

    function markDelinquent(uint256 seed) external {
        address m = _member(seed);
        vm.prank(agent);
        try circle.markDelinquent(m) { } catch { }
    }

    function cure(uint256 seed) external {
        address m = _member(seed);
        vm.prank(m);
        try circle.cure() { } catch { }
    }

    function triggerPayout() external {
        vm.prank(agent);
        try circle.triggerPayout() { } catch { }
    }

    function finalize() external {
        try circle.finalize() { } catch { }
    }
}
