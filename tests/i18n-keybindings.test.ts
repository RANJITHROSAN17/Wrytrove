import { describe, expect, it } from 'vitest';
import { getDirection, resolveLocale, SECURITY_CONSENT_VERSION, t } from '../src/i18n';
import {
  DEFAULT_KEYBINDINGS,
  detectKeybindingConflicts,
  normalizeChord,
  resetKeybindings,
  sanitizeKeybindings,
} from '../src/keybindings';

describe('localization groundwork and RTL validation', () => {
  it('resolves locales with fallback to English and handles malformed inputs', () => {
    expect(resolveLocale('ta-IN')).toBe('ta');
    expect(resolveLocale('ar-SA')).toBe('ar');
    expect(resolveLocale('fr-FR')).toBe('en');
    expect(resolveLocale(null)).toBe('en');
    expect(resolveLocale(123)).toBe('en');
  });

  it('returns RTL direction for Arabic and LTR for English/Tamil', () => {
    expect(getDirection('ar')).toBe('rtl');
    expect(getDirection('en')).toBe('ltr');
    expect(getDirection('ta')).toBe('ltr');
  });

  it('falls back to English for missing bundle keys and ignores malformed overrides', () => {
    expect(SECURITY_CONSENT_VERSION).toBeGreaterThanOrEqual(1);
    expect(t('ta', 'command.save')).toBe('சேமி');
    expect(t('ta', 'security.cloudConsent')).toContain('Cloud AI requests');
    expect(t('en', 'keybindings.conflict', { chord: 'Ctrl+S', command: 'Save' })).toBe(
      'Shortcut Ctrl+S is already assigned to Save.',
    );
    expect(t('en', 'app.title', undefined, 'not-an-object')).toBe('Wrytrove');
    expect(t('en', 'app.title', undefined, { 'app.title': 42 })).toBe('Wrytrove');
  });

  it('round-trips Tamil, CJK, and emoji text through UTF-8 without surrogate corruption', () => {
    const samples = ['வணக்கம் தமிழ் 📝', '日本語テスト 🚀', 'مرحبا بالعالم'];
    const encoder = new TextEncoder();
    const decoder = new TextDecoder('utf-8', { fatal: true });
    for (const text of samples) {
      const bytes = encoder.encode(text);
      expect(decoder.decode(bytes)).toBe(text);
    }
  });
});

describe('user-configurable keybindings', () => {
  it('detects conflicting chords and normalizes key names', () => {
    expect(normalizeChord('ctrl + shift + p')).toBe('Ctrl+Shift+P');
    const bindings = sanitizeKeybindings([
      { commandId: 'file.save', chord: 'ctrl+f' },
    ]);
    const conflicts = detectKeybindingConflicts(bindings);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].chord).toBe('Ctrl+F');
    expect(conflicts[0].commands).toContain('file.save');
    expect(conflicts[0].commands).toContain('search.find');
  });

  it('sanitizes malformed persisted bindings and protects Settings/Command Palette', () => {
    const sanitized = sanitizeKeybindings([
      { commandId: 'settings.open', chord: '' },
      { commandId: 'unknown.cmd', chord: 'Ctrl+X' },
      'bad-entry',
    ]);
    const settings = sanitized.find((b) => b.commandId === 'settings.open');
    const palette = sanitized.find((b) => b.commandId === 'commandPalette.open');
    expect(settings?.chord).toBe('Ctrl+,');
    expect(palette?.chord).toBe('Ctrl+Shift+P');
    expect(resetKeybindings()).toEqual(DEFAULT_KEYBINDINGS);
  });
});
