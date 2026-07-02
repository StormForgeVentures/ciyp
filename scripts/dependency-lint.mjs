#!/usr/bin/env node
/**
 * Dependency lint — the purity gates (prd-001a FR-4, ACs 2–3; ADR-006 constraint).
 *   1. packages/agents dependencies are EXACTLY { @ciyp/shared, zod }.
 *   2. packages/prompts has ZERO runtime dependencies.
 *   3. No source file in any workspace imports @earendil-works/* (everything goes
 *      through sport-core — sport-ai-sdk ADR-001 / this repo's ADR-006).
 * Fails the build (exit 1) on any violation.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const failures = [];

// ── Gate 1: agents purity ─────────────────────────────────────────────────────
const agentsPkg = JSON.parse(readFileSync(join(root, 'packages/agents/package.json'), 'utf8'));
const agentsDeps = Object.keys(agentsPkg.dependencies ?? {}).sort();
const allowed = ['@ciyp/shared', 'zod'];
if (JSON.stringify(agentsDeps) !== JSON.stringify(allowed)) {
  failures.push(
    `packages/agents dependencies must be exactly [${allowed.join(', ')}]; found [${agentsDeps.join(', ')}] (the brain stays pure — architecture §5.1)`,
  );
}

// ── Gate 2: prompts zero runtime deps ─────────────────────────────────────────
const promptsPkg = JSON.parse(readFileSync(join(root, 'packages/prompts/package.json'), 'utf8'));
const promptsDeps = Object.keys(promptsPkg.dependencies ?? {});
if (promptsDeps.length > 0) {
  failures.push(
    `packages/prompts must have zero runtime dependencies; found [${promptsDeps.join(', ')}]`,
  );
}

// ── Gate 3: no @earendil-works/* imports anywhere (ADR-006) ───────────────────
const SCAN_DIRS = ['apps', 'packages', 'scripts'];
const SRC_RE = /\.(ts|tsx|js|jsx|mjs|cjs|py)$/;
const SKIP = new Set(['node_modules', 'dist', 'build', '.turbo', 'coverage']);

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    if (SKIP.has(entry)) continue;
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) yield* walk(p);
    else if (SRC_RE.test(entry)) yield p;
  }
}

for (const top of SCAN_DIRS) {
  for (const file of walk(join(root, top))) {
    if (file.endsWith('dependency-lint.mjs')) continue; // this file names the pattern
    const text = readFileSync(file, 'utf8');
    if (text.includes('@earendil-works/')) {
      failures.push(
        `${file.replace(root, '')}: direct @earendil-works/* import — everything goes through sport-core (ADR-006)`,
      );
    }
  }
}

if (failures.length > 0) {
  console.error('✖ dependency-lint failed:\n' + failures.map((f) => `  - ${f}`).join('\n'));
  process.exit(1);
}
console.log('✓ dependency-lint: agents purity, prompts zero-deps, no @earendil-works imports');
