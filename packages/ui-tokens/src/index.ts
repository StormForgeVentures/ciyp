/**
 * @stormforgeventures/ciyp-ui-tokens — base design tokens (contract 06).
 * Instance-agnostic neutrals: the platform ships the structure; each tenant's brand arrives
 * as overrides via InstanceConfig.branding.themeTokens (contract 01). The UI composes
 * base ⊕ overrides. The Designer refines values during the design phase; keys are the API.
 *
 * PRD-006a additive-only extension (2026-07-02): the admin-console design system needs a
 * third text tier, on-fill/on-sidebar text tokens, accent interaction states, elevated/overlay
 * surfaces, a dark sidebar surface, nav interaction fills, an info hue, and soft badge tints.
 * Keys are additive — every pre-existing key keeps its value, so the package API stays
 * back-compatible. Six values (accent.default, text.muted, text.inverse, text.on-sidebar,
 * text.on-sidebar-strong, bg.sidebar) are the exact hexes exposed by the CIYP Figma variables
 * collection; the remainder are derived from docs/design-brief.md (slate + indigo ramps, AA on
 * their intended surface) pending Tim's 4 open design answers (font / accent hex / density),
 * which remain a value swap — not a rebuild.
 */

/**
 * Light theme — the primary mode. `tokens` remains the canonical light export (back-compat:
 * every key present before 006a is unchanged).
 */
export const tokens = {
  color: {
    // — surfaces —
    'bg.base': '#ffffff',
    'bg.subtle': '#f7f7f8',
    'bg.elevated': '#ffffff', // card surface, distinct from the subtle page bg
    'bg.overlay': '#ffffff', // dropdown / menu / modal surface
    'bg.inverse': '#111114',
    'bg.sidebar': '#111114', // dark sidebar in BOTH modes (structural, not brand) — Figma
    // — text —
    'text.primary': '#1a1a1f',
    'text.secondary': '#55555f',
    'text.muted': '#6b6b75', // third tier: timestamps / captions — Figma
    'text.inverse': '#ffffff', // Figma
    'text.on-accent': '#ffffff', // label on accent fill — never bind fill+text to one token
    'text.on-sidebar': '#b9b9c2', // nav label on dark sidebar — Figma
    'text.on-sidebar-strong': '#f7f7f8', // active/brand label on dark sidebar — Figma
    // — accent (single themeable action hue) —
    'accent.default': '#3b5bdb', // Figma
    'accent.hover': '#364fc7',
    'accent.pressed': '#2f44b0',
    'accent.subtle': '#e7ecfb', // soft badge / active-pill fill
    // — semantic hues —
    'positive.default': '#2f9e44',
    'positive.subtle': '#e6f4ea',
    'warning.default': '#e8930c',
    'warning.subtle': '#fbeecd',
    'danger.default': '#d6336c',
    'danger.subtle': '#fbe0ea',
    'info.default': '#1c7ed6',
    'info.subtle': '#e2f0fb',
    // — borders —
    'border.default': '#e3e3e8',
    'border.strong': '#c7c7cf',
    'border.focus': '#3b5bdb', // focus ring
    // — nav interaction fills (on the dark sidebar) —
    'nav.surface-hover': '#1c1c22',
    'nav.surface-active': '#1e2440', // subtle indigo-tinted active pill
  },
  space: {
    'space.1': '4px',
    'space.2': '8px',
    'space.3': '12px',
    'space.4': '16px',
    'space.5': '24px',
    'space.6': '32px',
    'space.7': '48px',
    'space.8': '64px',
  },
  radius: {
    'radius.sm': '4px',
    'radius.md': '8px',
    'radius.lg': '16px',
    'radius.full': '9999px',
  },
  type: {
    'font.body': "system-ui, -apple-system, 'Segoe UI', sans-serif",
    'font.display': "system-ui, -apple-system, 'Segoe UI', sans-serif",
    'size.xs': '12px',
    'size.sm': '14px',
    'size.md': '16px',
    'size.lg': '20px',
    'size.xl': '28px',
    'size.2xl': '34px', // page title (compact-density admin)
    'size.display': '44px', // big stat numerals
    'weight.regular': '400',
    'weight.medium': '500',
    'weight.bold': '700',
  },
} as const;

export type Tokens = typeof tokens;
export type ColorKey = keyof typeof tokens.color;

/**
 * Dark theme — same color KEYS as light (the API), different values. Light content + a dark
 * neutral sidebar in both modes matches the donor idiom; in dark mode the content surfaces go
 * dark and `bg.elevated` becomes load-bearing (cards must read as raised off `bg.base`).
 */
export const darkColors: Record<ColorKey, string> = {
  // — surfaces —
  'bg.base': '#17171b',
  'bg.subtle': '#1d1d22',
  'bg.elevated': '#212127',
  'bg.overlay': '#26262d',
  'bg.inverse': '#f7f7f8',
  'bg.sidebar': '#111114',
  // — text —
  'text.primary': '#f2f2f5',
  'text.secondary': '#a8a8b3',
  'text.muted': '#7a7a85',
  'text.inverse': '#111114',
  'text.on-accent': '#ffffff',
  'text.on-sidebar': '#b9b9c2',
  'text.on-sidebar-strong': '#f7f7f8',
  // — accent (lightened for AA on dark surfaces) —
  'accent.default': '#7c8cf5',
  'accent.hover': '#8b99f7',
  'accent.pressed': '#6274e7',
  'accent.subtle': '#1f2540',
  // — semantic hues (lightened for dark) —
  'positive.default': '#37b24d',
  'positive.subtle': '#16281c',
  'warning.default': '#f0a020',
  'warning.subtle': '#2b2113',
  'danger.default': '#e64980',
  'danger.subtle': '#2b1620',
  'info.default': '#4dabf7',
  'info.subtle': '#12293b',
  // — borders —
  'border.default': '#2c2c34',
  'border.strong': '#3a3a44',
  'border.focus': '#7c8cf5',
  // — nav interaction fills —
  'nav.surface-hover': '#1c1c22',
  'nav.surface-active': '#23294a',
};

export const themes = {
  light: tokens.color as Record<ColorKey, string>,
  dark: darkColors,
} as const;

export type ThemeName = keyof typeof themes;

/** `bg.base` → `--color-bg-base` (dots and case-fold to a css-var-safe name). */
function toVarName(prefix: string, key: string): string {
  return `--${prefix}-${key.replace(/\./g, '-')}`;
}

/** Theme-independent tokens (space/radius/type) as CSS custom properties. */
export function baseCssVars(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(tokens.space)) out[toVarName('space', k)] = v;
  for (const [k, v] of Object.entries(tokens.radius)) out[toVarName('radius', k)] = v;
  for (const [k, v] of Object.entries(tokens.type)) out[toVarName('type', k)] = v;
  return out;
}

/** Color tokens for one theme as CSS custom properties (`--color-*`). */
export function colorCssVars(theme: ThemeName): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(themes[theme])) out[toVarName('color', k)] = v;
  return out;
}
