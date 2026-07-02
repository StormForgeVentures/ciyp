#!/usr/bin/env node
/**
 * Sport runtime CI guards (PRD-002b FR-10 + PRD-002c FR-3, rule 2).
 *
 *   1. No hardcoded model ids in lib/sport source (uses the SDK's `scanForHardcodedModels`).
 *      Model ids live ONLY in config (`src/config/*.json`) + the DB seed — never in code.
 *   2. Prohibited patterns in lib/sport: `staticSlotConfig` (boot-frozen slots),
 *      `@earendil-works/` (must go through sport-core), and a module-level `let host`/
 *      `let assembly` singleton (the ScalingCFO singleton-host anti-pattern).
 *
 * Exit 1 on any violation, naming the file + line. `--self-test <file>` scans one file and
 * prints findings as JSON (used by the guard test to prove the detector fires on a plant).
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanForHardcodedModels, stripComments } from '@theamazingwolf/sport-core';

const here = dirname(fileURLToPath(import.meta.url));
const SPORT_DIR = resolve(here, '../src/lib/sport');

const PROHIBITED = [
  { re: /\bstaticSlotConfig\b/, msg: 'staticSlotConfig (boot-frozen slots — use live LoadSlotConfig)' },
  { re: /@earendil-works\//, msg: '@earendil-works/* import (go through @theamazingwolf/sport-core)' },
  { re: /^\s*let\s+(host|assembly)\s*[:=]/m, msg: 'module-level `let host/assembly` singleton (per-scope assembly only)' },
];

function tsFiles(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const s = statSync(p);
    if (s.isDirectory()) out.push(...tsFiles(p));
    else if (name.endsWith('.ts') && !name.endsWith('.test.ts')) out.push(p);
  }
  return out;
}

/** Scan one source string. Returns an array of {kind, detail, line?}. */
export function scanSource(source, label) {
  const findings = [];
  for (const f of scanForHardcodedModels(source)) {
    findings.push({ kind: 'hardcoded-model', detail: `${label}: ${JSON.stringify(f)}` });
  }
  // Strip comments before the prohibited-pattern scan so DOC references to a banned
  // token (e.g. "staticSlotConfig is prohibited") don't self-trip the guard.
  const lines = stripComments(source).split('\n');
  for (const { re, msg } of PROHIBITED) {
    lines.forEach((line, i) => {
      if (re.test(line)) findings.push({ kind: 'prohibited', detail: `${label}:${i + 1} ${msg}` });
    });
  }
  return findings;
}

function main() {
  const selfTestIdx = process.argv.indexOf('--self-test');
  if (selfTestIdx !== -1) {
    const file = process.argv[selfTestIdx + 1];
    const findings = scanSource(readFileSync(file, 'utf8'), file);
    process.stdout.write(JSON.stringify(findings));
    return;
  }

  const findings = [];
  for (const file of tsFiles(SPORT_DIR)) {
    findings.push(...scanSource(readFileSync(file, 'utf8'), file));
  }
  if (findings.length > 0) {
    console.error('sport-guards FAILED:');
    for (const f of findings) console.error(`  [${f.kind}] ${f.detail}`);
    process.exit(1);
  }
  console.warn('sport-guards: clean (no hardcoded models / prohibited patterns in lib/sport).');
}

// Only run main when invoked directly (not when imported by the guard test).
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
