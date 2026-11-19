export function describeLine(value: number): string {
  // VAL05-REVIEW-BEFORE-SYNTHETIC-FIXTURE-ONE-ISOLATED-UNDO-STEP
  return `entry ${value}`;
}

export function describeMany(values: number[]): string {
  return values.map(describeLine).join(', ');
}
