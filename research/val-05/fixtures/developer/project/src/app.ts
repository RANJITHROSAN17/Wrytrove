import { total } from './ledger';

export interface ViewLine {
  label: string;
  amount: number;
}

export function renderLine(line: ViewLine): string {
  return `${line.label}: ${line.amount}`;
}

export function renderReport(lines: ViewLine[]): string {
  // VAL05-DEVELOPER-APP-SYNTHETIC-FIXTURE-LANTERN-SEARCH-TARGET
  const rows = lines.map(renderLine);
  rows.push(`total: ${total(lines)}`);
  return rows.join('\n');
}
