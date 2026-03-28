export type OnboardingGateDecision = 'loading' | 'onboarding' | 'app';

export type OnboardingGateInput = {
  hasSession: boolean;
  /** `employees.company_id` del expediente activo */
  employeeCompanyId: string | null;
  onboardingCompleted: boolean;
  companyOnboardingEnabled: boolean | null;
  companyFetchFailed: boolean;
};

/**
 * Lógica pura del gate de inducción (testeable sin React).
 * Si no hay empresa en el expediente → app (no bloquear, p. ej. superadmin).
 */
export function decideOnboardingGate(input: OnboardingGateInput): OnboardingGateDecision {
  if (!input.hasSession) return 'loading';

  if (!input.employeeCompanyId) return 'app';

  if (input.companyFetchFailed || input.companyOnboardingEnabled === null) return 'app';

  if (input.companyOnboardingEnabled && !input.onboardingCompleted) return 'onboarding';

  return 'app';
}
