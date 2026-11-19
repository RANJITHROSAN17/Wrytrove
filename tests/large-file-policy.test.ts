import { expect, it } from 'vitest';
import { MAX_FILE_BYTES } from '../src/encoding';
import { editableFileLimit } from '../src/large-file-policy';

it('keeps the hard editor cap with plentiful or unavailable memory information', () => {
  expect(editableFileLimit()).toBe(MAX_FILE_BYTES);
  expect(editableFileLimit({ usedJSHeapSize: NaN, jsHeapSizeLimit: 100 })).toBe(MAX_FILE_BYTES);
  expect(editableFileLimit({ usedJSHeapSize: 0, jsHeapSizeLimit: 100 })).toBe(MAX_FILE_BYTES);
  expect(editableFileLimit({ usedJSHeapSize: 100, jsHeapSizeLimit: 1024 ** 3 })).toBe(MAX_FILE_BYTES);
});

it('lowers the editable threshold under memory pressure without disabling the native read guard', () => {
  expect(editableFileLimit({ usedJSHeapSize: 12, jsHeapSizeLimit: 132 })).toBe(10);
  expect(editableFileLimit({ usedJSHeapSize: 13, jsHeapSizeLimit: 12 })).toBe(1);
});
