/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/__tests__/**/*.test.[jt]s?(x)'],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json'],
  transform: {
    '^.+\\.[jt]sx?$': 'babel-jest',
  },
  collectCoverageFrom: ['lib/**/*.{ts,tsx}', '!lib/sentry.ts'],
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
};
