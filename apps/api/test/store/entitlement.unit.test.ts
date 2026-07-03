// Pure status-mapping matrix (PRD-008a §1.3, contract 05) — no DB, no auth server, always
// runs. Locks the Stripe-status → contract-status projection incl. the lapsed override (AC-7)
// and the past_due grace-until-period-end rule (Q-2), independent of the integration path.
import { describe, expect, it } from "vitest";
import { computeStatus, isEntitled } from "../../src/store/entitlement.js";

const future = new Date(Date.now() + 86_400_000);
const past = new Date(Date.now() - 86_400_000);

describe("computeStatus", () => {
  it("no stripe status → none", () => {
    expect(computeStatus(null, future)).toBe("none");
  });

  it("active/trialing/past_due before period end map verbatim", () => {
    expect(computeStatus("active", future)).toBe("active");
    expect(computeStatus("trialing", future)).toBe("trialing");
    expect(computeStatus("past_due", future)).toBe("past_due");
  });

  it("active/trialing/past_due AFTER period end all read as expired (AC-7 lapsed override)", () => {
    expect(computeStatus("active", past)).toBe("expired");
    expect(computeStatus("trialing", past)).toBe("expired");
    expect(computeStatus("past_due", past)).toBe("expired");
  });

  it("canceled is canceled regardless of period end", () => {
    expect(computeStatus("canceled", future)).toBe("canceled");
    expect(computeStatus("canceled", past)).toBe("canceled");
  });

  it("unknown/unpaid/incomplete statuses fail closed to expired", () => {
    expect(computeStatus("unpaid", future)).toBe("expired");
    expect(computeStatus("incomplete", future)).toBe("expired");
    expect(computeStatus("incomplete_expired", future)).toBe("expired");
    expect(computeStatus("something_new", future)).toBe("expired");
  });

  it("a null period end never lapses (open-ended access)", () => {
    expect(computeStatus("active", null)).toBe("active");
  });

  it("isEntitled: only active/trialing/past_due grant access", () => {
    expect(isEntitled("active")).toBe(true);
    expect(isEntitled("trialing")).toBe(true);
    expect(isEntitled("past_due")).toBe(true);
    expect(isEntitled("expired")).toBe(false);
    expect(isEntitled("canceled")).toBe(false);
    expect(isEntitled("none")).toBe(false);
  });
});
