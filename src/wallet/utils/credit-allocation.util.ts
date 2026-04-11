export interface CreditDebitBreakdown {
  totalDebited: number;
  promotionalDebited: number;
  realDebited: number;
}

const round2 = (value: number): number => Math.round(value * 100) / 100;

export function allocateCreditDebit(
  balance: number,
  promotionalBalance: number,
  amountToDebit: number,
): CreditDebitBreakdown {
  const safeAmount = round2(Math.max(0, amountToDebit));
  const safeBalance = round2(Math.max(0, balance));
  const safePromoBalance = round2(Math.max(0, promotionalBalance));

  if (safeAmount > safeBalance) {
    throw new Error('INSUFFICIENT_BALANCE');
  }

  // Policy: consume promotional balance first to avoid contaminating real revenue/earnings.
  const promotionalDebited = round2(Math.min(safePromoBalance, safeAmount));
  const realDebited = round2(safeAmount - promotionalDebited);

  return {
    totalDebited: safeAmount,
    promotionalDebited,
    realDebited,
  };
}
