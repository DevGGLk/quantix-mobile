/** Nombre legible de la moneda de gamificación (fallback corporativo). */
export const GAMIFICATION_DEFAULT_CURRENCY_NAME = 'Puntos';

export function gamificationDisplayName(currencyName: string | null | undefined): string {
  const t = String(currencyName ?? '').trim();
  return t || GAMIFICATION_DEFAULT_CURRENCY_NAME;
}

/**
 * Cantidad + símbolo + nombre (ej. "1.234 🪙 Coins GGL").
 * Sin símbolo: solo cantidad + nombre.
 */
export function formatGamificationQuantity(
  amount: number,
  currencyName: string,
  currencySymbol: string
): string {
  const name = gamificationDisplayName(currencyName);
  const sym = String(currencySymbol ?? '').trim();
  const n = Number(amount);
  const formatted = Number.isFinite(n) ? n.toLocaleString() : String(amount);
  if (sym) return `${formatted} ${sym} ${name}`.replace(/\s+/g, ' ').trim();
  return `${formatted} ${name}`;
}

/** Movimiento de saldo (+/-) con unidad dinámica. */
export function formatGamificationTransactionAmount(
  amount: number,
  currencyName: string,
  currencySymbol: string
): string {
  const n = Number(amount);
  if (!Number.isFinite(n)) {
    return formatGamificationQuantity(0, currencyName, currencySymbol);
  }
  const sign = n > 0 ? '+' : n < 0 ? '−' : '';
  const abs = Math.abs(n);
  const core = formatGamificationQuantity(abs, currencyName, currencySymbol);
  return sign ? `${sign}${core}` : core;
}
