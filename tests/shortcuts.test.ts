import { describe, expect, it } from 'vitest';
import { menuMove, modShortcut, type ModShortcutContext } from '../src/shortcuts';

const chord = (overrides: Partial<ModShortcutContext> & { key: string }): ModShortcutContext => ({
  shiftKey: false, altKey: false, markdownBuffer: false, hasSelection: false, ...overrides,
});

describe('modShortcut', () => {
  it('maps the plain workbench chords', () => {
    const expected: Record<string, string> = {
      n: 'new', o: 'open', s: 'save', w: 'close', f: 'find',
      h: 'replace', b: 'sidebar', p: 'quick-open', g: 'goto-line', ',': 'settings',
    };
    for (const [ key, action ] of Object.entries(expected)) {
      expect(modShortcut(chord({ key }))).toEqual({ kind: 'action', action });
    }
  });

  it('reserves Ctrl+B for bold only in a Markdown note with a selection', () => {
    expect(modShortcut(chord({ key: 'b', markdownBuffer: true, hasSelection: true })))
      .toEqual({ kind: 'format', format: 'bold' });
    // A plain-text buffer, or a Markdown note with a bare caret, keeps the documented sidebar chord.
    expect(modShortcut(chord({ key: 'b', markdownBuffer: true }))).toEqual({ kind: 'action', action: 'sidebar' });
    expect(modShortcut(chord({ key: 'b', hasSelection: true }))).toEqual({ kind: 'action', action: 'sidebar' });
  });

  it('formats on Ctrl+I and Ctrl+K whenever no modifier narrows the meaning', () => {
    expect(modShortcut(chord({ key: 'i' }))).toEqual({ kind: 'format', format: 'italic' });
    expect(modShortcut(chord({ key: 'k' }))).toEqual({ kind: 'format', format: 'link' });
    expect(modShortcut(chord({ key: 'i', markdownBuffer: true, hasSelection: true })))
      .toEqual({ kind: 'format', format: 'italic' });
  });

  it('yields Ctrl+Shift+S to save-as and ignores other shifted chords', () => {
    expect(modShortcut(chord({ key: 's', shiftKey: true }))).toEqual({ kind: 'action', action: 'save-as' });
    expect(modShortcut(chord({ key: 'b', shiftKey: true }))).toBeNull();
    expect(modShortcut(chord({ key: 'p', shiftKey: true }))).toBeNull();
  });

  it('declines everything with Alt, so Alt-chords stay with their own handlers', () => {
    for (const key of ['n', 'd', 'b', 's', 'i']) {
      expect(modShortcut(chord({ key, altKey: true }))).toBeNull();
    }
  });

  it('leaves unbound keys and editor keys alone', () => {
    for (const key of ['z', 'y', 'x', 'a', 'v', 'c', 'space']) {
      expect(modShortcut(chord({ key }))).toBeNull();
    }
  });
});

describe('menuMove', () => {
  it('starts at the first or last item when focus is outside the menu', () => {
    expect(menuMove('ArrowDown', -1, 3)).toBe(0);
    expect(menuMove('ArrowUp', -1, 3)).toBe(2);
  });

  it('wraps in both directions', () => {
    expect(menuMove('ArrowDown', 2, 3)).toBe(0);
    expect(menuMove('ArrowUp', 0, 3)).toBe(2);
    expect(menuMove('ArrowDown', 0, 3)).toBe(1);
  });

  it('honours Home and End', () => {
    expect(menuMove('Home', 2, 5)).toBe(0);
    expect(menuMove('End', 1, 5)).toBe(4);
  });

  it('ignores other keys and empty menus', () => {
    expect(menuMove('Enter', 0, 3)).toBeNull();
    expect(menuMove('ArrowDown', 0, 0)).toBeNull();
  });
});
