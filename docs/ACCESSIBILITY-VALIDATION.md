# Accessibility & High-Scaling Validation (AUD-11)

This document defines the keyboard-only task scripts, assistive-technology matrix, scaling/forced-colors checks, and release-blocker classification for Wrytrove. No document contents or telemetry are collected during validation.

## 1. Keyboard-Only Task Scripts

1. **Open & Edit**: `Ctrl+O` opens file picker/Quick Open -> Arrow keys select note -> `Enter` opens -> focus lands in editor.
2. **Save & Conflict**: `Ctrl+S` saves -> status live region announces save result (`polite`) or conflict (`assertive`).
3. **Search**: `Ctrl+F` opens search -> `Enter` / `Shift+Enter` cycles matches -> `Esc` returns focus to editor.
4. **Change Review / Recovery**: Tab/Arrow keys navigate diff/recovery actions -> `Esc` closes dialog and restores prior focus.
5. **Settings & Command Palette**: `Ctrl+,` opens Settings; `Ctrl+Shift+P` opens Command Palette.

## 2. Assistive-Technology & Scaling Matrix

| Surface | 100% | 150% | 200% | Forced Colors | 720x500 Min | Blocker Class |
|---|---|---|---|---|---|---|
| Editor & Status Bar | Required | Required | Required | Required | Required | P0 |
| Tabs & Dirty/Stale Cues | Required | Required | Required | Required | Required | P0 |
| Dialogs & Focus Restore | Required | Required | Required | Required | Required | P0 |
| Search & Notes List | Required | Required | Required | Required | Required | P1 |
| Diff / Review Controls | Required | Required | Required | Required | Required | P1 |

## 3. Non-Color State Cues

- **Active**: `aria-selected="true"` + visible focus/active border.
- **Dirty**: Explicit text/glyph indicator (`*` / `(unsaved)`) + `aria-label` suffix.
- **Stale / Conflict**: Explicit `(stale)` / `(conflict)` badge + `role="alert"` announcement.
