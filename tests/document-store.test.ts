import { describe, expect, it } from 'vitest';
import { DocumentStore } from '../src/services/document-store';

describe('DocumentStore service', () => {
  it('tracks open, dirty, revision, and clean save transitions without DOM', () => {
    const store = new DocumentStore();
    const events: number[] = [];
    const unsub = store.subscribe((d) => events.push(d.revision));

    const doc = store.open({ id: 'd1', path: 'note.md', content: 'hello', baseHash: 'h1' });
    expect(doc.dirty).toBe(false);
    expect(doc.revision).toBe(1);

    const edited = store.updateContent('d1', 'hello world');
    expect(edited.dirty).toBe(true);
    expect(edited.revision).toBe(2);

    expect(store.canSave('d1', 2, 'h1')).toEqual({ allowed: true, reason: 'ok' });
    const saved = store.markSaved('d1', 2, 'h2');
    expect(saved.dirty).toBe(false);
    expect(saved.baseHash).toBe('h2');

    unsub();
    expect(events).toEqual([1, 2, 2]);
  });

  it('rejects stale revisions and external hash mismatches', () => {
    const store = new DocumentStore();
    store.open({ id: 'd1', path: 'note.md', content: 'v1', baseHash: 'h1' });
    store.updateContent('d1', 'v2');

    expect(store.canSave('d1', 1, 'h1')).toEqual({ allowed: false, reason: 'stale-revision' });
    expect(store.canSave('d1', 2, 'h-external')).toEqual({
      allowed: false,
      reason: 'external-hash-mismatch',
    });
    expect(store.canSave('missing', 1, null)).toEqual({ allowed: false, reason: 'not-found' });
  });
});
