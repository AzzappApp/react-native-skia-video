import js from '@eslint/js';
import { fixupPluginRules } from '@eslint/compat';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import prettierRecommended from 'eslint-plugin-prettier/recommended';

export default tseslint.config(
  {
    ignores: [
      'node_modules',
      'lib/',
      '.yarn/',
      '.turbo/',
      'coverage/',
      'example/vendor/',
    ],
  },
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    ...react.configs.flat.recommended,
    // eslint-plugin-react still relies on ESLint APIs removed in v10.
    plugins: { react: fixupPluginRules(react) },
  },
  reactHooks.configs.flat.recommended,
  prettierRecommended,
  {
    languageOptions: {
      globals: {
        ...globals.node,
      },
      ecmaVersion: 2022,
      sourceType: 'module',
    },
    settings: {
      react: {
        version: 'detect',
      },
    },
    rules: {
      'react/react-in-jsx-scope': 'off',
      // These React Compiler rules don't understand Reanimated shared values
      // and the imperative native player objects this library exposes.
      'react-hooks/immutability': 'off',
      'react-hooks/set-state-in-effect': 'off',
      '@typescript-eslint/no-shadow': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-require-imports': 'off',
      'prettier/prettier': 'error',
    },
  }
);
