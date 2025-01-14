module.exports = {
  env: {
    es6: true,
    node: true,
  },
  globals: {
    idx: true,
  },
  extends: [
    'airbnb-base/legacy',
    'prettier',
    'plugin:@typescript-eslint/recommended',
    'plugin:prettier/recommended',
  ],
  parser: 'babel-eslint',
  rules: {
    '@typescript-eslint/indent': 0, // handled by prettier
    '@typescript-eslint/no-use-before-define': 0, // too many errors in existing js code: revisit later
    'no-extend-native': 0,
    'func-names': 0,
    'guard-for-in': 0,
    'no-restricted-syntax': 0,
    'no-param-reassign': 0,
    'no-multi-assign': 0,
    'global-require': 0,
    'vars-on-top': 0,
    'block-scoped-var': 0,
    'no-underscore-dangle': 0,
    'no-use-before-define': 0,
    'no-plusplus': 0,
    'no-await-in-loop': 0,
    'consistent-return': 0,
    'default-case': 0,
    'no-void': 0,
    'linebreak-style': ['error', 'unix'],
    'no-console': 0,
    'no-case-declarations': 0,
    'no-unused-vars': [
      2,
      {
        argsIgnorePattern: '^__+$',
        varsIgnorePattern: '^__+$',
      },
    ],
  },
  overrides: [
    {
      files: ['**/*.test.js', '**/*.test.ts'],
      env: {
        jest: true, // now **/*.test.js files' env has both es6 *and* jest
      },
      // Can't extend in overrides: https://github.com/eslint/eslint/issues/8813
      // "extends": ["plugin:jest/recommended"]
      plugins: ['jest'],
      rules: {
        'jest/no-disabled-tests': 'warn',
        'jest/no-focused-tests': 'error',
        'jest/no-identical-title': 'error',
        'jest/prefer-to-have-length': 'warn',
        'jest/valid-expect': 'error',
      },
    },
  ],
};
