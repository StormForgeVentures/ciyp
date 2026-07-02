# ADR-008 — Money topology: coach-owned Stripe, no pooled funds, optional member credit billing

**Date:** 2026-07-02 · **Status:** Accepted · **Decision owner:** Tim (plan gate) · **Extends:** ADR-003 · **Supersedes:** the "passthrough parked" clause of project-state #14

## Context

ADR-003 defined three money flows but left two things ambiguous: *whose Stripe account* processes member
payments (flow a), and whether flow (c) — "coach absorbs members' AI cost" — is the only mode. At the plan
gate Tim resolved both: member money must never route through Luminify's account (no pooled funds, no
platform-to-coach payouts), and whether members are billed credits or never see them must be **the coach's
choice**, designed in before the build starts.

## Decision

### 1. Two Stripe accounts, strictly separated — money passes straight up, never pools

- **Flow (b) — coach → Luminify (credits):** the ONLY money that touches Luminify's Stripe account. The
  coach's saved payment method is charged on **our** account for credit top-ups and auto-recharge
  (PRD-007a, unchanged).
- **Flow (a) — member → coach (program access), and member credit purchases (mode 2 below):** processed on
  the **coach's own Stripe account**, connected as a **per-tenant integration on the PRD-005c connector
  framework** (envelope-encrypted credential vault, consent states, isolation tests — the same machinery as
  Granola/Fathom). **v1 mechanism: restricted Stripe API key supplied by the coach (GHL-style direct
  integration)** — the platform creates the products/prices/webhook endpoints ON the coach's account via
  their key and orchestrates checkout there; the runbook recommends (not requires) a dedicated Stripe
  account for this. Funds settle to the coach directly; Luminify takes **no fee** and never holds coach or
  member money. Webhooks: a per-tenant endpoint is created on the coach's account at connect time; its
  signing secret lives in the vault; events resolve to the tenant by endpoint identity. **Stripe Connect
  was considered and deliberately not chosen for v1** (platform-onboarding overhead vs. reusing the
  already-planned connector vault); the connector port isolates the mechanism, so Connect remains a
  swappable alternative behind the same seam if a coach can't or won't issue a key (Tim, 2026-07-02).
- Consequence: there is **no payout, escrow, or balance-owed machinery anywhere in the platform** — each
  layer bills the layer below it on its own rails: member pays coach (coach's Stripe), coach pays Luminify
  (our Stripe), Luminify pays providers. Rates stack per layer (pricebook + platform markup → coach's
  member-rate), settlement never crosses layers.

### 2. Per-tenant member billing mode (the coach's choice)

`member_billing_mode` per tenant, config not code:

| Mode | Member experience | Wallet mechanics |
|---|---|---|
| **`absorbed`** (v1 default — ADR-003 flow c) | Members never see credits | Coach's wallet funds all member usage (unchanged) |
| **`member_credits`** | Members hold a member wallet, buy credits from the coach (coach's Stripe, coach's price), see balance + spend | Member usage debits the **member wallet** at the coach's member-rate AND the **coach wallet** at our rate, in the same metering event — two ledger layers, one usage truth |

The coach's wallet obligation to Luminify is **identical in both modes** — mode 2 only adds the coach's own
member-facing layer on top. Enforcement in mode 2 gates on the member wallet first (member out of credits =
member-level pause), with the coach wallet gate unchanged beneath it.

### 3. Build sequencing

- **v1 builds:** the coach-Stripe connector (restricted-key integration on the 005c framework) +
  coach-account checkout (PRD-008a — topology cannot be retrofitted), `member_billing_mode` config
  (default `absorbed`), and schema that does not preclude member wallets (additive tables later; UUID PKs
  and the append-only ledger pattern already generalize).
- **PRD-009 (backlog, post-core-waves):** the `member_credits` mode itself — member wallets/ledgers,
  member credit purchase flow, member-rate config, member-facing balance surface (template repo renders;
  engine serves). Contract impact (member balance on the wire) follows the contract-change discipline —
  additive fields only.

## Consequences

**Positive.** Zero funds-flow liability for Luminify (no money transmission, no payout ops, no reconciling
coach balances); coaches own their member pricing end-to-end (flat fee, free, or credits with their own
margin); the two-layer rate stack Tim described (e.g. Luminify 1.1× → coach 1.1× on top) falls out of
config.

**Negative / accepted.** The platform holds coach Stripe credentials (restricted keys, envelope-encrypted
in the 005c vault — same custody class as connector OAuth tokens; scoped to the minimum grants: products,
prices, checkout sessions, subscriptions, webhook endpoints); per-tenant webhook endpoints and secrets to
manage (vault-held, rotation via the connector framework); a coach connecting their main account instead
of a dedicated one widens the blast radius of a key leak (mitigated by restricted scopes + the dedicated-
account recommendation); mode 2's dual-ledger metering must be built carefully once (PRD-009) — mitigated
by reusing the identical append-only ledger pattern at the member layer.

## Constraints for downstream

- No code path may route member payments through the platform Stripe account. No platform fees on flow (a) in v1.
- Coach Stripe access goes through the 005c connector port only — no raw key usage outside it; keys are
  restricted-scope, vault-encrypted, never in `ResolvedScope`/traces/logs (the standing 005c rules).
- `member_billing_mode` is read at metering/enforcement seams — never branched on in the pure brain.
- Member-wallet tables (PRD-009) reuse the 007a ledger disciplines verbatim: append-only, materialized
  balance, compensating corrections.
- PRD-008a implements Connect now; PRD-008b provisioning step 4 includes the Connect onboarding link and
  records the connected account id on the tenant.
