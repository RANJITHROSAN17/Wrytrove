import { renderReport } from '../src/app';

const sample = [
  { label: 'harbor', amount: 2 },
  { label: 'lantern', amount: 3 },
];

// VAL05-DEVELOPER-TEST-SYNTHETIC-FIXTURE-LANTERN-APPEARS-IN-A-TEST
export function expectedReport(): string {
  return renderReport(sample);
}

export function checkTotal(): boolean {
  return expectedReport().endsWith('total: 5');
}
