import { expect, test, type Page } from '@playwright/test';

/**
 * The caret must survive the whole app.
 *
 * A scripted test only catches the paths someone thought to write down. These invariants are
 * checked after *every* interaction instead, which is how the "text only appears once I click back
 * into the editor" reports were traced to their real cause: several controls hide the element that
 * held the caret — the sidebar buttons hide themselves, and closing a menu hides the panel the
 * focused menu item lives in — so the browser blurs to `<body>` and the next keystroke is
 * discarded with no visible error.
 *
 * Two rules are asserted here, and the second matters as much as the first:
 *
 *   1. the caret must never be stranded on the document, and
 *   2. focus that an action placed on purpose — a find box, a dialog input, a status-bar select,
 *      the menu trigger, a toolbar button — must not be stolen back.
 *
 * Breaking the second rule is the easy way to "fix" the first, and it wrecks keyboard use.
 */

const caretHolder = (page: Page) => page.evaluate(() => {
  const el = document.activeElement;
  if (!el || el === document.body || el === document.documentElement) return 'document';
  if (el.closest('.cm-editor')) return 'editor';
  return 'control';
});

const documentText = (page: Page) => page.evaluate(() =>
  Array.from(document.querySelectorAll('.cm-line')).map((line) => line.textContent).join('\n'));

/** Type a marker unique to this call, so a previous marker cannot fake a pass. */
const marker = () => `M${Math.random().toString(36).slice(2, 7)}`;

/** Type real keystrokes and report whether they reached the document. */
async function typingLands(page: Page): Promise<boolean> {
  const text = marker();
  await page.keyboard.type(text, { delay: 20 });
  await page.waitForTimeout(220);
  return (await documentText(page)).includes(text);
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const picker = () => { const error = new Error('blocked in this test'); error.name = 'SecurityError'; throw error; };
    (window as unknown as { showSaveFilePicker: unknown }).showSaveFilePicker = picker;
  });
  await page.goto('/');
  await page.waitForSelector('#app[aria-busy="false"]');
  await page.locator('.cm-content').click();
});

test.describe('the caret is never stranded', () => {
  // Every control that hides the element holding the caret, plus the menu path that used to.
  const strandingControls: [string, (page: Page) => Promise<void>][] = [
    ['hiding the sidebar', async (page) => { await page.locator('[aria-label="Hide sidebar"]').first().click(); }],
    // The show button only exists while the sidebar is hidden, so hide it first.
    ['showing the sidebar', async (page) => {
      await page.locator('[aria-label="Hide sidebar"]').first().click();
      await page.waitForTimeout(150);
      await page.locator('#show-sidebar').click();
    }],
    ['a View menu item', async (page) => {
      await page.locator('.menu-trigger[data-menu="view"]').click();
      await page.locator('[data-menu-panel="view"] [data-action="wrap"]').click();
    }],
    ['a Notes menu item', async (page) => {
      await page.locator('.menu-trigger[data-menu="notes"]').click();
      await page.locator('[data-menu-panel="notes"] [data-action="notes-panel"]').click();
    }],
    ['a File menu item', async (page) => {
      await page.locator('.menu-trigger[data-menu="file"]').click();
      await page.locator('[data-menu-panel="file"] [data-action="save"]').click();
    }],
    ['the command palette', async (page) => {
      await page.keyboard.press('Control+Shift+p');
      await page.keyboard.press('Escape');
    }],
    ['the settings dialog', async (page) => {
      await page.keyboard.press('Control+,');
      await page.keyboard.press('Escape');
    }],
    ['the shortcuts dialog', async (page) => {
      await page.keyboard.press('Control+Shift+o');
      await page.keyboard.press('Escape');
    }],
    ['the find panel', async (page) => {
      await page.keyboard.press('Control+f');
      await page.locator('#find-close').click();
    }],
  ];

  for (const [name, run] of strandingControls) {
    test(`typing still lands after ${name}`, async ({ page }) => {
      await run(page);
      await page.waitForTimeout(260);
      await expect.poll(() => caretHolder(page), { timeout: 3000 }).toBe('editor');
      expect(await typingLands(page)).toBe(true);
    });
  }
});

test.describe('deliberate focus is never stolen', () => {
  test('the find box keeps focus while searching', async ({ page }) => {
    await page.keyboard.press('Control+f');
    await expect.poll(() => caretHolder(page)).toBe('control');
    await expect(page.locator('#find-input')).toBeFocused();
  });

  test('find navigation keeps focus inside the find panel', async ({ page }) => {
    await page.keyboard.press('Control+f');
    await page.locator('#find-next').click();
    await expect(page.locator('#find-next')).toBeFocused();
  });

  test('a dialog input keeps focus, and closing it returns the caret', async ({ page }) => {
    await page.keyboard.press('Control+g');
    await expect(page.locator('#goto-input')).toBeFocused();
    // The dialog is open, so the caret must not be pulled out from under it.
    await page.waitForTimeout(300);
    await expect(page.locator('#goto-input')).toBeFocused();
    await page.keyboard.press('Escape');
    await expect.poll(() => caretHolder(page), { timeout: 3000 }).toBe('editor');
  });

  test('status-bar selects keep focus', async ({ page }) => {
    await page.locator('#language').click();
    await expect(page.locator('#language')).toBeFocused();
    await page.locator('#tab-size').click();
    await expect(page.locator('#tab-size')).toBeFocused();
  });

  test('the menu trigger and its items keep focus', async ({ page }) => {
    await page.locator('.menu-trigger[data-menu="file"]').click();
    await expect(page.locator('.menu-trigger[data-menu="file"]')).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(page.locator('[data-menu-panel="file"] [role="menuitem"]').first()).toBeFocused();
  });

  test('a settings switch keeps focus, and closing the dialog returns the caret', async ({ page }) => {
    await page.keyboard.press('Control+,');
    await page.locator('#setting-wrap').click();
    await expect(page.locator('#setting-wrap')).toBeFocused();
    await page.locator('#settings-dialog [data-close-dialog="settings-dialog"]').click();
    await expect.poll(() => caretHolder(page), { timeout: 3000 }).toBe('editor');
  });

  test('a toolbar toggle keeps focus, which is correct for keyboard use', async ({ page }) => {
    await page.locator('[data-action="ai"]').first().click();
    await expect(page.locator('[data-action="ai"]').first()).toBeFocused();
  });
});

test.describe('no interaction silently loses text', () => {
  test('typed text survives every menu action', async ({ page }) => {
    const sentinel = 'keep-this-text';
    await page.locator('.cm-content').click();
    await page.keyboard.type(sentinel);
    for (const menu of ['file', 'edit', 'view', 'notes']) {
      const items = await page.locator(`[data-menu-panel="${menu}"] [role="menuitem"]`).all();
      for (const item of items) {
        if (!(await item.isVisible())) continue;
        const name = (await item.textContent())?.trim() ?? '';
        // Commands that are meant to remove or replace text, and ones that show another document.
        if (/new|close|delete|clear|save as|sort|duplicate|undo|redo|open|quick open/i.test(name)) continue;
        await page.locator(`.menu-trigger[data-menu="${menu}"]`).click();
        await item.click({ timeout: 3000 });
        await page.waitForTimeout(180);
        if (await page.evaluate(() => !!document.querySelector('dialog[open]'))) {
          await page.keyboard.press('Escape');
          await page.waitForTimeout(150);
        }
        expect(await documentText(page), `"${name}" removed the document text`).toContain(sentinel);
      }
    }
  });

  test('typed text survives every toolbar button', async ({ page }) => {
    const sentinel = 'keep-this-text';
    await page.locator('.cm-content').click();
    await page.keyboard.type(sentinel);
    const buttons = await page.locator('.tab-tool, .icon-button, .preview-toggle, .status-chip').all();
    for (const button of buttons) {
      const name = await button.getAttribute('aria-label');
      if (!name || /new file|close tab|dictat/i.test(name)) continue;
      if (!(await button.isVisible())) continue;
      await button.click({ timeout: 3000 }).catch(() => {});
      await page.waitForTimeout(160);
      if (await page.evaluate(() => !!document.querySelector('dialog[open]'))) {
        await page.keyboard.press('Escape');
        await page.waitForTimeout(140);
      }
      expect(await documentText(page), `"${name}" removed the document text`).toContain(sentinel);
    }
  });
});
