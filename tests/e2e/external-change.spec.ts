import { expect, test, type Page } from '@playwright/test';

async function openNative(page: Page) {
  await page.addInitScript(() => {
    type State = Window & { isTauri: boolean; __diskText: string; __diskIdentity: string; __writeIdentity?: string; __saveFailure?: { phase: string; kind: string; message: string }; __saveSuccess?: { phase: string; identity: string | null; metadata?: unknown }; __holdRead: boolean; __failRead: boolean; __writes: number; __releaseRead?: () => void; __TAURI_INTERNALS__: unknown };
    const win = window as unknown as State;
    win.isTauri = true;
    win.__diskText = 'original file';
    win.__diskIdentity = '0123456789abcdef0123456789abcdef';
    win.__holdRead = false; win.__failRead = false; win.__writes = 0;
    let next = 0;
    win.__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } },
      transformCallback: () => ++next,
      invoke: async (command: string, _args: unknown, options?: { headers?: Record<string, string> }) => {
        if (command === 'take_launch_files') return ['C:\\notes\\draft.txt'];
        if (command === 'plugin:event|listen') return ++next;
        if (command === 'safe_write') {
          win.__writes++; win.__writeIdentity = options?.headers?.['x-wrytrove-identity'];
          if (win.__saveSuccess) {
            win.__diskText = new TextDecoder().decode(_args as Uint8Array);
            return win.__saveSuccess;
          }
          throw win.__saveFailure ?? { phase: 'revalidate', kind: 'conflict', message: 'WRYTROVE_FILE_CHANGED: destination changed' };
        }
        if (command === 'workspace_read_file') {
          if (win.__failRead) throw new Error('Permission denied');
          if (win.__holdRead) await new Promise<void>((resolve) => { win.__releaseRead = resolve; });
          return new TextEncoder().encode(win.__diskIdentity + win.__diskText).buffer;
        }
        return undefined;
      },
    };
  });
  await page.goto('/');
  await expect(page.locator('#app')).not.toHaveAttribute('inert', '');
  await expect(page.locator('.cm-content')).toContainText('original file');
}

test('clean native tabs show a notice on focus and reload only on request', async ({ page }) => {
  await openNative(page);
  await page.evaluate(() => { (window as unknown as { __diskText: string }).__diskText = 'external file'; window.dispatchEvent(new Event('focus')); });
  await expect(page.locator('#disk-change-warning')).toContainText('changed on disk');
  await expect(page.locator('.cm-content')).toContainText('original file');
  await page.evaluate(() => { (window as unknown as { __diskText: string }).__diskText = 'newer external file'; });
  await page.getByRole('button', { name: 'Reload from disk' }).click();
  await expect(page.locator('.cm-content')).toContainText('newer external file');
  await expect(page.locator('#disk-change-warning')).toBeHidden();
  await expect(page.locator('#toolbar-dirty')).toBeHidden();
});

test('same-content replacement reports a changed native file', async ({ page }) => {
  await openNative(page);
  await page.evaluate(() => {
    (window as unknown as { __diskIdentity: string }).__diskIdentity = 'fedcba9876543210fedcba9876543210';
    window.dispatchEvent(new Event('focus'));
  });
  await expect(page.locator('#disk-change-warning')).toContainText('changed on disk');
  await expect(page.locator('.cm-content')).toContainText('original file');
});

test('dirty native tabs preserve edits and do not offer reload', async ({ page }) => {
  await openNative(page);
  await page.locator('.cm-content').click();
  await page.keyboard.press('Control+End');
  await page.keyboard.insertText(' local edits');
  await page.evaluate(() => { (window as unknown as { __diskText: string }).__diskText = 'external file'; window.dispatchEvent(new Event('focus')); });
  await expect(page.locator('#disk-change-warning')).toContainText('unsaved edits are preserved');
  await expect(page.getByRole('button', { name: 'Reload from disk' })).toBeHidden();
  await expect(page.locator('.cm-content')).toContainText('original file local edits');
});

test('edits made during reload are never replaced by the asynchronous read', async ({ page }) => {
  await openNative(page);
  await page.evaluate(() => { (window as unknown as { __diskText: string }).__diskText = 'external file'; window.dispatchEvent(new Event('focus')); });
  await expect(page.getByRole('button', { name: 'Reload from disk' })).toBeVisible();
  await page.evaluate(() => { (window as unknown as { __holdRead: boolean }).__holdRead = true; });
  await page.getByRole('button', { name: 'Reload from disk' }).click();
  await expect.poll(() => page.evaluate(() => typeof (window as unknown as { __releaseRead?: () => void }).__releaseRead)).toBe('function');
  await page.locator('.cm-content').click();
  await page.keyboard.press('Control+End');
  await page.keyboard.insertText(' local edits');
  await page.evaluate(() => { const w = window as unknown as { __holdRead: boolean; __releaseRead: () => void }; w.__holdRead = false; w.__releaseRead(); });
  await expect(page.locator('#toast')).toContainText('Your edits were kept');
  await expect(page.locator('.cm-content')).toContainText('original file local edits');
  await expect(page.getByRole('button', { name: 'Reload from disk' })).toBeHidden();
});


test('a dirty conflict still requires confirmation before any overwrite', async ({ page }) => {
  await openNative(page);
  await page.locator('.cm-content').click();
  await page.keyboard.press('Control+End');
  await page.keyboard.insertText(' local edits');
  await page.evaluate(() => { (window as unknown as { __diskText: string }).__diskText = 'external file'; window.dispatchEvent(new Event('focus')); });
  await expect(page.locator('#disk-change-warning')).toContainText('unsaved edits are preserved');
  await page.keyboard.press('Control+s');
  await expect(page.getByRole('heading', { name: 'File changed on disk' })).toBeVisible();
  await page.locator('#confirm-actions').getByRole('button', { name: 'Cancel' }).click();
  await expect(page.locator('.cm-content')).toContainText('original file local edits');
  expect(await page.evaluate(() => (window as unknown as { __writes: number }).__writes)).toBe(1);
  expect(await page.evaluate(() => (window as unknown as { __writeIdentity?: string }).__writeIdentity)).toBe('0123456789abcdef0123456789abcdef');
  expect(await page.evaluate(() => (window as unknown as { __diskText: string }).__diskText)).toBe('external file');
});

test('a native save that preserves the file it could check raises no notice', async ({ page }) => {
  await openNative(page);
  // The ordinary shape: the staged operation succeeded and the post-commit inspection matched.
  await page.evaluate(() => { (window as unknown as { __saveSuccess: unknown }).__saveSuccess = { phase: 'committed', identity: 'fedcba9876543210fedcba9876543210', metadata: { permissions: 'copied_to_temp', preservation: 'preserved' } }; });
  await page.locator('.cm-content').click(); await page.keyboard.press('Control+End'); await page.keyboard.insertText(' saved');
  await page.keyboard.press('Control+s');
  await expect(page.locator('#toolbar-dirty')).toBeHidden();
  await expect(page.locator('#toast')).toContainText('Saved draft.txt');
  await expect(page.locator('#save-metadata-warning')).toBeHidden();
});

test('a native save that changed the file it could check shows a dismissible notice', async ({ page }) => {
  await openNative(page);
  await page.evaluate(() => { (window as unknown as { __saveSuccess: unknown }).__saveSuccess = { phase: 'committed', identity: 'fedcba9876543210fedcba9876543210', metadata: { permissions: 'copied_to_temp', preservation: 'changed' } }; });
  await page.locator('.cm-content').click(); await page.keyboard.press('Control+End'); await page.keyboard.insertText(' saved');
  await page.keyboard.press('Control+s');
  await expect(page.locator('#toolbar-dirty')).toBeHidden();
  const notice = page.locator('#save-metadata-warning');
  await expect(notice).toContainText('Saved “draft.txt”');
  await expect(notice).toContainText('attributes differ from the original');
  await expect(notice).toBeVisible();
  await page.getByRole('button', { name: 'Dismiss save metadata notice' }).click();
  await expect(notice).toBeHidden();
});

test('a native save whose metadata could not be checked shows a dismissible notice', async ({ page }) => {
  await openNative(page);
  await page.evaluate(() => { (window as unknown as { __saveSuccess: unknown }).__saveSuccess = { phase: 'committed', identity: 'fedcba9876543210fedcba9876543210', metadata: { permissions: 'copied_to_temp', preservation: 'not_verified' } }; });
  await page.locator('.cm-content').click(); await page.keyboard.press('Control+End'); await page.keyboard.insertText(' saved');
  await page.keyboard.press('Control+s');
  const notice = page.locator('#save-metadata-warning');
  await expect(notice).toContainText('could not be checked after writing');
  await page.getByRole('button', { name: 'Dismiss save metadata notice' }).click();
  await expect(notice).toBeHidden();
});

test('missing native metadata is reported as unknown without treating a committed save as failed', async ({ page }) => {
  await openNative(page);
  await page.evaluate(() => { (window as unknown as { __saveSuccess: unknown }).__saveSuccess = { phase: 'committed', identity: null }; });
  await page.locator('.cm-content').click(); await page.keyboard.press('Control+End'); await page.keyboard.insertText(' saved');
  await page.keyboard.press('Control+s');
  await expect(page.locator('#toolbar-dirty')).toBeHidden();
  // Nothing was reported about the final file, so the save must not invent a limitation.
  await expect(page.locator('#save-metadata-warning')).toBeHidden();
  await expect(page.locator('#toast')).toContainText('Saved draft.txt');
});

test('a flush failure reports the stage and keeps edits unsaved', async ({ page }) => {
  await openNative(page);
  await page.locator('.cm-content').click();
  await page.keyboard.press('Control+End');
  await page.keyboard.insertText(' local edits');
  await page.evaluate(() => { (window as unknown as { __saveFailure: unknown }).__saveFailure = { phase: 'flush_temp', kind: 'failure', message: 'disk full' }; });
  await page.keyboard.press('Control+s');
  await expect(page.locator('#toast')).toContainText('Could not flush the temporary file');
  await expect(page.locator('#save-metadata-warning')).toBeHidden();
  await expect(page.locator('.cm-content')).toContainText('original file local edits');
  await expect(page.locator('#toolbar-dirty')).toBeVisible();
});

test('an uncertain replacement warns instead of claiming a failed or successful save', async ({ page }) => {
  await openNative(page);
  await page.locator('.cm-content').click();
  await page.keyboard.press('Control+End');
  await page.keyboard.insertText(' local edits');
  await page.evaluate(() => { (window as unknown as { __saveFailure: unknown }).__saveFailure = { phase: 'replace', kind: 'failure', message: 'I/O error' }; });
  await page.keyboard.press('Control+s');
  await expect(page.locator('#toast')).toContainText('replacement outcome is uncertain');
  await expect(page.locator('.cm-content')).toContainText('original file local edits');
  await expect(page.locator('#toolbar-dirty')).toBeVisible();
});

test('an unreadable disk file does not silently appear unchanged', async ({ page }) => {
  await openNative(page);
  await page.evaluate(() => { (window as unknown as { __failRead: boolean }).__failRead = true; window.dispatchEvent(new Event('focus')); });
  await expect(page.locator('#disk-change-warning')).toContainText('Cannot check');
  await expect(page.getByRole('button', { name: 'Reload from disk' })).toBeHidden();
  await expect(page.locator('.cm-content')).toContainText('original file');
});

test('native capture leaves an open dirty note intact and retains its old save identity', async ({ page }) => {
  await page.addInitScript(() => {
    type State = Window & { isTauri: boolean; __diskText: string; __writes: number; __writeIdentity?: string; __TAURI_INTERNALS__: unknown };
    const win = window as unknown as State;
    win.isTauri = true; win.__diskText = 'native original'; win.__writes = 0;
    let identity = '0123456789abcdef0123456789abcdef';
    let next = 0;
    win.__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } },
      transformCallback: () => ++next,
      invoke: async (command: string, args: unknown, options?: { headers?: Record<string, string> }) => {
        if (command === 'take_launch_files') return ['C:\\notes\\Inbox.md'];
        if (command === 'plugin:event|listen') return ++next;
        if (command === 'plugin:dialog|open') return 'C:\\notes';
        if (command === 'plugin:fs|lstat') return { isDirectory: true, isFile: false, isSymlink: false, mtime: null, atime: null, birthtime: null };
        if (command === 'workspace_list_directory') return { entries: [{ name: 'Inbox.md', isFile: true, isDirectory: false }], skippedLinks: 0, truncated: false };
        if (command === 'workspace_read_file') return new TextEncoder().encode(identity + win.__diskText).buffer;
        if (command === 'safe_write') {
          win.__writes++; win.__writeIdentity = options?.headers?.['x-wrytrove-identity'];
          if (win.__writes > 1) throw { phase: 'revalidate', kind: 'conflict', message: 'changed' };
          win.__diskText = new TextDecoder().decode(args as Uint8Array);
          identity = 'fedcba9876543210fedcba9876543210';
          return { phase: 'committed', identity, metadata: { permissions: 'copied_to_temp', preservation: 'preserved' } };
        }
        return undefined;
      },
    };
  });
  await page.goto('/');
  await expect(page.locator('.cm-content')).toContainText('native original');
  await page.locator('#sidebar [data-action="open-folder"]').click();
  await page.getByRole('button', { name: 'Choose folder', exact: true }).click();
  await expect(page.locator('#workspace-name')).toHaveText('notes');
  await page.locator('.cm-content').click(); await page.keyboard.press('Control+End'); await page.keyboard.insertText(' unsaved draft');
  await page.locator('[data-menu="notes"]').click();
  await page.locator('[data-menu-panel="notes"] [data-action="quick-capture"]').click();
  await page.locator('#capture-text').fill('native capture');
  await page.locator('#capture-submit').click();
  await expect(page.locator('#toast')).toContainText('open tab was not updated');
  // The capture appended to an existing note whose metadata the save could check and preserve.
  await expect(page.locator('#save-metadata-warning')).toBeHidden();
  await expect(page.locator('.cm-content')).toContainText('native original unsaved draft');
  await expect(page.locator('#disk-change-warning')).toContainText('unsaved edits are preserved');
  expect(await page.evaluate(() => (window as unknown as { __diskText: string }).__diskText)).toContain('native capture');
  await page.keyboard.press('Control+s');
  await expect(page.getByRole('heading', { name: 'File changed on disk' })).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { __writeIdentity: string }).__writeIdentity)).toBe('0123456789abcdef0123456789abcdef');
});
