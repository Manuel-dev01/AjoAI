// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import { Base } from "../Base.t.sol";
import { Circle } from "../../src/Circle.sol";
import { ICircle } from "../../src/interfaces/ICircle.sol";

/// @notice Reproduces the CLAUDE.md §5 worked example number-for-number (CLAUDE.md §10).
contract WorkedExampleTest is Base {
    function setUp() public {
        _deployStack(true, false);
        _createDefaultCircle();
        _joinAll();
        // default rotation = join order [A,B,C,D]
        vm.prank(organizer);
        circle.start();
    }

    // Each member was minted MINTED at join; deposit (100) was pulled during join.
    uint256 internal constant MINTED = 1000 * UNIT;

    function test_FullCircleWorkedExample() public {
        uint256 pot = 4 * CONTRIB; // 400

        // ── Round 1: all on-time, A receives ──
        _contribute(A);
        _contribute(B);
        _contribute(C);
        _contribute(D);
        _triggerPayout();
        assertEq(circle.recipientOf(0), A);
        assertTrue(circle.hasReceived(A));
        assertEq(circle.currentRound(), 1);

        // ── Round 2: all on-time, B receives ──
        _contribute(A);
        _contribute(B);
        _contribute(C);
        _contribute(D);
        _triggerPayout();
        assertTrue(circle.hasReceived(B));

        // ── Round 3: D pays LATE within grace (penalty 5), C receives ──
        _contribute(A);
        _contribute(B);
        _contribute(C);
        // warp into the grace window, then D pays late
        vm.warp(block.timestamp + PERIOD + 30 minutes);
        _contribute(D);
        _triggerPayout();
        assertTrue(circle.hasReceived(C));
        // penalty pool now holds 5% of one contribution
        assertEq(circle.penaltyPool(), (CONTRIB * PENALTY_BPS) / 10_000);

        // ── Round 4: C DEFAULTS (already received), C's deposit covers, D receives ──
        _contribute(A);
        _contribute(B);
        _contribute(D);
        // C does not contribute; warp past grace so the miss can be covered
        vm.warp(block.timestamp + PERIOD + GRACE + 1);
        _triggerPayout();
        assertTrue(circle.hasReceived(D));
        assertTrue(circle.isDelinquent(C));
        assertEq(circle.depositBalance(C), 0); // deposit consumed
        assertEq(circle.currentRound(), 4);
        assertEq(circle.roundsPaid(), 4);

        // ── Finalize: deposits returned to A,B,D; C's consumed; penalty pool distributed ──
        circle.finalize();
        assertEq(uint256(circle.state()), uint256(ICircle.State.Completed));

        // Penalty 5 distributed to compliant {A,B,D}: floor(5/3) each, remainder -> A (lowest idx).
        uint256 penalty = (CONTRIB * PENALTY_BPS) / 10_000; // 5
        uint256 each = penalty / 3;
        uint256 rem = penalty - each * 3;

        // Absolute final balances (started MINTED, deposit pulled at join):
        // A: -deposit -4 contrib +pot +depositReturn +share(each+rem)
        assertEq(tok.balanceOf(A), MINTED - CONTRIB - 4 * CONTRIB + pot + CONTRIB + each + rem, "A");
        // B: -deposit -4 contrib +pot +depositReturn +share(each)
        assertEq(tok.balanceOf(B), MINTED - CONTRIB - 4 * CONTRIB + pot + CONTRIB + each, "B");
        // C: -deposit -3 contrib +pot (deposit consumed, no return, no share)
        assertEq(tok.balanceOf(C), MINTED - CONTRIB - 3 * CONTRIB + pot, "C");
        // D: -deposit -4 contrib -latePenalty +pot +depositReturn +share(each)
        assertEq(
            tok.balanceOf(D), MINTED - CONTRIB - 4 * CONTRIB - penalty + pot + CONTRIB + each, "D"
        );

        // No wei created/destroyed: all minted tokens are back with members, circle drained.
        assertEq(
            tok.balanceOf(A) + tok.balanceOf(B) + tok.balanceOf(C) + tok.balanceOf(D),
            4 * MINTED,
            "zero-sum"
        );
        assertEq(tok.balanceOf(address(circle)), 0, "circle drained");

        // Reconciliation: in == out at terminal.
        (uint256 inSum, uint256 outSum) = circle.reconcile();
        assertEq(inSum, outSum, "reconcile");

        // Reputation: A,B completed clean = +4 on-time +5 completed = 9.
        assertEq(rep.getScore(A), 9);
        assertEq(rep.getScore(B), 9);
        // C: +3 on-time, -5 default = -2, no completion bonus.
        assertEq(rep.getScore(C), -2);
        // D: +3 on-time, -1 late, +5 completed = 7.
        assertEq(rep.getScore(D), 7);
    }
}
