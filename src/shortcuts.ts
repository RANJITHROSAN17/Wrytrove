/**
 * Pure keyboard decisions lifted out of `main.ts`'s single keydown handler.
 *
 * The handler stays in `main.ts` because it mutates the editor; the *decisions* — which chord wins,
 * where a menu's focus moves — live here so they can be tested without a browser or a CodeMirror
 * view. `Ctrl+B` is the interesting case: it means "bold" only in a Markdown note with a selection,
 * and "toggle sidebar" everywhere else.
 */
export type FormatShortcut = 'bold' | 'italic' | 'link';

export type ModShortcut =
  | { kind: 'format'; format: FormatShortcut }
  | { kind: 'action'; action: string }
  | null;

/** Plain Ctrl/Cmd chords that map straight onto a workbench action. */
const MOD_ACTIONS: Record<string, string> = {
  n: 'new', o: 'open', s: 'save', w: 'close', f: 'find',
  h: 'replace', b: 'sidebar', p: 'quick-open', g: 'goto-line', ',': 'settings',
};

export interface ModShortcutContext {
  key: string;
  shiftKey: boolean;
  altKey: boolean;
  /** True when the active buffer is a Markdown note. */
  markdownBuffer: boolean;
  /** True when the editor has a non-empty selection. */
  hasSelection: boolean;
}

/**
 * Resolve a Ctrl/Cmd chord for the editor. Returns null when the chord belongs to CodeMirror or to
 * another handler, in which case the caller must not call `preventDefault`.
 */
export function modShortcut(context: ModShortcutContext): ModShortcut {
  const { key, shiftKey, altKey, markdownBuffer, hasSelection } = context;
  if (altKey) return null;
  if (!shiftKey) {
    if (key === 'i') return { kind: 'format', format: 'italic' };
    if (key === 'k') return { kind: 'format', format: 'link' };
    if (key === 'b') {
      return markdownBuffer && hasSelection
        ? { kind: 'format', format: 'bold' }
        : { kind: 'action', action: 'sidebar' };
    }
  }
  const action = MOD_ACTIONS[key];
  // Ctrl+Shift+S is "save as"; every other shifted chord is deliberately unbound here.
  if (!action) return null;
  if (!shiftKey) return { kind: 'action', action };
  return key === 's' ? { kind: 'action', action: 'save-as' } : null;
  return null;
}

/**
 * Next focusable index for arrow/Home/End navigation inside an open menu, or null when the key is
 * not a navigation key or the menu is empty. `current` is -1 when focus is outside the menu.
 */
export function menuMove(key: string, current: number, count: number): number | null {
  if (count <= 0) return null;
  if (key === 'Home' || key === 'ArrowDown' && current < 0) return 0;
  if (key === 'End' || key === 'ArrowUp' && current < 0) return count - 1;
  if (key !== 'ArrowDown' && key !== 'ArrowUp') return null;
  const delta = key === 'ArrowDown' ? 1 : -1;
  return (current + delta + count) % count;
}
