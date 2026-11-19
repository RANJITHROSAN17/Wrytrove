import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

async function mockNative(page: Page, size: number, fixture: 'normal' | 'regex-timeout' | 'changed' = 'normal') {
  await page.addInitScript(({ size, fixture }) => {
    const win = window as unknown as {
      isTauri: boolean;
      __TAURI_INTERNALS__: unknown;
      __ranges: { offset: number; length: number }[];
      __release?: () => void;
    };
    win.isTauri = true;
    win.__ranges = [];
    let callbackId = 0;
    win.__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } },
      transformCallback: () => ++callbackId,
      invoke: async (command: string, args: { offset?: number; length?: number; version?: string } = {}) => {
        if (command === 'plugin:event|listen') return ++callbackId;
        if (command === 'take_launch_files') return [];
        if (command === 'plugin:dialog|open') return ['C:\\fixtures\\large.log'];
        if (command === 'workspace_read_file') throw 'WRYTROVE_LARGE_FILE: File exceeds the 20 MiB limit for this operation.';
        if (command === 'large_file_inspect') {
          if (size > 1024 ** 3) throw `File is ${size} bytes; the read-only viewer limit is 1073741824 bytes (1 GiB).`;
          return { size, version: 'fake-version' };
        }
        if (command === 'large_file_range') {
          const { offset, length, version } = args;
          if (version !== 'fake-version' || offset === undefined || !length || length > 256 * 1024 || offset + length > size) throw new Error('Invalid test range');
          win.__ranges.push({ offset, length });
          if (fixture === 'changed' && offset > 0) throw 'The file changed on disk. Close and reopen it to continue.';
          if (offset === 256 * 1024 && length === 256 * 1024) await new Promise<void>((resolve) => { win.__release = resolve; });
          const bytes = new Uint8Array(length).fill(10);
          if (!offset) {
            const line = fixture === 'regex-timeout' ? `${'a'.repeat(4000)}b\n` : 'é <img src=x onerror=alert(1)> hit\n';
            bytes.set(new TextEncoder().encode(line));
          }
          return bytes.buffer;
        }
        return undefined;
      },
    };
  }, { size, fixture });
  await page.goto('/');
  await expect(page.locator('.cm-content')).toBeVisible();
  await expect(page.locator('#app')).not.toHaveAttribute('inert', '');
  await page.keyboard.press('Control+o');
}

for (const size of [100, 500]) {
  test(`views a synthetic ${size} MiB native log without full-file transfer`, async ({ page }) => {
    await mockNative(page, size * 1024 ** 2);
    const viewer = page.getByRole('dialog', { name: 'Large text viewer' });
    await expect(viewer.getByRole('status').first()).toContainText('No file content has been read yet');
    const editor = page.locator('.cm-content');
    const original = await editor.textContent();
    expect(await page.evaluate(() => (window as unknown as { __ranges: unknown[] }).__ranges.length)).toBe(0);
    await viewer.getByRole('button', { name: 'Load first window' }).click();
    const text = viewer.getByLabel('Read-only text window');
    await expect(text).toContainText('<img src=x onerror=alert(1)>');
    await expect(text.locator('img')).toHaveCount(0);
    await viewer.getByRole('button', { name: 'Next window' }).click();
    await expect(viewer.getByLabel('Byte offset')).toHaveValue('32768');
    await viewer.getByLabel('Byte offset').fill(String(size * 1024 ** 2 - 1));
    await viewer.getByRole('button', { name: 'Go', exact: true }).click();
    await expect(viewer.getByRole('button', { name: 'Next window' })).toBeDisabled();
    await viewer.getByLabel('Find in file').fill('h.t');
    await viewer.getByLabel('Regex').check();
    await viewer.getByRole('button', { name: 'Search', exact: true }).click();
    await expect(viewer.getByRole('button', { name: 'Line 1 · bytes [32, 35)' })).toBeVisible();
    await expect.poll(() => page.evaluate(() => !!(window as unknown as { __release?: () => void }).__release)).toBe(true);
    await viewer.getByRole('button', { name: 'Cancel search' }).click();
    await expect(viewer.locator('#large-search-status')).toContainText('Partial: search cancelled.');
    const downloaded = page.waitForEvent('download');
    await viewer.getByRole('button', { name: 'Export matched ranges' }).click();
    const report = JSON.parse(await readFile((await (await downloaded).path())!, 'utf8'));
    expect(report).toMatchObject({ outcome: 'Partial: search cancelled.', processedBytes: 256 * 1024, matches: [{ start: 32, end: 35, line: 1 }] });
    await page.keyboard.press('Escape');
    await expect(viewer).not.toBeVisible();
    await page.evaluate(() => (window as unknown as { __release?: () => void }).__release?.());
    await expect.poll(() => editor.textContent()).toBe(original);
    await expect(page.locator('#large-text')).toBeEmpty();
    expect(await page.evaluate(() => Math.max(...(window as unknown as { __ranges: { length: number }[] }).__ranges.map(({ length }) => length)))).toBe(256 * 1024);
  });
}

test('reports the measured byte size and limit without reading oversized content', async ({ page }) => {
  await mockNative(page, 1024 ** 3 + 1);
  await expect(page.getByRole('dialog', { name: 'Some files could not be opened' })).toContainText('1073741825 bytes');
  await expect(page.locator('#open-errors-list')).toContainText('1 GiB');
  expect(await page.evaluate(() => (window as unknown as { __ranges: unknown[] }).__ranges.length)).toBe(0);
});


test('bounds a pathological regex in the worker and keeps the viewer usable', async ({ page }) => {
  await mockNative(page, 100 * 1024 ** 2, 'regex-timeout');
  const viewer = page.getByRole('dialog', { name: 'Large text viewer' });
  await viewer.getByRole('button', { name: 'Load first window' }).click();
  await viewer.getByLabel('Find in file').fill('(a+)+$');
  await viewer.getByLabel('Regex').check();
  await viewer.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(viewer.locator('#large-search-status')).toContainText('Partial: Search worker exceeded its time budget.');
  await viewer.getByRole('button', { name: 'Next window' }).click();
  await expect(viewer.getByLabel('Byte offset')).toHaveValue('32768');
});

test('clears the old window and reports a changed source rather than displaying stale text', async ({ page }) => {
  await mockNative(page, 100 * 1024 ** 2, 'changed');
  const viewer = page.getByRole('dialog', { name: 'Large text viewer' });
  await viewer.getByRole('button', { name: 'Load first window' }).click();
  await expect(viewer.getByLabel('Read-only text window')).toContainText('hit');
  await viewer.getByRole('button', { name: 'Next window' }).click();
  await expect(viewer.locator('#large-page-status')).toContainText('The file changed on disk');
  await expect(viewer.getByLabel('Read-only text window')).toBeEmpty();
});
