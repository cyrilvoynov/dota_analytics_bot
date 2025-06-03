// eslint.config.js
const globals = require('globals');
const pluginJs = require('@eslint/js');
const pluginPrettierRecommended = require('eslint-plugin-prettier/recommended');

module.exports = [
  {
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'commonjs',
      globals: {
        ...globals.node, // Глобальные переменные Node.js
      },
    },
  },
  pluginJs.configs.recommended, // Базовые рекомендуемые правила ESLint
  pluginPrettierRecommended, // Интеграция с Prettier
  {
    rules: {
      'no-unused-vars': [
        'error',
        {
          args: 'all',
          argsIgnorePattern: '^_',
          vars: 'all',
          varsIgnorePattern: '^_',
          caughtErrors: 'all',
          caughtErrorsIgnorePattern: '^_',
          ignoreRestSiblings: true,
        },
      ],
      // 'no-console': 'warn',
    },
  },
];
