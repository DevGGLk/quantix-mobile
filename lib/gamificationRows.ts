/** Filas típicas de `gamification_settings` / `gamification_balances`. */
export type GamificationSettingsRow = {
  currency_name?: string | null;
  symbol?: string | null;
};

export type GamificationBalanceRow = {
  balance?: number | null;
};
