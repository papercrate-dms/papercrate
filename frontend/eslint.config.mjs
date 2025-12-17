import js from '@eslint/js';
import pluginReact from 'eslint-plugin-react';
import pluginReactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tsParser from '@typescript-eslint/parser';
import tsPluginImport from '@typescript-eslint/eslint-plugin';

const tsPlugin = tsPluginImport.default ?? tsPluginImport;

const sharedRules = {
  ...js.configs.recommended.rules,
  ...pluginReact.configs.recommended.rules,
  ...pluginReactHooks.configs.recommended.rules,
  'no-use-before-define': [
    'error',
    { functions: false, classes: true, variables: true },
  ],
  'react/react-in-jsx-scope': 'off',
  'react/prop-types': 'off',
  'react-hooks/set-state-in-effect': 'off',
  'react-hooks/refs': 'off',
  'react-hooks/preserve-manual-memoization': 'off',
};

const sharedLanguageOptions = {
  ecmaVersion: 'latest',
  sourceType: 'module',
  parserOptions: {
    ecmaFeatures: {
      jsx: true,
    },
  },
  globals: {
    ...globals.browser,
    ...globals.node,
  },
};

export default [
  {
    ignores: ['dist', 'node_modules'],
  },
  {
    files: ['src/**/*.{js,jsx}', 'tests/**/*.{js,jsx}'],
    languageOptions: sharedLanguageOptions,
    plugins: {
      react: pluginReact,
      'react-hooks': pluginReactHooks,
      '@typescript-eslint': tsPlugin,
    },
    settings: {
      react: {
        version: 'detect',
      },
    },
    rules: sharedRules,
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: {
      ...sharedLanguageOptions,
      parser: tsParser,
    },
    plugins: {
      react: pluginReact,
      'react-hooks': pluginReactHooks,
      '@typescript-eslint': tsPlugin,
    },
    settings: {
      react: {
        version: 'detect',
      },
    },
    rules: {
      ...sharedRules,
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
        },
      ],
    },
  },
];
