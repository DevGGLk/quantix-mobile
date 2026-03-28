jest.mock('@sentry/react-native', () => ({
  init: jest.fn(),
  wrap: (C) => C,
  captureException: jest.fn(),
  captureMessage: jest.fn(),
  setContext: jest.fn(),
  withScope: jest.fn((fn) => fn({ setExtra: jest.fn(), captureException: jest.fn() })),
}));
