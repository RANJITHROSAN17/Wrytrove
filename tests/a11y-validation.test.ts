import { describe, expect, it } from 'vitest';
import {
  formatLiveAnnouncement,
  getNonColorStateCue,
  isMinimumGeometrySupported,
} from '../src/a11y-validation';

describe('accessibility and high-scaling validation helpers', () => {
  it('provides non-color text markers and aria suffixes for active, dirty, and stale states', () => {
    expect(getNonColorStateCue('active').textMarker).toBe('•');
    expect(getNonColorStateCue('dirty').textMarker).toBe('*');
    expect(getNonColorStateCue('dirty').ariaLabelSuffix).toBe('unsaved changes');
    expect(getNonColorStateCue('stale').textMarker).toBe('!');
    expect(getNonColorStateCue('stale').ariaLabelSuffix).toBe('stale on disk');
  });

  it('formats polite and assertive live-region announcements', () => {
    expect(formatLiveAnnouncement('info', 'Saved note.md')).toEqual({
      politeness: 'polite',
      message: 'Saved note.md',
    });
    expect(formatLiveAnnouncement('error', 'Save conflict detected')).toEqual({
      politeness: 'assertive',
      message: 'Save conflict detected',
    });
    expect(() => formatLiveAnnouncement('info', '   ')).toThrow(/non-empty/u);
  });

  it('validates 720x500 minimum geometry up to 200% scaling', () => {
    expect(isMinimumGeometrySupported(720, 500, 200)).toBe(true);
    expect(isMinimumGeometrySupported(719, 500, 100)).toBe(false);
    expect(isMinimumGeometrySupported(720, 499, 100)).toBe(false);
  });
});
