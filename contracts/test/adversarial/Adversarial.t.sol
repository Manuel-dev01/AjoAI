// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import { Base } from "../Base.t.sol";
import { Circle } from "../../src/Circle.sol";
import { ICircle } from "../../src/interfaces/ICircle.sol";
import { CircleFactory } from "../../src/CircleFactory.sol";
import { ReputationLedger } from "../../src/adapters/ReputationLedger.sol";
import { ReentrantToken } from "../mocks/ReentrantToken.sol";

contract AdversarialTest is Base {
    function setUp() public {
        _deployStack(true, true);
        _createDefaultCircle();
    }

    // ── Double-claim payout: cannot pay the same round twice ─
    function test_DoubleTrigger_DoesNotPayTwice() public {
        _joinAll();
        vm.prank(organizer);
        circle.start();
        _contribute(A);
        _contribute(B);
        _contribute(C);
        _contribute(D);

        uint256 balA = tok.balanceOf(A);
        _triggerPayout(); // pays A, advances to round 1
        assertEq(tok.balanceOf(A), balA + 4 * CONTRIB);
        assertEq(circle.currentRound(), 1);

        // Immediately trigger again: round 1 (recipient B) not funded, grace not elapsed -> revert.
        vm.prank(agent);
        vm.expectRevert(Circle.WindowNotElapsed.selector);
        circle.triggerPayout();
        // A was not paid again
        assertEq(tok.balanceOf(A), balA + 4 * CONTRIB);
    }

    // ── Reentrancy on payout: guard + CEI defeat a malicious token ─
    function test_Reentrancy_PayoutCannotDoublePay() public {
        ReentrantToken rtok = new ReentrantToken();
        CircleFactory f = new CircleFactory(agent, address(0), address(rep), address(0));
        vm.prank(organizer);
        address c = f.createCircle(address(rtok), CONTRIB, PERIOD, GRACE, PENALTY_BPS, SLOTS);
        Circle rc = Circle(c);
        rep.setWriter(c, true);

        address[4] memory ms = [A, B, C, D];
        for (uint256 i = 0; i < 4; i++) {
            rtok.mint(ms[i], 1000 * UNIT);
            vm.prank(ms[i]);
            rtok.approve(c, type(uint256).max);
            vm.prank(ms[i]);
            rc.join(abi.encode(bytes32(uint256(uint160(ms[i])))));
        }
        vm.prank(organizer);
        rc.start();
        for (uint256 i = 0; i < 4; i++) {
            vm.prank(ms[i]);
            rc.contribute();
        }

        // Arm the token to re-enter triggerPayout when paying recipient A.
        rtok.setTarget(c, A);
        rtok.arm(true);

        uint256 balA = rtok.balanceOf(A);
        vm.prank(agent);
        rc.triggerPayout();

        // Reentry was attempted but blocked; A paid exactly once.
        assertEq(rtok.reentryAttempts(), 1, "reentry attempted");
        assertEq(rtok.reentrySuccesses(), 0, "reentry blocked");
        assertEq(rtok.balanceOf(A), balA + 4 * CONTRIB, "paid once");
        assertEq(rc.currentRound(), 1);
    }

    // ── Contribute-after-default: past grace, cannot pay normally ─
    function test_ContributeAfterDefault_Reverts() public {
        _joinAll();
        vm.prank(organizer);
        circle.start();
        // Only A,B,C contribute; D misses. Warp past grace, mark D delinquent.
        _contribute(A);
        _contribute(B);
        _contribute(C);
        vm.warp(block.timestamp + PERIOD + GRACE + 1);
        vm.prank(agent);
        circle.markDelinquent(D);
        assertTrue(circle.isDelinquent(D));

        // D now tries to contribute the same round -> past grace -> revert.
        vm.prank(D);
        vm.expectRevert(Circle.PastGrace.selector);
        circle.contribute();
    }

    // ── Recipient is delinquent at their turn: WITHHELD, then cure ─
    function test_RecipientDelinquent_WithheldThenCured() public {
        _joinAll();
        // rotation default [A,B,C,D]; make A (round-0 recipient) delinquent in round 0
        vm.prank(organizer);
        circle.start();
        // B,C,D contribute; A misses its own round
        _contribute(B);
        _contribute(C);
        _contribute(D);
        vm.warp(block.timestamp + PERIOD + GRACE + 1);
        vm.prank(agent);
        circle.markDelinquent(A);
        assertTrue(circle.isDelinquent(A));

        // triggerPayout -> withheld (no advance, no pay)
        vm.expectEmit(true, true, false, false, address(circle));
        emit ICircle.PayoutWithheld(A, 0);
        _triggerPayout();
        assertEq(circle.currentRound(), 0, "no advance");
        assertFalse(circle.hasReceived(A));

        // A cures (re-deposits) then gets paid
        _fund(A, 1000 * UNIT);
        vm.prank(A);
        circle.cure();
        assertFalse(circle.isDelinquent(A));

        uint256 balA = tok.balanceOf(A);
        _triggerPayout();
        assertTrue(circle.hasReceived(A));
        assertEq(tok.balanceOf(A), balA + 4 * CONTRIB);
        assertEq(circle.currentRound(), 1);
    }

    // ── Default by a member who already received -> deposit forfeit, pro-rata on DEFAULT ─
    function test_DefaultByAlreadyReceived_DepositForfeitedRecipientWhole() public {
        // 3-slot circle. A receives round 0. In round 1 (recipient B) the recipient B contributes,
        // but A (already received) and C default past grace -> their deposits cover the shortfall,
        // B is made whole, A's & C's deposits are forfeited, and the circle continues.
        vm.prank(organizer);
        address c = factory.createCircle(address(tok), CONTRIB, PERIOD, GRACE, PENALTY_BPS, 3);
        circle = Circle(c);
        rep.setWriter(c, true);
        address[3] memory ms = [A, B, C];
        for (uint256 i = 0; i < 3; i++) {
            _fund(ms[i], 1000 * UNIT);
            vm.prank(ms[i]);
            circle.join(_humanProof(ms[i]));
        }
        vm.prank(organizer);
        circle.start();

        // Round 0: all pay, A receives.
        _contribute(A);
        _contribute(B);
        _contribute(C);
        _triggerPayout();
        assertTrue(circle.hasReceived(A));

        // Round 1 (recipient B): B pays; A (already received) and C default past grace.
        _contribute(B);
        vm.warp(block.timestamp + PERIOD + GRACE + 1);
        uint256 balB = tok.balanceOf(B);
        vm.prank(agent);
        circle.triggerPayout();

        assertTrue(circle.hasReceived(B), "recipient B made whole");
        assertEq(tok.balanceOf(B), balB + 3 * CONTRIB, "B receives full pot from A/C forfeited deposits");
        assertEq(circle.depositBalance(A), 0, "already-received A deposit forfeited");
        assertTrue(circle.isDelinquent(A));
        assertTrue(circle.isDelinquent(C));
        assertEq(uint256(circle.state()), uint256(ICircle.State.Active), "circle continues");
    }

    // ── BUG #1: a recipient who misses their OWN round is WITHHELD, not paid from their own deposit ─
    function test_RecipientSelfDefault_WithheldNotPaid() public {
        _joinAll();
        vm.prank(organizer);
        circle.start(); // rotation [A,B,C,D]; round-0 recipient = A

        // Everyone EXCEPT the recipient A pays. A misses its own round. Agent does NOT pre-mark A.
        _contribute(B);
        _contribute(C);
        _contribute(D);
        vm.warp(block.timestamp + PERIOD + GRACE + 1);

        uint256 balA = tok.balanceOf(A);
        vm.expectEmit(true, true, false, false, address(circle));
        emit ICircle.PayoutWithheld(A, 0);
        _triggerPayout(); // _coverRound marks A delinquent; post-cover check must WITHHOLD

        assertFalse(circle.hasReceived(A), "recipient not paid");
        assertEq(tok.balanceOf(A), balA, "recipient received nothing");
        assertTrue(circle.isDelinquent(A), "recipient marked delinquent");
        assertEq(circle.currentRound(), 0, "no advance");
        assertEq(uint256(circle.state()), uint256(ICircle.State.Active));
        assertTrue(circle.withheldSince(0) != 0, "withhold timer stamped");
    }

    // ── BUG #2: an uncured delinquent recipient can be force-defaulted after the timeout ─
    function test_ForceDefaultUncured_AfterTimeout() public {
        _joinAll();
        vm.prank(organizer);
        circle.start();
        _contribute(B);
        _contribute(C);
        _contribute(D);
        vm.warp(block.timestamp + PERIOD + GRACE + 1);
        _triggerPayout(); // A self-defaults -> withheld, withheldSince[0] set

        // Before the timeout: force-default reverts.
        vm.prank(agent);
        vm.expectRevert(Circle.WindowNotElapsed.selector);
        circle.forceDefaultUncured();

        // A never cures. After withholdTimeout, the agent recovers the funds.
        uint256 timeout = circle.withholdTimeout();
        vm.warp(block.timestamp + timeout + 1);
        vm.prank(agent);
        circle.forceDefaultUncured();

        assertEq(uint256(circle.state()), uint256(ICircle.State.Defaulted), "settled to Defaulted");
        // Everything distributed pro-rata to not-yet-received members; nothing frozen.
        (uint256 inSum, uint256 outSum) = circle.reconcile();
        assertEq(inSum, outSum, "reconciles: no wei created or destroyed");
        assertEq(tok.balanceOf(address(circle)), 0, "no funds frozen in the contract");
    }

    function test_ForceDefaultUncured_RevertsIfRecipientNotDelinquent() public {
        _joinAll();
        vm.prank(organizer);
        circle.start();
        _contribute(A);
        _contribute(B);
        _contribute(C);
        _contribute(D); // all paid -> recipient A not delinquent
        vm.prank(agent);
        vm.expectRevert(Circle.NotDelinquent.selector);
        circle.forceDefaultUncured();
    }

    // ── LOW: setYieldAdapter is organizer-only and Forming-only ─
    function test_SetYieldAdapter_OrganizerFormingOnly() public {
        address newAdapter = address(0xBEEF);
        // organizer can set pre-start
        vm.prank(organizer);
        circle.setYieldAdapter(newAdapter);
        assertEq(address(circle.yieldAdapter()), newAdapter);
        // non-organizer reverts
        vm.prank(A);
        vm.expectRevert(Circle.NotOrganizer.selector);
        circle.setYieldAdapter(address(0));
        // after start -> wrong state
        _joinAll();
        vm.prank(organizer);
        circle.start();
        vm.prank(organizer);
        vm.expectRevert(Circle.WrongState.selector);
        circle.setYieldAdapter(address(0));
    }

    // ── Rounding: indivisible penalty pool, remainder to lowest-index eligible ─
    function test_Rounding_RemainderToLowestIndex() public {
        // Force a penalty pool that doesn't divide evenly among compliant members.
        _joinAll();
        vm.prank(organizer);
        circle.start();

        // Round 0: A,B,C on time; D late -> penalty into pool. A receives.
        _contribute(A);
        _contribute(B);
        _contribute(C);
        vm.warp(block.timestamp + PERIOD + 1);
        _contribute(D); // late
        _triggerPayout();

        uint256 pool = circle.penaltyPool();
        assertEq(pool, (CONTRIB * PENALTY_BPS) / 10_000);

        // Run remaining rounds cleanly so all receive, then finalize.
        for (uint256 r = 1; r < 4; r++) {
            _contribute(A);
            _contribute(B);
            _contribute(C);
            _contribute(D);
            _triggerPayout();
        }
        // all compliant (D was late, not delinquent) -> 4 eligible
        uint256 balA = tok.balanceOf(A);
        uint256 balB = tok.balanceOf(B);
        circle.finalize();

        uint256 each = pool / 4;
        uint256 rem = pool - each * 4;
        // A (lowest index) gets each + remainder; B gets each
        assertEq(tok.balanceOf(A), balA + CONTRIB + each + rem, "A share+deposit");
        assertEq(tok.balanceOf(B), balB + CONTRIB + each, "B share+deposit");
        assertEq(tok.balanceOf(address(circle)), 0, "drained");
    }
}
