// AUD-03/AUD-02 follow-up: the startup review plan for a recovered draft. Pure: it maps the
// relation computed by classifyDraft to user-facing copy and the allowed actions. The dialog
// that shows it lives in the UI layer. Invariants: a file that changed on disk is never
// replaced automatically, and no draft is discarded without an explicit action.
import type { RecoveryRelation } from './recovery-journal';

export type ReviewAction = 'restore-draft' | 'keep-disk' | 'compare' | 'export-draft' | 'discard-draft';

export interface ReviewPlan {
  relation: RecoveryRelation;
  title: string;
  message: string;
  /** The default, focused action. Never 'restore-draft' when the file changed on disk. */
  primary: ReviewAction;
  /** Every action offered, in display order. */
  actions: readonly ReviewAction[];
}

export function planRecoveryReview(relation: RecoveryRelation): ReviewPlan {
  switch (relation) {
    case 'equal-hash':
      return {
        relation,
        title: 'Draft matches the file',
        message: 'The recovered text is identical to the file on disk. Nothing needs restoring.',
        primary: 'keep-disk',
        actions: ['keep-disk', 'discard-draft'],
      };
    case 'draft-newer':
      return {
        relation,
        title: 'Recovered draft is newer',
        message: 'The file has not changed since this draft was made. Restoring keeps your unsaved work.',
        primary: 'restore-draft',
        actions: ['restore-draft', 'export-draft', 'discard-draft'],
      };
    case 'disk-newer':
      return {
        relation,
        title: 'File changed after this draft',
        message: 'The file on disk was changed by another app or after this draft. Compare the two before choosing; nothing is replaced automatically.',
        primary: 'compare',
        actions: ['compare', 'keep-disk', 'export-draft'],
      };
    case 'unsaved':
      return {
        relation,
        title: 'Unsaved new document',
        message: 'This document was never saved to a file. Restore it, export a copy, or discard it.',
        primary: 'restore-draft',
        actions: ['restore-draft', 'export-draft', 'discard-draft'],
      };
  }
}
