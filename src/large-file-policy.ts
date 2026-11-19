import { MAX_FILE_BYTES } from './encoding';

interface HeapSample { usedJSHeapSize: number; jsHeapSizeLimit: number; }

// Reserve half of the reported headroom for unrelated allocations. An editable
// document holds more than its disk bytes (IPC, decoded strings, lines, editor
// state). The multiplier is a conservative policy, not a memory guarantee.
export function editableFileLimit(heap?: HeapSample): number {
  if (!heap || !Number.isFinite(heap.usedJSHeapSize) || !Number.isFinite(heap.jsHeapSizeLimit)
    || heap.usedJSHeapSize <= 0 || heap.jsHeapSizeLimit <= 0) return MAX_FILE_BYTES;
  const headroom = Math.max(0, heap.jsHeapSizeLimit - heap.usedJSHeapSize);
  return Math.min(MAX_FILE_BYTES, Math.max(1, Math.floor(headroom / 12)));
}

export function currentEditableFileLimit(): number {
  return editableFileLimit((performance as Performance & { memory?: HeapSample }).memory);
}
