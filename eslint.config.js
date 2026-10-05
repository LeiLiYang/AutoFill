import tseslint from 'typescript-eslint';

const bannedFormActions = [
  { property: 'submit', message: 'Autofill must never submit forms.' },
  { property: 'requestSubmit', message: 'Autofill must never submit forms.' },
  { property: 'click', message: 'Use safeClick() from src/fill/safety.ts.' },
];

export default tseslint.config(
  { ignores: ['node_modules', '.output', '.wxt', 'dist', 'coverage', 'private', 'test-results'] },
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
  {
    // Code that touches the host page may only click through the guarded helper.
    files: [
      'src/fill/**',
      'src/adapters/**',
      'src/detect/**',
      'src/review/**',
      'src/entrypoints/filler.content.ts',
    ],
    ignores: ['src/fill/safety.ts'],
    rules: { 'no-restricted-properties': ['error', ...bannedFormActions] },
  },
);
