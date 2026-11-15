import { describe, expect, it } from 'vitest';
import { planRecoveryReview, type ReviewAction } from '../src/recovery-review';
import type { RecoveryRelation } from '../src/recovery-journal';

const relations: RecoveryRelation[] = ['equal-hash', 'draft-newer', 'disk-newer', 'unsaved'];

describe('recovery review plan', () => {
  it('gives every relation a distinct title', () => {
    const titles = relations.map((r) => planRecoveryReview(r).title);
    expect(new Set(titles).size).toBe(relations.length);
  });

  it('never makes restoring the draft the default when the file changed on disk', () => {
    const plan = planRecoveryReview('disk-newer');
    expect(plan.primary).toBe('compare');
    expect(plan.actions).not.toContain('restore-draft');
  });

  it('offers restore only when the draft is the newer or only copy of the work', () => {
    expect(planRecoveryReview('draft-newer').primary).toBe('restore-draft');
    expect(planRecoveryReview('unsaved').primary).toBe('restore-draft');
    expect(planRecoveryReview('equal-hash').actions).not.toContain('restore-draft');
  });

  it('never silently discards: every plan that could hold unique text offers an export first', () => {
    for (const relation of ['draft-newer', 'disk-newer', 'unsaved'] as const) {
      const actions: ReviewAction[] = [...planRecoveryReview(relation).actions];
      expect(actions).toContain('export-draft');
      if (actions.includes('discard-draft')) expect(actions.indexOf('export-draft')).toBeLessThan(actions.indexOf('discard-draft'));
    }
  });

  it('primary action is always one of the offered actions', () => {
    for (const relation of relations) {
      const plan = planRecoveryReview(relation);
      expect(plan.actions).toContain(plan.primary);
    }
  });
});

import { decideRestore } from '../src/recovery-review';

describe('startup restore decision', () => {
  it('keeps the snapshot when there is no draft or the text is the same', () => {
    expect(decideRestore(false, true, 'draft-newer')).toBe('snapshot');
    expect(decideRestore(true, false, 'draft-newer')).toBe('snapshot');
  });

  it('never applies a draft whose file changed on disk; it goes to review', () => {
    expect(decideRestore(true, true, 'disk-newer')).toBe('review');
    expect(decideRestore(true, true, null)).toBe('draft');
  });

  it('applies the draft when it is newer, unsaved, or identical to the file', () => {
    expect(decideRestore(true, true, 'draft-newer')).toBe('draft');
    expect(decideRestore(true, true, 'unsaved')).toBe('draft');
    expect(decideRestore(true, true, 'equal-hash')).toBe('draft');
  });
});
