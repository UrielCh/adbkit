import eslint from '@eslint/js';
import tseslintParser from '@typescript-eslint/parser';
import tseslintPlugin from '@typescript-eslint/eslint-plugin';
import globals from 'globals';

export default [
    eslint.configs.recommended,
    {
        files: ['**/*.ts'],
        plugins: {
            '@typescript-eslint': tseslintPlugin,
        },
        languageOptions: {
            parser: tseslintParser,
            ecmaVersion: 2020,
            sourceType: 'module',
            globals: {
                ...globals.node,
                ...globals.browser,
                NodeJS: 'readonly',
                BufferEncoding: 'readonly',
            },
        },
        rules: {
            ...tseslintPlugin.configs.recommended.rules,
            'indent': ['error', 2, { 'SwitchCase': 1 }],
            'no-case-declarations': 'off',
            '@typescript-eslint/no-explicit-any': 'off',
            '@typescript-eslint/no-empty-object-type': 'off',
            '@typescript-eslint/no-unused-vars': ['error', { 'argsIgnorePattern': '^_', 'varsIgnorePattern': '^_' }],
            'no-constant-condition': 'off',
            'no-empty': 'off',
            'no-debugger': 'off',
        },
    },
    {
        ignores: [
            'dist/**/*',
            'docs/**/*',
            'test/**/*.js',
            '*.js',
            'lib/**/*.d.ts',
            'test/**/*.ts',
        ],
    }
];
