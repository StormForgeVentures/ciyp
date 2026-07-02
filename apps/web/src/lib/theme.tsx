/**
 * ThemeProvider — the single binding point between the ui-tokens package and the DOM. Every
 * visual value in the console comes from a CSS custom property injected here from
 * @stormforgeventures/ciyp-ui-tokens; components reference `var(--color-*)` / `var(--space-*)`
 * and never a raw hex/px. Tim's pending design answers (font / accent / density) are a swap of
 * the package values, not a rebuild. Light is primary; dark is a full parallel theme.
 */
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { baseCssVars, colorCssVars, type ThemeName } from '@stormforgeventures/ciyp-ui-tokens';

interface ThemeCtx {
  theme: ThemeName;
  toggle: () => void;
}
const Ctx = createContext<ThemeCtx | null>(null);

const STORAGE_KEY = 'ciyp.theme';

function applyVars(theme: ThemeName): void {
  const root = document.documentElement;
  const vars = { ...baseCssVars(), ...colorCssVars(theme) };
  for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);
  root.setAttribute('data-theme', theme);
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<ThemeName>(() => {
    const saved = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;
    return saved === 'dark' ? 'dark' : 'light';
  });

  useEffect(() => {
    applyVars(theme);
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      /* private mode */
    }
  }, [theme]);

  const value = useMemo<ThemeCtx>(
    () => ({ theme, toggle: () => setTheme((t) => (t === 'light' ? 'dark' : 'light')) }),
    [theme],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useTheme(): ThemeCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error('useTheme must be used within ThemeProvider');
  return v;
}
