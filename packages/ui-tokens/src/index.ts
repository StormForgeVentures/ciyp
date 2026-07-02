/**
 * @ciyp/ui-tokens — base design tokens (contract 06).
 * Instance-agnostic neutrals: the platform ships the structure; each tenant's brand arrives
 * as overrides via InstanceConfig.branding.themeTokens (contract 01). The UI composes
 * base ⊕ overrides. The Designer refines values during the design phase; keys are the API.
 */

export const tokens = {
  color: {
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
    'weight.regular': '400',
    'weight.medium': '500',
    'weight.bold': '700',
  },
} as const;

export type Tokens = typeof tokens;
