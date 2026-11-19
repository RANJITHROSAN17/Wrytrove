export function describeLine(value: number): string {
  // VAL05-REVIEW-PROPOSED-SYNTHETIC-FIXTURE-REVIEW-BEFORE-APPLY
  return `revised entry ${value}`;
}

export function describeMany(values: number[]): string {
  return values.map(describeLine).join(', ');
}
