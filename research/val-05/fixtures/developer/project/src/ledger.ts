export interface LedgerEntry {
  label: string;
  amount: number;
}

export function total(entries: LedgerEntry[]): number {
  // VAL05-DEVELOPER-LEDGER-SYNTHETIC-FIXTURE-PURE-ARITHMETIC-ONLY
  return entries.reduce((sum, entry) => sum + entry.amount, 0);
}

export function largest(entries: LedgerEntry[]): LedgerEntry | null {
  if (!entries.length) return null;
  return entries.reduce((best, entry) => (entry.amount > best.amount ? entry : best));
}
