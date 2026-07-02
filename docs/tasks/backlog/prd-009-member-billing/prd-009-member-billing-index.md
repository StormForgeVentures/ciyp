# PRD-009: Member Credit Billing (`member_billing_mode: 'member_credits'`)

> Source: ADR-008 + plan-gate decisions #13–#15 | Folder location = lifecycle status (do not add a Status field)
> **Sequencing:** post-core-waves module (after PRD-007 is live and stable). Sub-PRDs are authored when
> this folder enters a wave — this index locks scope and the non-preclusion constraints the v1 build must
> honor NOW.

## Overview

### Goals

Let a coach choose to bill their members in credits instead of absorbing AI cost: members hold their own
wallet, buy credits from the coach at the coach's price **on the coach's own Stripe account** (ADR-008 —
member money never touches the platform), and see their balance and spend. The coach's wallet obligation
to Luminify is unchanged; this module adds the coach's member-facing economy layer on top — the "straight
pass-through up" rate stack (Luminify markup → coach's member-rate) with settlement separated at every
layer.

### Scope

| In scope | Out of scope |
|----------|--------------|
| Per-tenant `member_billing_mode` switch (`absorbed` default · `member_credits`) — the switch itself ships in v1 config | Any change to the coach→Luminify wallet (PRD-007 mechanics unchanged) |
| Member wallets + append-only member ledger (007a disciplines verbatim) | Pooled funds / platform fees / payouts of any kind (ADR-008 prohibition) |
| Member credit purchase via coach's connected Stripe account | Member billing for non-AI things (program access stays PRD-008a) |
| Coach-set member-rate config (their markup over platform credits) | Per-member pricing tiers (flat member-rate per tenant in this module's v1) |
| Dual-layer metering: one usage event debits member wallet (coach rate) AND coach wallet (our rate) | Changing frozen contracts — member-balance wire fields are additive per the change discipline |
| Member-level enforcement (member out of credits pauses that member; coach gate unchanged beneath) | Member auto-recharge (fast-follow once member purchase flow is proven) |
| Member-facing balance/purchase surface contracts (template renders) | Template implementation (ciyp-template repo) |

## Constraints v1 must honor now (non-preclusion — binding on waves 1–6)

1. `member_billing_mode` config field exists from v1 (default `absorbed`); metering/enforcement seams read
   it — no code path may assume absorbed-only.
2. Usage events already carry `member_id` (contract 03) — the dual-debit consumer attaches here; nothing
   in PRD-007c may collapse member attribution.
3. The coach-Stripe connector (PRD-008a per ADR-008 — restricted-key integration on the 005c vault) is the payment rail this module rides — built in v1.
4. Member-wallet tables are additive later; ledger patterns (append-only, materialized balance,
   compensating rows) are reused verbatim from 007a.

## Personas

- **Member** — sees a credit balance, buys credits from their coach, gets a member-level paused state.
- **Coach** — flips the mode, sets their member-rate, sees member-wallet health in admin.
- **Luminify operator** — unaffected economics; monitors that dual-ledger totals reconcile.

## Module-level acceptance criteria (locked at index level; refined when sub-PRDs are authored)

| # | Given / When / Then |
|---|---------------------|
| AC-1 | Given a tenant in `member_credits` mode, when a member's turn completes, then exactly one usage event produces BOTH a member-wallet debit (coach rate) and a coach-wallet debit (platform rate), reconciled to the same trace. |
| AC-2 | Given a member with zero member-credits in a `member_credits` tenant, when they start a spend-heavy call, then the refusal is the member-level paused state — distinct from tenant `spend_denied` and from entitlement-expired. |
| AC-3 | Given a member credit purchase, then the charge settles on the coach's connected Stripe account and no platform-account object is created (ADR-008 audit). |
| AC-4 | Given a tenant in `absorbed` mode, then no member-facing surface, event, or wire field exposes credits (mode isolation). |

## Related

- ADR-008 (topology + mode definition) · PRD-007 (coach wallet, unchanged) · PRD-008a (coach-Stripe connector rail)
- Task list: authored at wave entry · QA: `qa/` (qa-reviewer)
