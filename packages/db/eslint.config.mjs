// @ciyp/db is a dev/CLI package (seed + verify + isolation proof): console output
// is the primary UX, so allow it here while inheriting the root ruleset.
import root from '../../eslint.config.mjs';

export default [
  ...root,
  {
    files: ['src/**/*.ts', 'test/**/*.ts'],
    rules: {
      'no-console': 'off',
    },
  },
];
