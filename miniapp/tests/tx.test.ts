import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { friendlyTxError } from "../lib/tx";

// Regression guard for the create-circle bug: friendlyTxError's old fallback was
// `m.slice(0, 140)`, and viem's ContractFunctionExecutionError puts a "Contract Call:" block
// (address / args / sender) right after the revert reason — so a short reason pushed a raw
// contract address into the 140-char window and straight into the UI banner.
//
// The invariant that must hold forever: NOTHING this function returns may contain an address.

/** A real viem writeContract failure, verbatim in shape. */
const CONTRACT_REVERT = `The contract function "createCircle" reverted with the following reason:
contribution=0

Contract Call:
  address:   0xeDEC01aCD4AA71F7c8751ac62Fe6cC18eFF82D70
  function:  createCircle(address token, uint256 contribution, uint256 period, uint256 graceWindow, uint16 penaltyBps, uint8 slots)
  args:                  (0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e, 0, 600, 85, 500, 2)
  sender:    0x8974881E39a5eF62214929B6CaA6EC0C6e7D47c7

Docs: https://viem.sh/docs/contract/writeContract
Version: viem@2.21.0`;

const GAS_ESTIMATE_FAILURE = `Execution reverted for an unknown reason.

Estimate Gas Arguments:
  from:  0x8974881E39a5eF62214929B6CaA6EC0C6e7D47c7
  to:    0xeDEC01aCD4AA71F7c8751ac62Fe6cC18eFF82D70`;

/** Run a case with console.error stubbed, so the unmapped path doesn't spam test output. */
function quietly<T>(fn: () => T): T {
  const original = console.error;
  console.error = () => {};
  try {
    return fn();
  } finally {
    console.error = original;
  }
}

describe("friendlyTxError — never leaks an address", () => {
  const cases: Record<string, string> = {
    "contract revert with Contract Call block": CONTRACT_REVERT,
    "gas estimation failure": GAS_ESTIMATE_FAILURE,
    "entirely unrecognised message": "Totally unrecognised failure at 0xDEADBEEFdeadbeefDEADBEEFdeadbeefDEADBEEF",
    "bare address": "0xeDEC01aCD4AA71F7c8751ac62Fe6cC18eFF82D70",
  };

  for (const [name, message] of Object.entries(cases)) {
    it(`returns no 0x for: ${name}`, () => {
      const out = quietly(() => friendlyTxError({ message }));
      assert.ok(out, "should always produce a message");
      assert.doesNotMatch(out, /0x/i);
    });
  }

  it("returns null only for a null error", () => {
    assert.equal(friendlyTxError(null), null);
    assert.equal(friendlyTxError(undefined), null);
    assert.ok(friendlyTxError({ message: "" }));
  });
});

describe("friendlyTxError — maps the reverts that actually occur", () => {
  const expectations: [string, RegExp][] = [
    // Circle.sol constructor requires, reachable through CircleFactory.createCircle.
    ["contribution=0", /amount greater than zero/],
    ["slots<2", /at least 2 members/],
    ["token=0", /currency isn't available/],
    ["penalty>100%", /late fee is out of range/],
    // Circle.sol runtime errors.
    ["PastGrace", /window has closed/],
    ["AlreadyContributed", /already paid this round/],
    ["NotMember", /not a member/],
    // Wallet / network.
    ["User rejected the request", /cancelled/],
    ["insufficient funds for gas", /Not enough balance/],
  ];

  for (const [message, expected] of expectations) {
    it(`maps "${message}"`, () => {
      assert.match(friendlyTxError({ message })!, expected);
    });
  }

  it("treats a cancellation as a cancellation even inside a full viem envelope", () => {
    const msg = `The contract function "join" reverted.\n\nDetails: User rejected the request.\n  address: 0xeDEC01aC`;
    assert.match(friendlyTxError({ message: msg })!, /cancelled/);
  });

  it("no longer mislabels a feeCurrency serializer error as a plain revert", () => {
    // The old /fee/i branch matched any message containing "fee"; this one is genuinely fee-related.
    assert.match(friendlyTxError({ message: "feeCurrency not supported by this wallet" })!, /network fee/);
  });
});
