// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import { Test } from "forge-std/Test.sol";
import { Circle } from "../src/Circle.sol";
import { CircleFactory } from "../src/CircleFactory.sol";
import { ReputationLedger } from "../src/adapters/ReputationLedger.sol";
import { SimulatedYieldAdapter } from "../src/adapters/SimulatedYieldAdapter.sol";
import { MockERC20 } from "./mocks/MockERC20.sol";
import { MockSelfVerifier } from "./mocks/MockSelfVerifier.sol";

/// @dev Shared harness. Default circle = the CLAUDE.md §5 worked example shape:
///      contribution 100, deposit 100, penalty 5%, 4 slots.
abstract contract Base is Test {
    MockERC20 internal tok;
    MockSelfVerifier internal verifier;
    ReputationLedger internal rep;
    SimulatedYieldAdapter internal yield_;
    CircleFactory internal factory;
    Circle internal circle;

    address internal organizer = makeAddr("organizer");
    address internal agent = makeAddr("agent");

    address internal A = makeAddr("A");
    address internal B = makeAddr("B");
    address internal C = makeAddr("C");
    address internal D = makeAddr("D");

    uint256 internal constant UNIT = 1e18;
    uint256 internal constant CONTRIB = 100 * UNIT;
    uint256 internal constant PERIOD = 1 days;
    uint256 internal constant GRACE = 1 hours;
    uint16 internal constant PENALTY_BPS = 500; // 5%
    uint8 internal constant SLOTS = 4;

    function _deployStack(bool withVerifier, bool withYield) internal {
        tok = new MockERC20("Mento Naira", "NGNm");
        rep = new ReputationLedger();
        yield_ = new SimulatedYieldAdapter(0);
        verifier = new MockSelfVerifier();

        address verifierAddr = withVerifier ? address(verifier) : address(0);
        address yieldAddr = withYield ? address(yield_) : address(0);

        factory = new CircleFactory(agent, verifierAddr, address(rep), yieldAddr);
    }

    function _createDefaultCircle() internal {
        vm.prank(organizer);
        address c = factory.createCircle(address(tok), CONTRIB, PERIOD, GRACE, PENALTY_BPS, SLOTS);
        circle = Circle(c);
        rep.setWriter(address(circle), true);
    }

    function _fund(address who, uint256 amount) internal {
        tok.mint(who, amount);
        vm.prank(who);
        tok.approve(address(circle), type(uint256).max);
    }

    function _humanProof(address who) internal pure returns (bytes memory) {
        return abi.encode(bytes32(uint256(uint160(who))));
    }

    function _join(address who) internal {
        _fund(who, 1000 * UNIT);
        vm.prank(who);
        circle.join(_humanProof(who));
    }

    function _joinAll() internal {
        _join(A);
        _join(B);
        _join(C);
        _join(D);
    }

    function _contribute(address who) internal {
        vm.prank(who);
        circle.contribute();
    }

    function _triggerPayout() internal {
        vm.prank(agent);
        circle.triggerPayout();
    }
}
