// @ciyp/api flat config — inherits the root ruleset and adds the custom
// `no-jwt-in-resolved-scope` rule over the Sport runtime edge (PRD-002b FR-9 / AC-5).
import root from '../../eslint.config.mjs';
import scopeGuard from './src/eslint-rules/no-jwt-in-resolved-scope.mjs';

export default [
  ...root,
  {
    files: ['src/lib/sport/**/*.ts', 'src/evals/**/*.ts'],
    plugins: {
      'ciyp-sport': scopeGuard,
    },
    rules: {
      'ciyp-sport/no-jwt-in-resolved-scope': 'error',
    },
  },
  {
    // Eval CLI + smoke output is console-driven UX (parity with @ciyp/db).
    files: ['src/evals/**/*.ts'],
    rules: { 'no-console': 'off' },
  },
];
