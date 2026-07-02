// seed-verify (PRD-001c FR-10 / task 4.4): a query suite asserting every seeded
// shape. Exits non-zero on any failure so CI fails when the seed regresses. Runs
// after `pnpm seed`.
import { makePool, withClient } from '../lib/pg.js';

const SLOT_KEYS = ['default', 'fast', 'classify', 'deep', 'worker', 'synthesis', 'vision', 'embed', 'rerank', 'stt', 'tts'];

const failures: string[] = [];
function check(name: string, ok: boolean, detail = ''): void {
  if (ok) {
    console.log(`  PASS  ${name}`);
  } else {
    console.error(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`);
    failures.push(name);
  }
}

async function main(): Promise<void> {
  const pool = makePool();
  try {
    await withClient(pool, async (c) => {
      const one = async (sql: string, params: unknown[] = []): Promise<Record<string, unknown>> =>
        (await c.query(sql, params)).rows[0] as Record<string, unknown>;
      const num = (v: unknown): number => Number(v);

      // ── Tenant + config ────────────────────────────────────────────────
      const tenant = await one(`select count(*)::int n from tenants`);
      check('exactly 1 tenant seeded', num(tenant.n) === 1, `got ${tenant.n}`);

      const cfg = await one(`select model_routing from app_config limit 1`);
      const routing = cfg?.model_routing as Record<string, { provider?: string; model?: string; voice_id?: string }> | undefined;
      check('app_config has model_routing', !!routing);
      if (routing) {
        for (const slot of SLOT_KEYS) {
          const s = routing[slot];
          const resolves = !!s && (!!(s.provider && s.model) || !!s.voice_id);
          check(`slot "${slot}" resolves to {provider,model} or voice_id`, resolves, JSON.stringify(s));
        }
        check('tts.voice_id present (Fish-audio persona slot)', !!routing.tts?.voice_id, JSON.stringify(routing.tts));
      }

      const arche = await one(`select count(*)::int n, count(*) filter (where length(trim(prompt_fragment))>0)::int nonempty from tenant_archetypes`);
      check('3–4 archetypes, all with non-empty prompt_fragment', num(arche.n) >= 3 && num(arche.n) <= 4 && num(arche.n) === num(arche.nonempty), JSON.stringify(arche));
      const tiers = await one(`select count(*)::int n from tenant_tiers`);
      check('2–3 tiers seeded', num(tiers.n) >= 2 && num(tiers.n) <= 3, `got ${tiers.n}`);
      const procs = await one(`select count(*)::int n from coaching_process_definitions where directive <> ''`);
      check('2 process directives with non-empty directive', num(procs.n) === 2, `got ${procs.n}`);

      // ── Library corpus (AC-3) ──────────────────────────────────────────
      const lib = await one(`
        select
          (select count(*) from library_items)::int items,
          (select count(*) from library_chunks)::int chunks,
          (select count(*) from library_chunks where embedding is not null)::int embedded,
          (select count(*) from library_chunks where vector_dims(embedding) = 1024)::int dim1024,
          (select count(*) from library_chunks where text_search is not null)::int tsv`);
      check('≥ 8 library_items', num(lib.items) >= 8, `got ${lib.items}`);
      check('≥ 200 library_chunks', num(lib.chunks) >= 200, `got ${lib.chunks}`);
      check('every chunk has a 1024-dim embedding', num(lib.chunks) === num(lib.embedded) && num(lib.chunks) === num(lib.dim1024), JSON.stringify(lib));
      check('every chunk has a non-null tsvector', num(lib.chunks) === num(lib.tsv), JSON.stringify(lib));

      // ── Demo members edge shapes (AC-4) ────────────────────────────────
      const newM = await one(`
        select m.id, (select count(*) from member_facts f where f.member_id=m.id)::int facts,
               (select count(*) from member_recent_state s where s.member_id=m.id)::int l1
        from members m where m.email='ada.new@example.com'`);
      check('brand-new member has zero member_facts', num(newM.facts) === 0, `facts=${newM.facts}`);
      check('brand-new member has no L1 recent_state', num(newM.l1) === 0, `l1=${newM.l1}`);

      const midM = await one(`select (select count(*) from member_facts f where f.member_id=m.id)::int facts from members m where m.email='ben.mid@example.com'`);
      check('mid-journey member has ≥ 10 member_facts', num(midM.facts) >= 10, `facts=${midM.facts}`);

      const exp = await one(`
        select count(*) filter (where e.status='expired')::int expired
        from members m join entitlements e on e.member_id=m.id where m.email='cleo.expired@example.com'`);
      check('expired member has an expired entitlement', num(exp.expired) >= 1, `expired=${exp.expired}`);

      const longM = await one(`
        select max(length(u.transcript))::int max_upload, max(length(ci.free_text))::int max_free
        from members m
        left join member_uploads u on u.member_id=m.id
        left join check_ins ci on ci.member_id=m.id
        where m.email='edith.long@example.com'`);
      check('long-fields member has a long upload transcript (> 1500 chars)', num(longM.max_upload) > 1500, `len=${longM.max_upload}`);
      check('long-fields member has a long check-in free_text (> 1000 chars)', num(longM.max_free) > 1000, `len=${longM.max_free}`);

      // ── Wallet + ledger consistency (AC-5, near-zero scenario) ─────────
      const wallet = await one(`
        select w.balance_credits::bigint bal, w.low_balance_threshold_credits::bigint threshold, w.markup_rate::numeric markup,
               (select coalesce(sum(credits_delta),0) from wallet_ledger l where l.tenant_id=w.tenant_id)::bigint ledger_sum
        from wallets w limit 1`);
      check('wallet.balance_credits == SUM(wallet_ledger.credits_delta)', num(wallet.bal) === num(wallet.ledger_sum), JSON.stringify(wallet));
      check('wallet markup_rate = 1.1 (decision #13)', Number(wallet.markup) === 1.1, `markup=${wallet.markup}`);
      check('near-zero scenario: balance below low-balance threshold', num(wallet.bal) < num(wallet.threshold), JSON.stringify(wallet));

      // ── Metering rollup (AC-6) ─────────────────────────────────────────
      const rollup = await one(`
        select count(*)::int rows, count(distinct feature)::int features,
               coalesce(sum(prompt_tokens+completion_tokens),0)::bigint tokens,
               coalesce(sum(priced_cost_micros),0)::bigint priced
        from usage_ledger`);
      check('usage_ledger rollup is non-empty', num(rollup.rows) > 0 && num(rollup.tokens) > 0, JSON.stringify(rollup));
      const overpriced = await one(`select count(*)::int n from usage_ledger where priced_cost_micros > cost_micros * 1.1`);
      check('every priced_cost_micros ≤ cost_micros × markup (1.1)', num(overpriced.n) === 0, `violations=${overpriced.n}`);
      const debitMatch = await one(`
        select count(*)::int mismatches from wallet_ledger wl
        join usage_ledger u on u.id = wl.usage_event_id
        where wl.entry_type='debit' and wl.credits_delta <> -u.priced_cost_micros`);
      check('each wallet debit equals -usage.priced_cost_micros', num(debitMatch.mismatches) === 0, `mismatches=${debitMatch.mismatches}`);

      // ai_traces consistency with usage_ledger
      const traceLink = await one(`select count(*)::int n from usage_ledger u left join ai_traces t on t.id=u.ai_trace_id where t.id is null`);
      check('every usage_ledger row links a real ai_trace', num(traceLink.n) === 0, `orphans=${traceLink.n}`);

      // ── HNSW usability (AC-7) ──────────────────────────────────────────
      const midId = (await one(`select id from members where email='ben.mid@example.com'`)).id as string;
      const qvec = (await one(`select embedding::text v from member_facts where member_id=$1 and embedding is not null limit 1`, [midId]))?.v as string | undefined;
      if (qvec) {
        await c.query(`set enable_seqscan=off; set enable_indexscan=off; set enable_bitmapscan=off`);
        const plan = await c.query(
          `explain (format text) select id from member_facts
             where member_id=$1 and embedding is not null
             order by embedding <=> $2::vector limit 20`,
          [midId, qvec],
        );
        await c.query(`reset enable_seqscan; reset enable_indexscan; reset enable_bitmapscan`);
        const planText = plan.rows.map((r) => (r as Record<string, string>)['QUERY PLAN']).join('\n');
        check('member_facts vector recall uses the HNSW index', planText.includes('member_facts_embedding_hnsw'), planText.split('\n')[0]);
        check('member_facts vector recall never seq-scans', !/Seq Scan/i.test(planText));
      } else {
        check('member_facts has an embedding to plan against', false);
      }

      // ── Instance-agnostic (AC-7 / brief success criterion 6) ───────────
      const kyle = await one(`
        select count(*)::int n from (
          select fact t from member_facts
          union all select directive from coaching_process_definitions
          union all select prompt_fragment from tenant_archetypes
          union all select coalesce(state,'') from member_recent_state
          union all select text from library_chunks
        ) s where s.t ~* '(kyle|empowered leader|reconnector|stabilizer|catapult|mastermind|concierge|five_planes|harmonizer)'`);
      check('no donor-coach (Kyle-era) identifiers in seeded content', num(kyle.n) === 0, `matches=${kyle.n}`);
    });
  } finally {
    await pool.end();
  }

  if (failures.length) {
    console.error(`\nseed-verify FAILED: ${failures.length} check(s) — ${failures.join('; ')}`);
    process.exit(1);
  }
  console.log('\nseed-verify: all checks passed.');
}

main().catch((err) => {
  console.error('seed-verify crashed:', err);
  process.exit(1);
});
