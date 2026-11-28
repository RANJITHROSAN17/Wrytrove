import { expect, test, type Page } from '@playwright/test';

/**
 * The editor must keep the caret. Three paths used to drop it on the floor — closing the Markdown
 * preview, closing a confirm dialog opened from a menu, and clicking the toolbar save button — and
 * a document with nothing focused silently discards whatever is typed, pasted or dictated next.
 * That is the exact symptom of "the text only appears once I click back into the editor".
 */

const editorHasFocus = (page: Page) => page.evaluate(() => {
  const active = document.activeElement;
  return !!active && active.closest('.cm-editor') !== null;
});

/** Text the way CodeMirror stores it: one entry per rendered line, so newlines are not lost. */
const documentText = (page: Page) => page.evaluate(() =>
  Array.from(document.querySelectorAll('.cm-line')).map((line) => line.textContent).join('\n'));

/** Insert text the way an external source does — an OS voice tool, an IME or a paste. */
async function insertExternally(page: Page, text: string): Promise<void> {
  await page.keyboard.insertText(text);
  await page.waitForTimeout(250);
}

test.beforeEach(async ({ page }) => {
  // The browser preview has no native save dialog. A picker that refuses with a SecurityError makes
  // chooseSaveTarget fall back to the download path, so a save really completes instead of hanging
  // on a file chooser that headless Chromium never answers.
  await page.addInitScript(() => {
    const picker = () => { const error = new Error('blocked in this test'); error.name = 'SecurityError'; throw error; };
    (window as unknown as { showSaveFilePicker: unknown }).showSaveFilePicker = picker;
  });
  await page.goto('/');
  await expect(page.locator('#app')).not.toHaveAttribute('inert', '');
});

test('closing the Markdown preview hands the caret back to the editor', async ({ page }) => {
  await page.locator('.cm-content').click();
  expect(await editorHasFocus(page)).toBe(true);

  await page.getByRole('button', { name: 'Toggle Markdown preview' }).click();
  await expect(page.locator('#markdown-panel')).toBeVisible();
  await page.getByRole('button', { name: 'Close Markdown preview' }).click();
  await expect(page.locator('#markdown-panel')).toBeHidden();

  expect(await editorHasFocus(page)).toBe(true);
  await insertExternally(page, ' dictated after the preview');
  expect(await documentText(page)).toContain('dictated after the preview');
});

test('closing a confirm dialog opened from a menu hands the caret back to the editor', async ({ page }) => {
  await page.locator('.cm-content').click();
  expect(await editorHasFocus(page)).toBe(true);

  await page.locator('[data-menu="help"]').click();
  await page.locator('[data-action="about"]').click();
  await expect(page.locator('#confirm-dialog')).toBeVisible();
  await page.locator('#confirm-actions button').first().click();
  await expect(page.locator('#confirm-dialog')).toBeHidden();

  // The menu item that opened the dialog is hidden by the time the dialog closes, which is what used
  // to leave focus on <body> with no caret anywhere in the document.
  expect(await editorHasFocus(page)).toBe(true);
  await insertExternally(page, ' dictated after the dialog');
  expect(await documentText(page)).toContain('dictated after the dialog');
});

test('a save hands the caret back to the editor', async ({ page }) => {
  await page.locator('.cm-content').click();
  await page.keyboard.press('Control+End');
  await page.keyboard.insertText(' edited before saving');
  await expect(page.locator('#toolbar-dirty')).toBeVisible();

  await page.getByRole('button', { name: 'Save file' }).click();
  await expect(page.locator('#toolbar-dirty')).toBeHidden();
  // The browser preview cannot overwrite the original file, so the save lands as a download.
  await expect(page.locator('#toast')).toContainText(/Saved|downloaded/u);

  // Clicking the toolbar button used to leave focus on that button, so the next insertion was lost.
  expect(await editorHasFocus(page)).toBe(true);
  await insertExternally(page, ' dictated after the save');
  expect(await documentText(page)).toContain('dictated after the save');
});

test('the confirm dialog returns focus to wherever it was opened from', async ({ page }) => {
  // A dirty tab prompts on close. Answering it must not move the caret out of the document either.
  await page.keyboard.press('Control+n');
  await page.locator('.cm-content').click();
  await page.keyboard.insertText(' unsaved work');
  await expect(page.locator('#toolbar-dirty')).toBeVisible();

  await page.locator('.tab-close').last().click();
  await expect(page.getByRole('heading', { name: 'Save your changes?' })).toBeVisible();
  await page.locator('#confirm-actions button', { hasText: 'Don’t save' }).click();
  await expect(page.locator('#confirm-dialog')).toBeHidden();

  expect(await editorHasFocus(page)).toBe(true);
});
