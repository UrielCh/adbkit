import tsParser from '@typescript-eslint/parser';
import tsPlugin from '@typescript-eslint/eslint-plugin';

export default [
  {
    ignores: ['dist/**/*', 'docs/**/*', 'test/**/*.js', '*.js', 'lib/**/*.d.ts', 'test/**/*.ts'],
  },
  {
    files: ['**/*.ts'],
    // linterOptions: {
    //   reportUnusedDisableDirectives: 'off',
    // },
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 2020,
        sourceType: 'module',
        project: ['./tsconfig.eslint.json'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
    },
    rules: {
      'no-case-declarations': 'off',
      '@typescript-eslint/no-empty-interface': 'off',
      '@typescript-eslint/no-empty-object-type': 'off',
      '@typescript-eslint/no-floating-promises': ['error', { ignoreVoid: true }],
    },
  },
];
