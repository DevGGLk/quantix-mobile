import { decideOnboardingGate } from '../lib/onboardingGate';

describe('decideOnboardingGate', () => {
  it('sin sesión → loading', () => {
    expect(
      decideOnboardingGate({
        hasSession: false,
        employeeCompanyId: 'c1',
        onboardingCompleted: false,
        companyOnboardingEnabled: true,
        companyFetchFailed: false,
      })
    ).toBe('loading');
  });

  it('sin company en expediente → app', () => {
    expect(
      decideOnboardingGate({
        hasSession: true,
        employeeCompanyId: null,
        onboardingCompleted: false,
        companyOnboardingEnabled: true,
        companyFetchFailed: false,
      })
    ).toBe('app');
  });

  it('fallo al cargar empresa → app', () => {
    expect(
      decideOnboardingGate({
        hasSession: true,
        employeeCompanyId: 'c1',
        onboardingCompleted: false,
        companyOnboardingEnabled: null,
        companyFetchFailed: true,
      })
    ).toBe('app');
  });

  it('onboarding activo y no completado → onboarding', () => {
    expect(
      decideOnboardingGate({
        hasSession: true,
        employeeCompanyId: 'c1',
        onboardingCompleted: false,
        companyOnboardingEnabled: true,
        companyFetchFailed: false,
      })
    ).toBe('onboarding');
  });

  it('onboarding activo y ya completado → app', () => {
    expect(
      decideOnboardingGate({
        hasSession: true,
        employeeCompanyId: 'c1',
        onboardingCompleted: true,
        companyOnboardingEnabled: true,
        companyFetchFailed: false,
      })
    ).toBe('app');
  });

  it('onboarding desactivado en empresa → app', () => {
    expect(
      decideOnboardingGate({
        hasSession: true,
        employeeCompanyId: 'c1',
        onboardingCompleted: false,
        companyOnboardingEnabled: false,
        companyFetchFailed: false,
      })
    ).toBe('app');
  });
});
