import { describe, expect, it } from 'vitest';
import { tokens, darkColors, themes, baseCssVars, colorCssVars } from '../src/index.js';

// The set of additive keys 006a introduced (docs/design-brief.md "Proposed ui-tokens additions").
const NEW_COLOR_KEYS = [
  'bg.elevated',
  'bg.overlay',
  'bg.sidebar',
  'text.muted',
  'text.on-accent',
  'text.on-sidebar',
  'text.on-sidebar-strong',
  'accent.hover',
  'accent.pressed',
  'positive.subtle',
  'warning.subtle',
  'danger.subtle',
  'info.default',
  'info.subtle',
  'border.strong',
  'border.focus',
  'nav.surface-hover',
  'nav.surface-active',
] as const;

// Keys that existed before 006a — their values must not drift (published contract 06).
const PRE_006A = {
  'bg.base': '#ffffff',
  'bg.subtle': '#f7f7f8',
  'bg.inverse': '#111114',
  'text.primary': '#1a1a1f',
  'text.secondary': '#55555f',
  'text.inverse': '#ffffff',
  'accent.default': '#3b5bdb',
  'accent.subtle': '#e7ecfb',
  'positive.default': '#2f9e44',
  'warning.default': '#e8930c',
  'danger.default': '#d6336c',
  'border.default': '#e3e3e8',
} as const;

describe('ui-tokens contract 06 — additive-only extension', () => {
  it('preserves every pre-006a color value (back-compat)', () => {
    for (const [k, v] of Object.entries(PRE_006A)) {
      expect(tokens.color[k as keyof typeof tokens.color], `${k} drifted`).toBe(v);
    }
  });

  it('adds every proposed additive color key to the light theme', () => {
    for (const k of NEW_COLOR_KEYS) {
      expect(tokens.color, `missing light key ${k}`).toHaveProperty(k);
    }
  });

  it('exposes the exact hexes the Figma variables collection defines', () => {
    expect(tokens.color['text.muted']).toBe('#6b6b75');
    expect(tokens.color['text.on-sidebar']).toBe('#b9b9c2');
    expect(tokens.color['text.on-sidebar-strong']).toBe('#f7f7f8');
    expect(tokens.color['bg.sidebar']).toBe('#111114');
  });

  it('dark theme carries EXACTLY the same color keys as light (no key gaps)', () => {
    const lightKeys = Object.keys(tokens.color).sort();
    const darkKeys = Object.keys(darkColors).sort();
    expect(darkKeys).toEqual(lightKeys);
  });

  it('every color value is a hex string in both themes', () => {
    for (const map of [themes.light, themes.dark]) {
      for (const [k, v] of Object.entries(map)) {
        expect(v, `${k} not a hex`).toMatch(/^#[0-9a-f]{6}$/);
      }
    }
  });

  it('adds the compact-density type steps', () => {
    expect(tokens.type).toHaveProperty('size.2xl');
    expect(tokens.type).toHaveProperty('size.display');
  });

  it('emits css custom properties with the --prefix-key-name shape', () => {
    const base = baseCssVars();
    expect(base['--space-space-4']).toBe('16px');
    expect(base['--radius-radius-md']).toBe('8px');
    expect(base['--type-font-body']).toContain('system-ui');

    const light = colorCssVars('light');
    const dark = colorCssVars('dark');
    expect(light['--color-bg-base']).toBe('#ffffff');
    expect(light['--color-accent-default']).toBe('#3b5bdb');
    expect(dark['--color-bg-base']).toBe('#17171b');
    // Same variable names across themes (only values differ).
    expect(Object.keys(light).sort()).toEqual(Object.keys(dark).sort());
  });
});
