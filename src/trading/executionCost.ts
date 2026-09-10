export function estimateRoundTripCostPct(inputSol: number, minimumOutputSol: number, transactionReserveSol = 0.0033): number {
  if (![inputSol, minimumOutputSol, transactionReserveSol].every(Number.isFinite) || inputSol <= 0 || minimumOutputSol < 0 || transactionReserveSol < 0) {
    throw new Error('Invalid round-trip cost inputs');
  }
  return (inputSol - minimumOutputSol + transactionReserveSol) / inputSol * 100;
}
