import cds from '@sap/cds/eslint.config.mjs';
export default [
  ...cds.recommended,
  // cds.recommended's browser config (app/**) is missing a couple of
  // legitimate browser globals we actually use.
  {
    files: ['**/app/**/*.js'],
    languageOptions: { globals: {
      WebSocket: 'readonly', navigator: 'readonly',
      createImageBitmap: 'readonly', FileReader: 'readonly',
      MutationObserver: 'readonly',
    } },
  },
  // scripts/ are CLI diagnostic tools - console output is the whole point.
  {
    files: ['scripts/**/*.mjs', 'scripts/**/*.js'],
    rules: { 'no-console': 'off' },
  },
  // `_`-prefixed bindings are the destructure-to-omit-keys idiom (see
  // publicState() in the game plugins) - intentionally unused.
  {
    rules: {
      'no-unused-vars': ['warn', { varsIgnorePattern: '^_', argsIgnorePattern: '^_' }],
    },
  },
];
