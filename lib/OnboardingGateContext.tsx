import React, { createContext, useContext } from 'react';

export type OnboardingGateContextValue = {
  /** Libera el acceso a tabs / Home tras completar la inducción. */
  releaseToMainApp: () => void;
};

export const OnboardingGateContext = createContext<OnboardingGateContextValue | null>(null);

export function useOnboardingGate() {
  const v = useContext(OnboardingGateContext);
  if (!v) {
    throw new Error('useOnboardingGate debe usarse dentro de OnboardingGateContext.Provider');
  }
  return v;
}
