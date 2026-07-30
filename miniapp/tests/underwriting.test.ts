import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  BAND_MULTIPLIER,
  activeExposure,
  buildReport,
  creditLimit,
  isCurrentlyDelinquent,
  reliability,
  riskBand,
  type CreditFacts,
  type Membership,
} from "../lib/underwriting";

// The paid /api/invoke report is derived by fixed arithmetic from contract state, so every band
// boundary and the credit-limit formula are unit-testable without a chain (CLAUDE.md §10).

const circle = (over: Partial<Membership> = {}): Membership => ({
  address: "0x4D03D887c3bB293623A8aF842DB80B4680a5E11F",
  state: "Active",
  contribution: 1_000_000n, // 1.00 of a 6-decimal token
  decimals: 6,
  symbol: "USDT",
  isDelinquent: false,
  hasReceived: false,
  ...over,
});

const facts = (over: Partial<CreditFacts> = {}): CreditFacts => ({
  score: 0n,
  onTime: 0n,
  late: 0n,
  defaults: 0n,
  completed: 0n,
  circles: [],
  ...over,
});

describe("reliability", () => {
  it("is null with no history rather than a misleading zero", () => {
    assert.equal(reliability({ onTime: 0n, late: 0n, defaults: 0n }), null);
  });

  it("counts late and defaulted rounds against the member", () => {
    assert.equal(reliability({ onTime: 8n, late: 1n, defaults: 1n }), 0.8);
    assert.equal(reliability({ onTime: 10n, late: 0n, defaults: 0n }), 1);
  });
});

describe("riskBand", () => {
  it("is 'none' with no history", () => {
    assert.equal(riskBand(facts()), "none");
  });

  it("is 'high-risk' on any recorded default, however good the rest of the record", () => {
    assert.equal(riskBand(facts({ onTime: 100n, defaults: 1n, completed: 5n })), "high-risk");
  });

  it("is 'high-risk' while a delinquency is uncured, even with no default counted yet", () => {
    const f = facts({ onTime: 20n, completed: 3n, circles: [circle({ isDelinquent: true })] });
    assert.equal(isCurrentlyDelinquent(f), true);
    assert.equal(riskBand(f), "high-risk");
  });

  it("is 'building' while the clean record is too short to underwrite", () => {
    assert.equal(riskBand(facts({ onTime: 5n, completed: 1n })), "building");
  });

  it("is 'good' at 90% on time with a completed circle", () => {
    assert.equal(riskBand(facts({ onTime: 9n, late: 1n, completed: 1n })), "good");
  });

  it("stays 'building' when reliability is below 90%, even with a completed circle", () => {
    assert.equal(riskBand(facts({ onTime: 8n, late: 2n, completed: 1n })), "building");
  });

  it("is 'prime' only on a perfect record across two completed circles", () => {
    assert.equal(riskBand(facts({ onTime: 12n, completed: 2n })), "prime");
    // one late payment is enough to drop out of prime
    assert.equal(riskBand(facts({ onTime: 11n, late: 1n, completed: 2n })), "good");
    // a perfect but single-circle record is not yet prime
    assert.equal(riskBand(facts({ onTime: 12n, completed: 1n })), "good");
  });
});

describe("creditLimit", () => {
  it("is null when the member belongs to no circle", () => {
    assert.equal(creditLimit(facts({ onTime: 12n, completed: 2n })), null);
  });

  it("extends nothing to a high-risk member", () => {
    const f = facts({ onTime: 10n, defaults: 1n, circles: [circle()] });
    assert.equal(creditLimit(f)!.amount, 0n);
  });

  it("scales the largest per-round contribution by the band multiplier", () => {
    const f = facts({
      onTime: 12n,
      completed: 2n,
      circles: [circle({ contribution: 1_000_000n }), circle({ contribution: 5_000_000n })],
    });
    assert.equal(riskBand(f), "prime");
    const limit = creditLimit(f)!;
    assert.equal(limit.amount, 5_000_000n * BigInt(BAND_MULTIPLIER.prime));
    assert.equal(limit.symbol, "USDT");
    assert.equal(limit.decimals, 6);
  });
});

describe("activeExposure", () => {
  it("is null when nothing is currently running", () => {
    assert.equal(activeExposure(facts({ circles: [circle({ state: "Completed" })] })), null);
  });

  it("sums only Active circles, ignoring completed ones", () => {
    const f = facts({
      circles: [
        circle({ state: "Active", contribution: 2_000_000n }),
        circle({ state: "Active", contribution: 3_000_000n }),
        circle({ state: "Completed", contribution: 9_000_000n }),
      ],
    });
    assert.equal(activeExposure(f)!.amount, 5_000_000n);
  });

  it("does not add across different tokens", () => {
    const f = facts({
      circles: [
        circle({ state: "Active", contribution: 4_000_000n, symbol: "USDT", decimals: 6 }),
        circle({ state: "Active", contribution: 10n ** 18n, symbol: "NGNm", decimals: 18 }),
      ],
    });
    const e = activeExposure(f)!;
    assert.equal(e.symbol, "NGNm");
    assert.equal(e.amount, 10n ** 18n);
  });
});

describe("buildReport", () => {
  const addr = "0x8974881E39a5eF62214929B6CaA6EC0C6e7D47c7";

  it("reports a prime member with a formatted limit", () => {
    const r = buildReport(addr, facts({ score: 8n, onTime: 12n, completed: 2n, circles: [circle()] }), false);
    assert.equal(r.address, addr);
    assert.equal(r.savingsCredit.reliability, 1);
    assert.equal(r.assessment.riskBand, "prime");
    assert.equal(r.assessment.suggestedCreditLimit!.amount, "6");
    assert.equal(r.participation.currentlyDelinquent, false);
    assert.equal("truncated" in r, false);
  });

  it("declares truncation rather than silently capping the scan", () => {
    const r = buildReport(addr, facts(), true);
    assert.match(String((r as { truncated?: string }).truncated), /may be incomplete/);
  });

  it("never reports a credit limit for a delinquent member", () => {
    const r = buildReport(addr, facts({ onTime: 30n, completed: 4n, circles: [circle({ isDelinquent: true })] }), false);
    assert.equal(r.assessment.riskBand, "high-risk");
    assert.equal(r.assessment.suggestedCreditLimit!.amount, "0");
  });
});
