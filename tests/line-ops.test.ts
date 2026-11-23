import { describe, expect, it } from 'vitest';
import { EditorState } from '@codemirror/state';
import {
  applyLineOperation, deleteLines, duplicateLines, joinLines, moveLines, sortLines, trimTrailingWhitespace,
  type LineOperation,
} from '../src/line-ops';
import type { TextEdit } from '../src/markdown-format';

/** Apply an edit the way CodeMirror would, so assertions read like the resulting document. */
function apply(text: string, edit: TextEdit | null): { text: string; start: number; end: number } {
  if (!edit) return { text, start: 0, end: 0 };
  const next = text.slice(0, edit.from) + edit.insert + text.slice(edit.to);
  return { text: next, start: edit.from, end: edit.from + edit.insert.length };
}

/**
 * Run an edit through CodeMirror exactly as `WrytroveApp.applyTextEdit` does. CodeMirror rejects
 * a selection that points outside the document with a RangeError, so this is the assertion that
 * matters for every line operation.
 */
function dispatch(text: string, edit: TextEdit): EditorState {
  const state = EditorState.create({ doc: text });
  return state.update({
    changes: { from: edit.from, to: edit.to, insert: edit.insert },
    selection: { anchor: edit.selection.from, head: edit.selection.to },
  }).state;
}

const ALL_OPERATIONS: LineOperation[] = ['duplicate', 'move-up', 'move-down', 'delete', 'sort', 'sort-desc', 'trim-trailing', 'join'];

describe('line operations', () => {
  it('duplicates the current line and keeps the caret on the copy', () => {
    const edit = duplicateLines('one\ntwo\nthree', { from: 5, to: 5 })!;
    expect(apply('one\ntwo\nthree', edit).text).toBe('one\ntwo\ntwo\nthree');
    expect(edit.selection.from).toBe(9);
  });

  it('moves lines up and down, and refuses to move past the ends', () => {
    expect(apply('a\nb\nc', moveLines('a\nb\nc', { from: 2, to: 2 }, 'up')).text).toBe('b\na\nc');
    expect(apply('a\nb\nc', moveLines('a\nb\nc', { from: 0, to: 0 }, 'down')).text).toBe('b\na\nc');
    expect(moveLines('a\nb', { from: 0, to: 0 }, 'up')).toBeNull();
    expect(moveLines('a\nb', { from: 3, to: 3 }, 'down')).toBeNull();
  });

  it('keeps the selection in range when moving a multi-line selection down into a final line', () => {
    // Regression: a selection that ended on the block's trailing newline was shifted past the end
    // of the document, so CodeMirror rejected the transaction and the command silently did nothing.
    const text = 'aa\nbb\ncc\ndd';
    const edit = moveLines(text, { from: 3, to: 9 }, 'down')!;
    expect(apply(text, edit).text).toBe('aa\ndd\nbb\ncc');
    const next = dispatch(text, edit);
    expect(next.doc.toString()).toBe('aa\ndd\nbb\ncc');
    expect(next.sliceDoc(next.selection.main.from, next.selection.main.to)).toBe('bb\ncc');
  });

  it('deletes a whole line including its newline', () => {
    expect(apply('a\nb\nc', deleteLines('a\nb\nc', { from: 2, to: 2 })).text).toBe('a\nc');
    expect(apply('a\nb', deleteLines('a\nb', { from: 2, to: 2 })).text).toBe('a');
  });

  it('sorts selected lines with natural numeric ordering', () => {
    const text = 'item10\nitem2\nitem1';
    expect(apply(text, sortLines(text, { from: 0, to: text.length })).text).toBe('item1\nitem2\nitem10');
    expect(sortLines('a\nb', { from: 0, to: 3 }, 'asc')).toBeNull();
  });

  it('trims trailing whitespace only when there is something to trim', () => {
    expect(apply('a  \nb\t', trimTrailingWhitespace('a  \nb\t', { from: 0, to: 5 })).text).toBe('a\nb');
    expect(trimTrailingWhitespace('clean', { from: 0, to: 5 })).toBeNull();
  });

  it('joins lines into one space-separated sentence', () => {
    expect(apply('one\ntwo\nthree', joinLines('one\ntwo\nthree', { from: 0, to: 13 })).text).toBe('one two three');
    expect(joinLines('single', { from: 0, to: 6 })).toBeNull();
  });

  it('dispatches every operation through one entry point', () => {
    expect(applyLineOperation('a\nb', { from: 0, to: 0 }, 'duplicate')!.insert).toBe('a\na');
    expect(applyLineOperation('a\nb', { from: 0, to: 3 }, 'sort-desc')!.insert).toBe('b\na');
    expect(applyLineOperation('a', { from: 0, to: 0 }, 'join')).toBeNull();
  });

  it('produces a CodeMirror-valid transaction for every operation on every line boundary', () => {
    // A selection may end on a line start, a line end or the document end; each is a distinct
    // shift case, and one of them used to be outside the document.
    const text = 'aa\nbb\ncc\ndd';
    const boundaries = [0, 1, 3, 4, 6, 7, 8, 9, 10, 11];
    for (const operation of ALL_OPERATIONS) {
      for (const from of boundaries) {
        for (const to of boundaries) {
          if (to < from) continue;
          const edit = applyLineOperation(text, { from, to }, operation);
          if (!edit) continue;
          const next = dispatch(text, edit);
          const problem = `${operation} ${from}-${to}`;
          expect(next.selection.main.from, problem).toBeGreaterThanOrEqual(0);
          expect(next.selection.main.to, problem).toBeLessThanOrEqual(next.doc.length);
          expect(apply(text, edit).text.length, problem).toBeGreaterThanOrEqual(next.selection.main.to);
        }
      }
    }
  });
});
