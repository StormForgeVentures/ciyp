// CIYP seed (PRD-001c). Idempotent: deterministic ids + ON CONFLICT DO NOTHING, so
// `supabase db reset && pnpm seed` twice leaves row counts unchanged. Runs as the
// bypassrls `postgres` role (DATABASE_URL) so RLS never blocks the seed. Real Voyage
// embeddings (cached as content-hash fixtures) — never synthetic vectors.
import type pg from "pg";
import { makePool, withClient } from "../lib/pg.js";
import { seedUuid } from "../lib/uuid.js";
import { chunkDocument } from "../lib/chunk.js";
import {
  embedDocuments,
  toVectorLiteral,
  voyageTokensSpent,
  EMBED_MODEL,
} from "../lib/voyage.js";
import {
  LUMINIFY,
  MODEL_ROUTING,
  ENGINE_CONFIG,
  BRANDING,
  ARCHETYPES,
  TIERS,
  PROCESS_DEFINITIONS,
} from "../content/config.js";
import { CORPUS } from "../content/corpus.js";
import {
  MEMBER_SPECS,
  MARKUP_RATE,
  LOW_BALANCE_THRESHOLD_CREDITS,
  TARGET_RESIDUAL_BALANCE_CREDITS,
} from "../content/members.js";
import { STRIPE_CONNECTOR_SEED, subscriptionSeeds } from "../content/store.js";

const TENANT_ID = seedUuid("tenant:luminify");
const ADMIN_ID = seedUuid("admin:luminify:owner");

type Client = pg.PoolClient;
const q = (c: Client, sql: string, params: unknown[] = []) =>
  c.query(sql, params);

const memberId = (key: string) => seedUuid(`member:${key}`);

async function seedTenant(c: Client): Promise<void> {
  await q(
    c,
    `insert into tenants (id, slug, display_name, status)
     values ($1,$2,$3,'active') on conflict (id) do nothing`,
    [TENANT_ID, LUMINIFY.slug, LUMINIFY.displayName],
  );
  await q(
    c,
    `insert into app_config (tenant_id, model_routing, engine_config, branding, prompt_set_version, member_billing_mode)
     values ($1,$2,$3,$4,'v1','absorbed') on conflict (tenant_id) do nothing`,
    [
      TENANT_ID,
      JSON.stringify(MODEL_ROUTING),
      JSON.stringify(ENGINE_CONFIG),
      JSON.stringify(BRANDING),
    ],
  );
  await q(
    c,
    `insert into wallets (tenant_id, balance_credits, markup_rate, low_balance_threshold_credits)
     values ($1, 0, $2, $3) on conflict (tenant_id) do nothing`,
    [TENANT_ID, MARKUP_RATE, LOW_BALANCE_THRESHOLD_CREDITS],
  );
  await q(
    c,
    `insert into admins (id, tenant_id, email, display_name, role)
     values ($1,$2,$3,$4,'owner') on conflict (id) do nothing`,
    [ADMIN_ID, TENANT_ID, "owner@luminify.example", "Luminify Coach"],
  );

  for (const a of ARCHETYPES) {
    await q(
      c,
      `insert into tenant_archetypes (id, tenant_id, key, label, description, prompt_fragment, sort)
       values ($1,$2,$3,$4,$5,$6,$7) on conflict (id) do nothing`,
      [
        seedUuid(`archetype:${a.key}`),
        TENANT_ID,
        a.key,
        a.label,
        a.description,
        a.prompt_fragment,
        a.sort,
      ],
    );
  }
  for (const t of TIERS) {
    await q(
      c,
      `insert into tenant_tiers (id, tenant_id, key, label, description, entitlements_jsonb, sort)
       values ($1,$2,$3,$4,$5,$6,$7) on conflict (id) do nothing`,
      [
        seedUuid(`tier:${t.key}`),
        TENANT_ID,
        t.key,
        t.label,
        t.description,
        JSON.stringify(t.entitlements_jsonb),
        t.sort,
      ],
    );
  }
  for (const p of PROCESS_DEFINITIONS) {
    await q(
      c,
      `insert into coaching_process_definitions
         (id, tenant_id, key, title, directive, modality, mode_arc, output_type, exit_condition, source, is_active, version)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,'code',true,1) on conflict (id) do nothing`,
      [
        seedUuid(`process:${p.key}`),
        TENANT_ID,
        p.key,
        p.title,
        p.directive,
        p.modality,
        JSON.stringify(p.mode_arc),
        p.output_type,
        JSON.stringify(p.exit_condition),
      ],
    );
  }
}

interface ChunkRow {
  id: string;
  itemId: string;
  index: number;
  text: string;
}

async function seedLibrary(
  c: Client,
): Promise<{ items: number; chunks: number }> {
  const chunkRows: ChunkRow[] = [];
  for (const doc of CORPUS) {
    const itemId = seedUuid(`library_item:${doc.key}`);
    await q(
      c,
      `insert into library_items
         (id, tenant_id, kind, source, title, description, tags, storage_kind, storage_id,
          transcript, ingest_status, published, created_by_admin_id)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'complete',true,$11) on conflict (id) do nothing`,
      [
        itemId,
        TENANT_ID,
        doc.kind,
        doc.source,
        doc.title,
        doc.tags.join(", "),
        doc.tags,
        doc.storage_kind,
        `library/${doc.key}`,
        doc.body,
        ADMIN_ID,
      ],
    );
    for (const ch of chunkDocument(doc.title, doc.body)) {
      chunkRows.push({
        id: seedUuid(`chunk:${doc.key}:${ch.index}`),
        itemId,
        index: ch.index,
        text: ch.text,
      });
    }
  }

  // Real document-type embeddings (content-hash cached).
  const embeddings = await embedDocuments(chunkRows.map((r) => r.text));
  for (let i = 0; i < chunkRows.length; i++) {
    const r = chunkRows[i]!;
    await q(
      c,
      `insert into library_chunks (id, tenant_id, library_item_id, chunk_index, text, embedding)
       values ($1,$2,$3,$4,$5,$6::vector) on conflict (id) do nothing`,
      [
        r.id,
        TENANT_ID,
        r.itemId,
        r.index,
        r.text,
        toVectorLiteral(embeddings[i]!),
      ],
    );
  }
  return { items: CORPUS.length, chunks: chunkRows.length };
}

function daysAgoIso(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

async function seedMembers(c: Client): Promise<number> {
  // Embed all member facts in one batch (cached).
  const factTexts: string[] = [];
  for (const m of MEMBER_SPECS) for (const f of m.facts) factTexts.push(f.fact);
  const factEmbeddings = factTexts.length
    ? await embedDocuments(factTexts)
    : [];
  let factCursor = 0;

  for (const m of MEMBER_SPECS) {
    const mId = memberId(m.key);
    await q(
      c,
      `insert into members
         (id, tenant_id, email, display_name, archetype_key, tier_key, enrollment_status, enrolled_at, lapsed_at)
       values ($1,$2,$3,$4,$5,$6,$7, now() - interval '90 days', $8)
       on conflict (id) do nothing`,
      [
        mId,
        TENANT_ID,
        m.email,
        m.displayName,
        m.archetypeKey,
        m.tierKey,
        m.enrollmentStatus,
        m.enrollmentStatus === "lapsed" ? daysAgoIso(21) : null,
      ],
    );

    // L1 recent state (null → brand-new member has no L1 row).
    if (m.recentState !== null) {
      await q(
        c,
        `insert into member_recent_state (member_id, tenant_id, state, line_count, token_count, updated_reason)
         values ($1,$2,$3,$4,$5,'session_boundary') on conflict (member_id) do nothing`,
        [
          mId,
          TENANT_ID,
          m.recentState,
          m.recentState.split(". ").length,
          Math.ceil(m.recentState.length / 4),
        ],
      );
    }

    // L2 facts (with real embeddings). Sequential awaits — one query at a time on
    // the single client.
    for (const [idx, f] of m.facts.entries()) {
      const emb = factEmbeddings[factCursor++]!;
      await q(
        c,
        `insert into member_facts (id, tenant_id, member_id, fact, tier, source, embedding, member_authored)
         values ($1,$2,$3,$4,$5,$6,$7::vector,false) on conflict (id) do nothing`,
        [
          seedUuid(`fact:${m.key}:${idx}`),
          TENANT_ID,
          mId,
          f.fact,
          f.tier,
          f.source,
          toVectorLiteral(emb),
        ],
      );
    }

    for (const [idx, ci] of m.checkIns.entries()) {
      await q(
        c,
        `insert into check_ins
           (id, tenant_id, member_id, checked_in_at, local_date, energy, clarity, execution, emotional_tag, free_text)
         values ($1,$2,$3,$4,$5::date,$6,$7,$8,$9,$10) on conflict (id) do nothing`,
        [
          seedUuid(`checkin:${m.key}:${idx}`),
          TENANT_ID,
          mId,
          daysAgoIso(ci.daysAgo),
          daysAgoIso(ci.daysAgo).slice(0, 10),
          ci.energy,
          ci.clarity,
          ci.execution,
          ci.emotionalTag ?? null,
          ci.freeText ?? null,
        ],
      );
    }

    for (const [ti, th] of m.threads.entries()) {
      const threadId = seedUuid(`thread:${m.key}:${ti}`);
      await q(
        c,
        `insert into chat_threads (id, tenant_id, member_id, agent_kind, title, state)
         values ($1,$2,$3,$4,$5,$6) on conflict (id) do nothing`,
        [threadId, TENANT_ID, mId, th.agentKind, th.title, th.state],
      );
      for (const [mi, msg] of th.messages.entries()) {
        await q(
          c,
          `insert into chat_messages (id, tenant_id, member_id, thread_id, role, parts)
           values ($1,$2,$3,$4,$5,$6) on conflict (id) do nothing`,
          [
            seedUuid(`msg:${m.key}:${ti}:${mi}`),
            TENANT_ID,
            mId,
            threadId,
            msg.role,
            JSON.stringify(msg.parts),
          ],
        );
      }
    }

    for (const [ui, up] of m.uploads.entries()) {
      await q(
        c,
        `insert into member_uploads (id, tenant_id, member_id, kind, storage_path, transcript, transcript_status)
         values ($1,$2,$3,$4,$5,$6,$7) on conflict (id) do nothing`,
        [
          seedUuid(`upload:${m.key}:${ui}`),
          TENANT_ID,
          mId,
          up.kind,
          up.storagePath,
          up.transcript ?? null,
          up.transcriptStatus ?? null,
        ],
      );
    }

    if (m.plan) {
      await q(
        c,
        `insert into member_plans
           (id, tenant_id, member_id, stage_focus, outcomes, daily_commitments, signature_questions, source,
            period_start_date, period_end_date, status)
         values ($1,$2,$3,$4,$5,$6,$7,$8, (now() - interval '30 days')::date, (now() + interval '60 days')::date, 'active')
         on conflict (id) do nothing`,
        [
          seedUuid(`plan:${m.key}`),
          TENANT_ID,
          mId,
          m.plan.stageFocus,
          JSON.stringify(m.plan.outcomes),
          JSON.stringify(m.plan.dailyCommitments),
          JSON.stringify(m.plan.signatureQuestions),
          m.plan.source,
        ],
      );
    }

    for (const [ei, ent] of m.entitlements.entries()) {
      await q(
        c,
        `insert into entitlements (id, tenant_id, member_id, sku, status, source, expires_at)
         values ($1,$2,$3,$4,$5,$6,$7) on conflict (id) do nothing`,
        [
          seedUuid(`entitlement:${m.key}:${ei}`),
          TENANT_ID,
          mId,
          ent.sku,
          ent.status,
          ent.source,
          ent.expiresInDays === null ? null : daysAgoIso(-ent.expiresInDays),
        ],
      );
    }
  }
  return MEMBER_SPECS.length;
}

const PROVIDERS = [
  {
    provider: "openrouter",
    model: "anthropic/claude-sonnet-4.6",
    feature: "coaching_chat",
  },
  {
    provider: "openrouter",
    model: "anthropic/claude-haiku-4.5",
    feature: "daily_reflection",
  },
  {
    provider: "openrouter",
    model: "anthropic/claude-sonnet-4.6",
    feature: "deep_synthesis",
  },
  {
    provider: "openrouter",
    model: "anthropic/claude-haiku-4.5",
    feature: "weekly_review",
  },
  { provider: "voyage", model: EMBED_MODEL, feature: "library_qa" },
];

async function seedEconomy(
  c: Client,
): Promise<{ events: number; balance: number }> {
  let g = 0;
  let totalDebit = 0;

  for (const m of MEMBER_SPECS) {
    const mId = memberId(m.key);
    for (let e = 0; e < m.usageEvents; e++, g++) {
      const meta = PROVIDERS[g % PROVIDERS.length]!;
      const promptTokens = 1500 + (g % 5) * 400;
      const completionTokens = 200 + (g % 4) * 150;
      const costMicros = 12_000 + (g % 7) * 2_500; // provider-derived cost
      const pricedMicros = Math.floor(costMicros * MARKUP_RATE); // billed (pricebook)
      totalDebit += pricedMicros;

      const traceId = seedUuid(`trace:${g}`);
      const usageId = seedUuid(`usage:${g}`);
      const createdAt = daysAgoIso((g % 6) + 1);

      await q(
        c,
        `insert into ai_traces
           (id, tenant_id, member_id, event_type, feature, provider, model, prompt_tokens, completion_tokens, cost_micros, latency_ms, created_at)
         values ($1,$2,$3,'model_call',$4,$5,$6,$7,$8,$9,$10,$11) on conflict (id) do nothing`,
        [
          traceId,
          TENANT_ID,
          mId,
          meta.feature,
          meta.provider,
          meta.model,
          promptTokens,
          completionTokens,
          costMicros,
          400 + (g % 900),
          createdAt,
        ],
      );
      await q(
        c,
        `insert into usage_ledger
           (id, tenant_id, member_id, feature, provider, model, prompt_tokens, completion_tokens, cost_micros, priced_cost_micros, pricebook_version, idempotency_key, ai_trace_id, created_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'seed-2026-07',$11,$12,$13) on conflict (tenant_id, idempotency_key) do nothing`,
        [
          usageId,
          TENANT_ID,
          mId,
          meta.feature,
          meta.provider,
          meta.model,
          promptTokens,
          completionTokens,
          costMicros,
          pricedMicros,
          `seed:usage:${g}`,
          traceId,
          createdAt,
        ],
      );
      await q(
        c,
        `insert into wallet_ledger (id, tenant_id, entry_type, credits_delta, usage_event_id, created_at)
         values ($1,$2,'debit',$3,$4,$5) on conflict (id) do nothing`,
        [
          seedUuid(`wl:debit:${g}`),
          TENANT_ID,
          -pricedMicros,
          usageId,
          createdAt,
        ],
      );
    }
  }

  // Top-ups + a manual adjustment sized so the wallet lands BELOW its low-balance
  // threshold (near-zero scenario) while balance == SUM(ledger) exactly (AC-5).
  const adjustment = 5_000;
  const topupsTotal = totalDebit + TARGET_RESIDUAL_BALANCE_CREDITS - adjustment;
  const topup1 = Math.floor(topupsTotal * 0.6);
  const topup2 = topupsTotal - topup1;

  await q(
    c,
    `insert into wallet_ledger (id, tenant_id, entry_type, credits_delta, stripe_ref, created_at)
     values ($1,$2,'topup',$3,'seed_topup_1', now() - interval '30 days') on conflict (id) do nothing`,
    [seedUuid("wl:topup:1"), TENANT_ID, topup1],
  );
  await q(
    c,
    `insert into wallet_ledger (id, tenant_id, entry_type, credits_delta, stripe_ref, created_at)
     values ($1,$2,'topup',$3,'seed_topup_2', now() - interval '14 days') on conflict (id) do nothing`,
    [seedUuid("wl:topup:2"), TENANT_ID, topup2],
  );
  await q(
    c,
    `insert into wallet_ledger (id, tenant_id, entry_type, credits_delta, created_at)
     values ($1,$2,'adjustment',$3, now() - interval '10 days') on conflict (id) do nothing`,
    [seedUuid("wl:adjustment:1"), TENANT_ID, adjustment],
  );

  // Materialize the balance from the ledger (no magic numbers).
  const { rows } = await q(
    c,
    `select coalesce(sum(credits_delta),0)::bigint as bal from wallet_ledger where tenant_id = $1`,
    [TENANT_ID],
  );
  const balance = Number((rows[0] as { bal: string }).bal);
  await q(
    c,
    `update wallets set balance_credits = $2, updated_at = now() where tenant_id = $1`,
    [TENANT_ID, balance],
  );

  return { events: g, balance };
}

async function seedStore(c: Client): Promise<{ subscriptions: number }> {
  // Set the coach's Stripe account ref (provisioning writes this on the real account).
  await q(
    c,
    `update tenants set stripe_account_ref = $2 where id = $1 and stripe_account_ref is null`,
    [TENANT_ID, STRIPE_CONNECTOR_SEED.stripeAccountRef],
  );

  // Coach-Stripe connector: METADATA ONLY (status 'pending', no vaulted key). Live
  // restricted key + webhook secret arrive at provisioning (008b) / in the interim
  // vault; the apps/api integration tests provision a fully-connected variant.
  await q(
    c,
    `insert into tenant_integrations (tenant_id, provider, status, server_config)
     values ($1, 'stripe', 'pending', $2::jsonb)
     on conflict (tenant_id, provider) do nothing`,
    [TENANT_ID, JSON.stringify(STRIPE_CONNECTOR_SEED)],
  );

  const subs = subscriptionSeeds();
  for (const s of subs) {
    const mId = memberId(s.memberKey);
    await q(
      c,
      `insert into stripe_customers (id, tenant_id, member_id, stripe_customer_id)
       values ($1,$2,$3,$4) on conflict (tenant_id, stripe_customer_id) do nothing`,
      [
        seedUuid(`stripe_customer:${s.memberKey}`),
        TENANT_ID,
        mId,
        s.stripeCustomerId,
      ],
    );
    await q(
      c,
      `insert into member_subscriptions
         (id, tenant_id, member_id, tier_id, stripe_customer_id, stripe_subscription_id,
          stripe_status, current_period_end)
       values ($1,$2,$3,$4,$5,$6,$7,$8)
       on conflict (tenant_id, member_id, stripe_subscription_id) do nothing`,
      [
        seedUuid(`subscription:${s.memberKey}`),
        TENANT_ID,
        mId,
        seedUuid(`tier:${s.tierKey}`),
        s.stripeCustomerId,
        s.stripeSubscriptionId,
        s.stripeStatus,
        s.currentPeriodEndDays === null
          ? null
          : daysAgoIso(-s.currentPeriodEndDays),
      ],
    );
  }
  return { subscriptions: subs.length };
}

async function main(): Promise<void> {
  const pool = makePool();
  const started = Date.now();
  try {
    await withClient(pool, async (c) => {
      console.log(
        `Seeding Luminify tenant (${TENANT_ID}) — embed model: ${EMBED_MODEL}`,
      );
      await seedTenant(c);
      const lib = await seedLibrary(c);
      const members = await seedMembers(c);
      const econ = await seedEconomy(c);
      const store = await seedStore(c);
      console.log(
        `Seed complete in ${((Date.now() - started) / 1000).toFixed(1)}s:\n` +
          `  tenant=1  archetypes=${ARCHETYPES.length}  tiers=${TIERS.length}  processes=${PROCESS_DEFINITIONS.length}\n` +
          `  library_items=${lib.items}  library_chunks=${lib.chunks}\n` +
          `  members=${members}  usage_events=${econ.events}  wallet_balance=${econ.balance} credits\n` +
          `  member_subscriptions=${store.subscriptions}\n` +
          `  voyage_tokens_spent_this_run=${voyageTokensSpent()} (0 = fully cached)`,
      );
    });
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
