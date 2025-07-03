module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  plugins: ['@typescript-eslint'],
  extends: ['eslint:recommended', 'plugin:@typescript-eslint/recommended'],
  rules: {
    '@typescript-eslint/explicit-function-return-type': 'error',
    // Mark as warning to not block during dev work, and allow with description
    '@typescript-eslint/ban-ts-comment': [
      'warn',
      {
        'ts-ignore': 'allow-with-description',
      },
    ],
    '@typescript-eslint/no-empty-object-type': [
      'error',
      {
        allowInterfaces: 'always',
      },
    ],
    semi: [2, 'always'],
  },
};
