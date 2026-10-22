const ISSUE_REFERENCE = /\(#\d+\)\s*$/;

export default {
  extends: ['@commitlint/config-conventional'],
  plugins: [
    {
      rules: {
        'header-issue-reference': ({ header }) => [
          ISSUE_REFERENCE.test(header ?? ''),
          'header must end with an issue reference such as "(#1)"',
        ],
      },
    },
  ],
  rules: {
    'header-issue-reference': [2, 'always'],
    'header-max-length': [2, 'always', 100],
  },
};
