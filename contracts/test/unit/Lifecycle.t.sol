// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import { Base } from "../Base.t.sol";
import { Circle } from "../../src/Circle.sol";
import { ICircle } from "../../src/interfaces/ICircle.sol";
import { MockSelfVerifier } from "../mocks/MockSelfVerifier.sol";

contract LifecycleTest is Base {
    function setUp() public {
        _deployStack(true, true);
        _createDefaultCircle();
    }

    // ── FORMING: join / personhood ──────────────────────────

    function test_Join_PostsDepositAndCounts() public {
        _join(A);
        assertTrue(circle.isMember(A));
        assertEq(circle.depositBalance(A), CONTRIB);
        assertEq(tok.balanceOf(address(circle)), CONTRIB);
        assertEq(circle.membersLength(), 1);
    }

    function test_Join_RevertsOnDoubleJoin() public {
        _join(A);
        _fund(A, 1000 * UNIT);
        vm.prank(A);
        vm.expectRevert(Circle.AlreadyMember.selector);
        circle.join(_humanProof(A));
    }

    /// One human, one slot (CLAUDE.md §1.6): two accounts, same humanId proof -> second rejected.
    function test_Join_OneHumanOneSlot() public {
        _join(A);
        address sybil = makeAddr("sybil");
        _fund(sybil, 1000 * UNIT);
        // sybil presents A's humanId
        vm.prank(sybil);
        vm.expectRevert(Circle.HumanAlreadyUsed.selector);
        circle.join(_humanProof(A));
    }

    function test_Join_RevertsWhenFull() public {
        _joinAll();
        address e = makeAddr("E");
        _fund(e, 1000 * UNIT);
        vm.prank(e);
        vm.expectRevert(Circle.SlotsFull.selector);
        circle.join(_humanProof(e));
    }

    function test_Join_RevertsIfVerifierRejects() public {
        verifier.setReject(true);
        _fund(A, 1000 * UNIT);
        vm.prank(A);
        vm.expectRevert(MockSelfVerifier.Rejected.selector);
        circle.join(_humanProof(A));
    }

    // ── Rotation / start ────────────────────────────────────

    function test_SetRotation_RequiresPermutation() public {
        _joinAll();
        address[] memory bad = new address[](4);
        bad[0] = A;
        bad[1] = A; // duplicate
        bad[2] = C;
        bad[3] = D;
        vm.prank(organizer);
        vm.expectRevert(Circle.RotationInvalid.selector);
        circle.setRotation(bad);
    }

    function test_SetRotation_CustomOrder() public {
        _joinAll();
        address[] memory order = new address[](4);
        order[0] = D;
        order[1] = C;
        order[2] = B;
        order[3] = A;
        vm.prank(organizer);
        circle.setRotation(order);
        vm.prank(organizer);
        circle.start();
        assertEq(circle.recipientOf(0), D);
    }

    function test_Start_RevertsIfNotFull() public {
        _join(A);
        _join(B);
        vm.prank(organizer);
        vm.expectRevert(Circle.NotFull.selector);
        circle.start();
    }

    function test_Start_OnlyOrganizerOrAgent() public {
        _joinAll();
        vm.prank(A);
        vm.expectRevert(Circle.NotOrganizer.selector);
        circle.start();
        // agent may start
        vm.prank(agent);
        circle.start();
        assertEq(uint256(circle.state()), uint256(ICircle.State.Active));
    }

    // ── Dissolve / exit in FORMING ──────────────────────────

    function test_Dissolve_RefundsAllDeposits() public {
        _joinAll();
        uint256 balBefore = tok.balanceOf(A);
        vm.prank(organizer);
        circle.dissolve();
        assertEq(uint256(circle.state()), uint256(ICircle.State.Dissolved));
        assertEq(tok.balanceOf(A), balBefore + CONTRIB);
        assertEq(tok.balanceOf(address(circle)), 0);
    }

    function test_RequestExit_FormingRefundsAndResizes() public {
        _joinAll();
        uint256 balBefore = tok.balanceOf(B);
        vm.prank(B);
        circle.requestExit();
        assertFalse(circle.isMember(B));
        assertEq(circle.membersLength(), 3);
        assertEq(tok.balanceOf(B), balBefore + CONTRIB);
    }

    function test_RequestExit_RevertsAfterStart() public {
        _joinAll();
        vm.prank(organizer);
        circle.start();
        vm.prank(B);
        vm.expectRevert(Circle.WrongState.selector);
        circle.requestExit();
    }

    // ── Access control on agent-only actions ────────────────

    function test_TriggerPayout_OnlyAgent() public {
        _joinAll();
        vm.prank(organizer);
        circle.start();
        _contribute(A);
        _contribute(B);
        _contribute(C);
        _contribute(D);
        vm.prank(A);
        vm.expectRevert(Circle.NotAgent.selector);
        circle.triggerPayout();
    }

    // ── Idle-fund yield round trip (principal-only sim) ─────

    function test_ParkAndWithdrawIdleFunds() public {
        _joinAll();
        vm.prank(organizer);
        circle.start();
        _contribute(A);
        _contribute(B);
        _contribute(C);
        _contribute(D);

        uint256 potHeld = tok.balanceOf(address(circle));
        assertGt(potHeld, 0);

        vm.prank(agent);
        circle.parkIdleFunds();
        assertEq(circle.parkedAmount(), potHeld);
        assertEq(tok.balanceOf(address(circle)), 0);
        assertEq(tok.balanceOf(address(yield_)), potHeld);

        // cannot pay out while funds are parked
        vm.prank(agent);
        vm.expectRevert(Circle.MustWithdrawIdleFirst.selector);
        circle.triggerPayout();

        vm.prank(agent);
        circle.withdrawIdleFunds();
        assertEq(circle.parkedAmount(), 0);
        assertEq(tok.balanceOf(address(circle)), potHeld);

        // now payout works
        _triggerPayout();
        assertTrue(circle.hasReceived(A));
    }

    function test_Park_RevertsWithoutAdapter() public {
        // redeploy without yield adapter
        _deployStack(true, false);
        _createDefaultCircle();
        _joinAll();
        vm.prank(organizer);
        circle.start();
        vm.prank(agent);
        vm.expectRevert(Circle.NoYieldAdapter.selector);
        circle.parkIdleFunds();
    }
}
