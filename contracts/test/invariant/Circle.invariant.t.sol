// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import { Test } from "forge-std/Test.sol";
import { Circle } from "../../src/Circle.sol";
import { ICircle } from "../../src/interfaces/ICircle.sol";
import { CircleFactory } from "../../src/CircleFactory.sol";
import { ReputationLedger } from "../../src/adapters/ReputationLedger.sol";
import { MockERC20 } from "../mocks/MockERC20.sol";
import { Handler } from "./Handler.sol";

/// @notice Core money invariants (CLAUDE.md §1.10, §10):
///         - conservation: no wei created/destroyed
///         - rounds bounded; received-count == roundsPaid (no member receives twice)
///         - a member flagged delinquent currently never also marked received in the SAME pending slot
contract CircleInvariantTest is Test {
    MockERC20 internal tok;
    ReputationLedger internal rep;
    CircleFactory internal factory;
    Circle internal circle;
    Handler internal handler;

    address internal agent = makeAddr("agent");
    address internal organizer = makeAddr("organizer");
    address[] internal members;

    uint256 internal constant UNIT = 1e18;
    uint256 internal constant CONTRIB = 100 * UNIT;

    function setUp() public {
        tok = new MockERC20("Mento Naira", "NGNm");
        rep = new ReputationLedger();
        factory = new CircleFactory(agent, address(0), address(rep), address(0));

        vm.prank(organizer);
        address c = factory.createCircle(address(tok), CONTRIB, 1 days, 1 hours, 500, 5);
        circle = Circle(c);
        rep.setWriter(c, true);

        for (uint256 i = 0; i < 5; i++) {
            address m = makeAddr(string(abi.encodePacked("m", vm.toString(i))));
            members.push(m);
            tok.mint(m, 100_000 * UNIT);
            vm.prank(m);
            tok.approve(c, type(uint256).max);
            vm.prank(m);
            circle.join(abi.encode(bytes32(uint256(uint160(m)))));
        }
        vm.prank(organizer);
        circle.start();

        handler = new Handler(circle, tok, agent, members);
        targetContract(address(handler));
    }

    /// No wei created or destroyed: everything in the circle is either held, parked, or paid out.
    function invariant_conservation() public view {
        (uint256 inSum, uint256 outSum) = circle.reconcile();
        uint256 held = tok.balanceOf(address(circle)) + circle.parkedAmount();
        assertEq(held, inSum - outSum, "conservation");
    }

    /// roundsPaid never exceeds slots, and exactly that many distinct members have received.
    function invariant_receivedCountMatchesRounds() public view {
        uint256 paid = circle.roundsPaid();
        assertLe(paid, 5, "rounds bounded");
        uint256 receivedCount;
        for (uint256 i = 0; i < members.length; i++) {
            if (circle.hasReceived(members[i])) receivedCount++;
        }
        assertEq(receivedCount, paid, "received == roundsPaid");
    }

    /// A currently-delinquent member must not be the recipient of an already-settled current round
    /// without having received (i.e. withhold held). If delinquent and it's their turn, unreceived.
    function invariant_delinquentRecipientNotPaid() public view {
        if (uint256(circle.state()) != uint256(ICircle.State.Active)) return;
        uint256 cr = circle.currentRound();
        if (cr >= 5) return;
        address recip = circle.recipientOf(cr);
        if (circle.isDelinquent(recip)) {
            assertFalse(circle.hasReceived(recip), "withheld: delinquent recipient unpaid");
        }
    }
}
