// Interim member-session token — sign/verify + adversarial rejection (decision #19 the
// identity must come from a VERIFIED token, so forging must fail closed).
import { describe, expect, it } from "vitest";
import {
  signMemberSession,
  verifyMemberSession,
} from "../../src/store/auth.js";

const SECRET = "test-session-secret-value";
const OTHER = "a-different-secret";
const session = {
  tenantId: "11111111-1111-4111-8111-111111111111",
  memberId: "22222222-2222-4222-8222-222222222222",
};

describe("member-session token", () => {
  it("round-trips a valid token", () => {
    const token = signMemberSession(session, { secret: SECRET });
    expect(verifyMemberSession(`Bearer ${token}`, { secret: SECRET })).toEqual(
      session,
    );
  });

  it("accepts a bare token (no Bearer prefix)", () => {
    const token = signMemberSession(session, { secret: SECRET });
    expect(verifyMemberSession(token, { secret: SECRET })).toEqual(session);
  });

  it("rejects a token signed with a different secret", () => {
    const token = signMemberSession(session, { secret: OTHER });
    expect(
      verifyMemberSession(`Bearer ${token}`, { secret: SECRET }),
    ).toBeNull();
  });

  it("rejects a tampered payload (signature no longer matches)", () => {
    const token = signMemberSession(session, { secret: SECRET });
    const [h, , s] = token.split(".");
    const forgedPayload = Buffer.from(
      JSON.stringify({
        tid: "ffffffff-ffff-4fff-8fff-ffffffffffff",
        mid: session.memberId,
        exp: 9_999_999_999,
      }),
    ).toString("base64url");
    expect(
      verifyMemberSession(`Bearer ${h}.${forgedPayload}.${s}`, {
        secret: SECRET,
      }),
    ).toBeNull();
  });

  it("rejects an expired token", () => {
    const token = signMemberSession(session, {
      secret: SECRET,
      ttlSeconds: -10,
    });
    expect(
      verifyMemberSession(`Bearer ${token}`, { secret: SECRET }),
    ).toBeNull();
  });

  it("rejects an alg:none forgery", () => {
    const header = Buffer.from(
      JSON.stringify({ alg: "none", typ: "JWT" }),
    ).toString("base64url");
    const payload = Buffer.from(
      JSON.stringify({ tid: session.tenantId, mid: session.memberId }),
    ).toString("base64url");
    expect(
      verifyMemberSession(`Bearer ${header}.${payload}.`, { secret: SECRET }),
    ).toBeNull();
  });

  it("rejects missing/garbage headers", () => {
    expect(verifyMemberSession(undefined, { secret: SECRET })).toBeNull();
    expect(
      verifyMemberSession("Bearer not-a-jwt", { secret: SECRET }),
    ).toBeNull();
    expect(verifyMemberSession("Bearer a.b.c", { secret: SECRET })).toBeNull();
  });
});
