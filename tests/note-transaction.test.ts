import { describe, expect, it } from 'vitest';
import {
  executeNoteMoveTransaction,
  planNoteMoveTransaction,
  type NoteFileSnapshot,
  type NoteTransactionFs,
} from '../src/note-transaction';

function makeMockFs(initial: NoteFileSnapshot[]) {
  const store = new Map<string, { content: string; sha256: string }>();
  for (const f of initial) {
    if (f.readable !== false) {
      store.set(f.path, { content: f.content, sha256: f.sha256 });
    }
  }
  let indexRebuilt = 0;

  const fs: NoteTransactionFs = {
    async readHash(path) {
      return store.get(path)?.sha256 ?? null;
    },
    async readContent(path) {
      return store.get(path)?.content ?? null;
    },
    async stageWrite(path, content, expectedHash) {
      const current = store.get(path)?.sha256 ?? null;
      if (current !== expectedHash) {
        throw new Error(`Hash mismatch for ${path}`);
      }
      store.set(path, { content, sha256: `hash:${content.length}:${path}` });
    },
    async removeFile(path, expectedHash) {
      const current = store.get(path)?.sha256 ?? null;
      if (current !== expectedHash) {
        throw new Error(`Hash mismatch on remove for ${path}`);
      }
      store.delete(path);
    },
    async rebuildIndex() {
      indexRebuilt += 1;
    },
  };

  return { fs, store, getIndexRebuilt: () => indexRebuilt };
}

describe('note rename/move transaction planner and executor', () => {
  it('previews affected links, ambiguous links, and skipped files', () => {
    const files: NoteFileSnapshot[] = [
      { path: 'notes/alpha.md', content: '# Alpha', sha256: 'h-alpha' },
      { path: 'archive/alpha.md', content: '# Old Alpha', sha256: 'h-alpha-2' },
      { path: 'notes/index.md', content: 'See [[alpha]] and [[notes/alpha|Alpha Note]].', sha256: 'h-index' },
      { path: 'notes/binary.bin', content: '', sha256: 'h-bin', readable: false, skipReason: 'binary' },
    ];

    const plan = planNoteMoveTransaction({
      oldPath: 'notes/alpha.md',
      newPath: 'notes/alpha-renamed.md',
      files,
    });

    expect(plan.affectedLinks).toHaveLength(2);
    expect(plan.ambiguousLinks).toHaveLength(1);
    expect(plan.ambiguousLinks[0].originalLink).toBe('[[alpha]]');
    expect(plan.ambiguousLinks[0].accepted).toBe(false);
    expect(plan.affectedLinks[1].ambiguous).toBe(false);
    expect(plan.affectedLinks[1].accepted).toBe(true);
    expect(plan.skippedFiles).toEqual([{ path: 'notes/binary.bin', reason: 'binary' }]);
  });

  it('commits move, repairs accepted links, removes old path, and rebuilds index', async () => {
    const files: NoteFileSnapshot[] = [
      { path: 'notes/alpha.md', content: '# Alpha', sha256: 'h-alpha' },
      { path: 'notes/index.md', content: 'See [[alpha#intro|Intro]].', sha256: 'h-index' },
    ];
    const { fs, store, getIndexRebuilt } = makeMockFs(files);

    const plan = planNoteMoveTransaction({
      oldPath: 'notes/alpha.md',
      newPath: 'notes/beta.md',
      files,
    });

    const result = await executeNoteMoveTransaction(plan, fs);
    expect(result.status).toBe('committed');
    expect(store.has('notes/alpha.md')).toBe(false);
    expect(store.get('notes/beta.md')?.content).toBe('# Alpha');
    expect(store.get('notes/index.md')?.content).toBe('See [[beta#intro|Intro]].');
    expect(getIndexRebuilt()).toBe(1);
  });

  it('aborts cleanly on external hash conflict without mutating files', async () => {
    const files: NoteFileSnapshot[] = [
      { path: 'notes/alpha.md', content: '# Alpha', sha256: 'h-alpha' },
      { path: 'notes/index.md', content: 'See [[alpha]].', sha256: 'h-index' },
    ];
    const { fs, store, getIndexRebuilt } = makeMockFs(files);

    const plan = planNoteMoveTransaction({
      oldPath: 'notes/alpha.md',
      newPath: 'notes/beta.md',
      files,
    });

    // Simulate external modification to index.md
    store.set('notes/index.md', { content: 'Modified externally', sha256: 'h-index-modified' });

    const result = await executeNoteMoveTransaction(plan, fs);
    expect(result.status).toBe('aborted');
    expect(result.manualCopyPath).toBe('notes/alpha.md');
    expect(store.has('notes/alpha.md')).toBe(true);
    expect(store.has('notes/beta.md')).toBe(false);
    expect(getIndexRebuilt()).toBe(0);
  });
});
