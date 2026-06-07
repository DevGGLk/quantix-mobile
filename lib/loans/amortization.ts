/**
 * Amortización — portado de quantix-dashboard/lib/loans/amortization.ts (lógica pura).
 * Solo para PREVIEW en vivo en la calculadora del móvil; el servidor recalcula de forma
 * autoritativa al enviar la solicitud. Mantener en paridad con la versión del dashboard.
 */
export type AmortizationMethod = 'french' | 'declining_balance' | 'zero_interest';
export type PeriodType = 'weekly' | 'biweekly' | 'monthly';

export type AmortizationInput = {
  principal: number;
  annualInterestRate: number; // % anual; 0 = sin interés
  termPeriods: number;
  periodType: PeriodType;
  method: AmortizationMethod;
  startDate: string; // 'YYYY-MM-DD' — primera cuota
};

export type AmortizationInstallment = {
  number: number;
  dueDate: string;
  principal: number;
  interest: number;
  total: number;
  remainingBalance: number;
};

export type AmortizationSchedule = {
  installments: AmortizationInstallment[];
  totals: {
    principal: number;
    interest: number;
    total: number;
    averagePayment: number;
    firstPayment: number;
    lastPayment: number;
  };
  periodicRate: number;
  effectiveAnnualRate: number;
};

const PERIODS_PER_YEAR: Record<PeriodType, number> = {
  weekly: 52,
  biweekly: 24,
  monthly: 12,
};

function addPeriod(dateStr: string, periodType: PeriodType, count: number): string {
  if (count === 0) return dateStr;
  const [y, m, d] = dateStr.split('-').map(Number);
  if (periodType === 'monthly') {
    const date = new Date(y, m - 1 + count, d);
    if (date.getDate() !== d) date.setDate(0);
    return date.toISOString().slice(0, 10);
  }
  const days = periodType === 'weekly' ? 7 : 14;
  const ts = new Date(y, m - 1, d).getTime() + days * count * 86_400_000;
  return new Date(ts).toISOString().slice(0, 10);
}

function r2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function generateAmortizationSchedule(input: AmortizationInput): AmortizationSchedule {
  const { principal, annualInterestRate, termPeriods, periodType, method, startDate } = input;
  const periodsPerYear = PERIODS_PER_YEAR[periodType];
  const periodicRate = r2((annualInterestRate / periodsPerYear / 100) * 1e6) / 1e6;

  const installments: AmortizationInstallment[] = [];
  let balance = principal;
  let sumPrincipal = 0;
  let sumInterest = 0;

  if (method === 'french') {
    let payment: number;
    if (periodicRate === 0) {
      payment = r2(principal / termPeriods);
    } else {
      const pow = Math.pow(1 + periodicRate, termPeriods);
      payment = r2((principal * periodicRate * pow) / (pow - 1));
    }
    for (let i = 1; i <= termPeriods; i++) {
      const interest = r2(balance * periodicRate);
      let princ = r2(payment - interest);
      if (i === termPeriods) princ = r2(balance);
      balance = r2(balance - princ);
      const total = r2(princ + interest);
      installments.push({
        number: i,
        dueDate: addPeriod(startDate, periodType, i - 1),
        principal: princ,
        interest,
        total,
        remainingBalance: Math.max(0, balance),
      });
      sumPrincipal += princ;
      sumInterest += interest;
    }
  } else if (method === 'declining_balance') {
    const basePrinc = r2(principal / termPeriods);
    for (let i = 1; i <= termPeriods; i++) {
      const interest = r2(balance * periodicRate);
      const princ = i === termPeriods ? r2(balance) : basePrinc;
      balance = r2(balance - princ);
      const total = r2(princ + interest);
      installments.push({
        number: i,
        dueDate: addPeriod(startDate, periodType, i - 1),
        principal: princ,
        interest,
        total,
        remainingBalance: Math.max(0, balance),
      });
      sumPrincipal += princ;
      sumInterest += interest;
    }
  } else {
    const basePrinc = r2(principal / termPeriods);
    for (let i = 1; i <= termPeriods; i++) {
      const princ = i === termPeriods ? r2(balance) : basePrinc;
      balance = r2(balance - princ);
      installments.push({
        number: i,
        dueDate: addPeriod(startDate, periodType, i - 1),
        principal: princ,
        interest: 0,
        total: princ,
        remainingBalance: Math.max(0, balance),
      });
      sumPrincipal += princ;
    }
  }

  const effectiveAnnualRate =
    periodicRate > 0 ? r2((Math.pow(1 + periodicRate, periodsPerYear) - 1) * 100) : 0;

  const n = installments.length;
  return {
    installments,
    totals: {
      principal: r2(sumPrincipal),
      interest: r2(sumInterest),
      total: r2(sumPrincipal + sumInterest),
      averagePayment: n > 0 ? r2((sumPrincipal + sumInterest) / n) : 0,
      firstPayment: installments[0]?.total ?? 0,
      lastPayment: installments[n - 1]?.total ?? 0,
    },
    periodicRate,
    effectiveAnnualRate,
  };
}
