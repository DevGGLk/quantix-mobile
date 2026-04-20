export type OnboardingGateDecision = 'loading' | 'onboarding' | 'app';

export type OnboardingGateInput = {
  hasSession: boolean;
  /** Existe fila en `employees` para el usuario (no administrativo/externo sin expediente). */
  isOperativeEmployee: boolean;
  /** `employees.company_id` del expediente activo */
  employeeCompanyId: string | null;
  onboardingCompleted: boolean;
  companyOnboardingEnabled: boolean | null;
  companyFetchFailed: boolean;
};

/**
 * Lógica pura del gate de inducción (testeable sin React).
 * Sin expediente operativo → app (inducción laboral no aplica).
 * Si no hay empresa en el expediente → app (no bloquear, p. ej. superadmin con expediente raro).
 */
export function decideOnboardingGate(input: OnboardingGateInput): OnboardingGateDecision {
  if (!input.hasSession) return 'loading';

  if (!input.isOperativeEmployee) return 'app';

  if (!input.employeeCompanyId) return 'app';

  if (input.companyFetchFailed || input.companyOnboardingEnabled === null) return 'app';

  if (input.companyOnboardingEnabled && !input.onboardingCompleted) return 'onboarding';

  return 'app';
}
