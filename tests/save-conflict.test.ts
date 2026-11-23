import { describe, expect, it } from 'vitest';
import { nativePathKey, planConflictRetry, sameNativePath, saveAttempt } from '../src/save-conflict';

describe('native path comparison', () => {
  it('treats Windows paths as case- and separator-insensitive', () => {
    expect(sameNativePath('C:\\Notes\\a.md', 'c:/notes/A.MD')).toBe(true);
    expect(sameNativePath('C:\\Notes\\a.md', 'C:\\Notes\\b.md')).toBe(false);
    // Different drives are different files, even with the same trailing path.
    expect(sameNativePath('C:\\a.md', 'D:\\a.md')).toBe(false);
    // A trailing separator difference is not folded here: the caller normalizes paths first.
    expect(sameNativePath('C:\\Notes', 'C:\\Notes\\')).toBe(false);
  });

  it('folds UNC shares like drive paths', () => {
    expect(sameNativePath('\\\\server\\share\\a.md', '\\\\SERVER\\SHARE\\A.MD')).toBe(true);
  });

  it('keeps POSIX paths case-sensitive', () => {
    expect(sameNativePath('/home/me/Notes.md', '/home/me/notes.md')).toBe(false);
    expect(sameNativePath('/home/me/a.md', '/home/me/a.md')).toBe(true);
    // A leading slash is not a UNC prefix, so no folding happens.
    expect(nativePathKey('/Home/Me')).toBe('/Home/Me');
  });
});

describe('conflict retry planning', () => {
  it('stops when the user cancels', () => {
    expect(planConflictRetry('cancel')).toEqual({ retry: false, chooseTarget: false, force: false });
  });

  it('re-checks a newly chosen destination instead of forcing it', () => {
    expect(planConflictRetry('save-as')).toEqual({ retry: true, chooseTarget: true, force: false });
  });

  it('retries the same destination only when explicitly forced', () => {
    expect(planConflictRetry('overwrite')).toEqual({ retry: true, chooseTarget: false, force: true });
  });
});

describe('save attempt expectation', () => {
  it('sends the recorded hash only for the original destination', () => {
    expect(saveAttempt({ sameTarget: true, hash: 'a'.repeat(64) })).toEqual({ expected: 'a'.repeat(64) });
    expect(saveAttempt({ sameTarget: false, hash: 'a'.repeat(64) })).toEqual({ expected: null });
    expect(saveAttempt({ sameTarget: true, hash: null })).toEqual({ expected: null });
  });
});
