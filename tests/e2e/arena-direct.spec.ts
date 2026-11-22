import { expect, test, type Page } from '@playwright/test';

/** Synthetic Tauri IPC: exercises the real UI and plugin-http JS without network or keys. */
async function mockDesktop(page: Page) {
  await page.addInitScript(() => {
    type Client = { url: string; method: string; headers: [string, string][]; data: number[]; maxRedirections: number };
    type FakeWindow = Window & { isTauri: boolean; __arenaCalls: Client[]; __arenaScriptRan?: boolean; __TAURI_INTERNALS__: unknown };
    const win = window as unknown as FakeWindow;
    win.isTauri = true; win.__arenaCalls = [];
    const requests = new Map<number, { client: Client; bodyRead: boolean }>();
    let next = 0;
    win.__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } },
      transformCallback: () => ++next,
      invoke: async (command: string, args: Record<string, unknown> | Uint8Array = {}, options?: { headers?: Record<string, string> }) => {
        if (command === 'take_launch_files') return [];
        if (command === 'plugin:event|listen') return ++next;
        if (command === 'plugin:http|fetch') {
          const config = options?.headers?.['client-config'];
          if (!(args instanceof Uint8Array) || !config) throw new Error('Expected binary HTTP IPC with client configuration');
          const client: Client = { ...JSON.parse(decodeURIComponent(config)), data: Array.from(args) };
          win.__arenaCalls.push(client);
          const id = ++next; requests.set(id, { client, bodyRead: false }); return id;
        }
        if (command === 'plugin:http|fetch_send') {
          const id = (args as { rid: number }).rid;
          return { status: 200, statusText: 'OK', url: requests.get(id)!.client.url, headers: [['content-type', 'application/json']], rid: id };
        }
        if (command === 'plugin:http|fetch_read_body') {
          const entry = requests.get((args as { rid: number }).rid)!;
          if (entry.bodyRead) return [1];
          entry.bodyRead = true;
          if (entry.client.url.endsWith('/api/tags')) {
            const bytes = new TextEncoder().encode(JSON.stringify({ models: [{ name: 'qwen2.5-coder:1.5b' }] }));
            return [...bytes, 0];
          }
          if (entry.client.url.endsWith('/api/generate')) {
            const bytes = new TextEncoder().encode(JSON.stringify({ response: 'Synthetic Ollama answer' }));
            return [...bytes, 0];
          }
          const request = JSON.parse(new TextDecoder().decode(new Uint8Array(entry.client.data))) as { model: string; messages: { content: string }[] };
          const content = request.messages[1].content.startsWith('Instruction:') ? 'SYNTHETIC_REPLACEMENT' : request.model === 'model-one' ? '<script>window.__arenaScriptRan=true</script>' : 'Second model answer';
          const bytes = new TextEncoder().encode(JSON.stringify({ choices: [{ message: { content } }] }));
          return [...bytes, 0];
        }
        return undefined;
      },
    };
  });
  await page.goto('/');
  await expect(page.locator('.cm-content')).toBeVisible();
  await expect(page.locator('#app')).not.toHaveAttribute('inert', '');
}

async function calls(page: Page) {
  return page.evaluate(() => (window as unknown as { __arenaCalls: { url: string; headers: [string, string][]; data: number[]; maxRedirections: number }[] }).__arenaCalls);
}

test('two-model questions require consent and render untrusted answers as inert text', async ({ page }) => {
  const external: string[] = [];
  page.on('request', (request) => { if (request.url().includes('arena.ai')) external.push(request.url()); });
  await mockDesktop(page);
  await page.getByRole('button', { name: 'Open Arena assistant' }).click();
  await page.getByRole('button', { name: /API key Optional desktop integration/ }).click();
  await page.locator('#arena-key').fill('synthetic-test-key');
  await page.locator('#arena-model').fill('model-one');
  await page.locator('#arena-instruction').fill('Explain this concept');
  await page.getByRole('checkbox', { name: /Compare two models/ }).check();
  await page.locator('#arena-model-second').fill('model-two');
  await page.getByRole('button', { name: 'Compare two models' }).click();
  await expect(page.getByRole('heading', { name: 'Send two requests to Arena?' })).toBeVisible();
  await expect(page.locator('#confirm-message')).toContainText('two separate requests');
  expect(await calls(page)).toHaveLength(0);
  await page.locator('#confirm-actions').getByRole('button', { name: 'Cancel', exact: true }).click();
  expect(await calls(page)).toHaveLength(0);
  await page.getByRole('button', { name: 'Compare two models' }).click();
  await page.getByRole('button', { name: 'Send both requests' }).click();
  await expect(page.locator('#arena-status')).toContainText('2 of 2');
  await expect(page.locator('#arena-response-1')).toHaveValue('<script>window.__arenaScriptRan=true</script>');
  await expect(page.locator('#arena-response-2')).toHaveValue('Second model answer');
  expect(await page.evaluate(() => (window as unknown as { __arenaScriptRan?: boolean }).__arenaScriptRan)).toBeUndefined();
  const sent = await calls(page);
  expect(sent).toHaveLength(2);
  for (const request of sent) {
    expect(request.url).toBe('https://api.arena.ai/v1/chat/completions');
    expect(request.maxRedirections).toBe(0);
    expect(request.headers).toContainEqual(['authorization', 'Bearer synthetic-test-key']);
    const body = JSON.parse(new TextDecoder().decode(new Uint8Array(request.data))) as { model: string; messages: { content: string }[] };
    expect(body.messages).toHaveLength(2);
    expect(body.messages[1].content).toBe('Question:\nExplain this concept');
    expect(JSON.stringify(body)).not.toContain('synthetic-test-key');
  }
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain('synthetic-test-key');
  await page.getByRole('button', { name: 'Close Arena tools' }).click();
  await expect(page.locator('#arena-key')).toHaveValue('');
  await expect(page.locator('#arena-response-1')).toHaveValue('');
  await page.getByRole('button', { name: 'AI suggestions settings' }).click();
  await page.locator('#ai-diagnostics-copy').click();
  const diagnostics = await page.locator('#ai-diagnostics-output').inputValue();
  for (const secret of ['synthetic-test-key', 'Explain this concept', 'model-one', 'model-two']) expect(diagnostics).not.toContain(secret);
  const attempts = (JSON.parse(diagnostics) as { attempts: { bodyBytes: number; provider: string; route: string }[] }).attempts;
  expect(attempts.map((item) => item.bodyBytes)).toEqual(sent.map((item) => item.data.length));
  expect(attempts.map((item) => [item.provider, item.route])).toEqual([['arena', 'cloud'], ['arena', 'cloud']]);
  await page.locator('#ai-diagnostics-clear').click();
  await expect(page.locator('#ai-diagnostics-status')).toContainText('cleared');
  await page.locator('#ai-diagnostics-copy').click();
  expect(JSON.parse(await page.locator('#ai-diagnostics-output').inputValue()).attempts).toEqual([]);
  expect(external).toEqual([]);
});

test('an Arena edit is applied only after a separate diff review and remains undoable', async ({ page }) => {
  await mockDesktop(page);
  await page.locator('.cm-content').click(); await page.keyboard.press('Control+Home'); await page.keyboard.press('Shift+End');
  await page.getByRole('button', { name: 'Open Arena assistant' }).click();
  await page.getByRole('button', { name: /API key Optional desktop integration/ }).click();
  await page.locator('#arena-key').fill('synthetic-test-key');
  await page.locator('#arena-model').fill('model-one');
  await page.locator('#arena-mode').selectOption('edit');
  await page.locator('#arena-instruction').fill('Simplify this line');
  await page.getByRole('button', { name: 'Capture selection' }).click();
  const before = await page.locator('#arena-selection').inputValue();
  expect(before.length).toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Send to Arena', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Send request to Arena?' })).toBeVisible();
  expect(await calls(page)).toHaveLength(0);
  await page.locator('#confirm-actions').getByRole('button', { name: 'Send to Arena' }).click();
  await expect(page.locator('#arena-response-1')).toHaveValue('SYNTHETIC_REPLACEMENT');
  await expect(page.locator('.cm-content')).not.toContainText('SYNTHETIC_REPLACEMENT');
  await page.getByRole('button', { name: 'Review this edit' }).click();
  await expect(page.getByRole('heading', { name: 'Preview a change' })).toBeVisible();
  await expect(page.locator('#review-before')).toHaveValue(before);
  await expect(page.locator('#review-after')).toHaveValue('SYNTHETIC_REPLACEMENT');
  await page.getByRole('button', { name: 'Apply to selection' }).click();
  await expect(page.locator('.cm-content')).toContainText('SYNTHETIC_REPLACEMENT');
  await expect(page.locator('#toolbar-dirty')).toBeVisible();
  await page.keyboard.press('Control+z');
  await expect(page.locator('.cm-content')).not.toContainText('SYNTHETIC_REPLACEMENT');
  await expect(page.locator('.cm-content')).toContainText(before);
});


test('Ollama consent separates capabilities and model changes turn off inline suggestions', async ({ page }) => {
  await mockDesktop(page);
  await page.locator('.cm-content').click(); await page.keyboard.press('Control+Home'); await page.keyboard.press('Shift+End');
  await page.getByRole('button', { name: 'AI suggestions settings' }).click();
  await page.locator('[data-ai-action="explain"]').click();
  await page.locator('#ai-action-run').click();
  await expect(page.getByRole('heading', { name: 'Send this selection to Ollama?' })).toBeVisible();
  await expect(page.locator('#confirm-message')).toContainText('UTF-8 bytes');
  await expect(page.locator('#confirm-message')).toContainText('cloud');
  expect(await calls(page)).toHaveLength(0);
  await page.getByRole('button', { name: 'Send and review' }).click();
  await expect(page.locator('#ai-action-output')).toContainText('Synthetic Ollama answer');
  expect((await calls(page)).filter((item) => item.url.endsWith('/api/generate'))).toHaveLength(1);
  await page.locator('[data-ai-action="improve"]').click();
  await page.locator('#ai-action-run').click();
  await expect(page.getByRole('heading', { name: 'Send this selection to Ollama?' })).toBeVisible();
  await page.locator('#confirm-actions').getByRole('button', { name: 'Cancel' }).click();
  expect((await calls(page)).filter((item) => item.url.endsWith('/api/generate'))).toHaveLength(1);
  await page.locator('#ai-toggle').click();
  await expect(page.getByRole('heading', { name: 'Turn on AI suggestions?' })).toBeVisible();
  await page.getByRole('button', { name: 'Enable suggestions' }).click();
  await expect(page.locator('#ai-toggle')).toHaveAttribute('aria-checked', 'true');
  await page.locator('#model-name').fill('new-model');
  await page.locator('#model-name').press('Tab');
  await expect(page.locator('#ai-toggle')).toHaveAttribute('aria-checked', 'false');
  const before = (await calls(page)).filter((item) => item.url.endsWith('/api/generate')).length;
  await page.locator('.cm-content').click(); await page.keyboard.press('Control+End'); await page.keyboard.insertText(' synthetic');
  await page.waitForTimeout(1300);
  expect((await calls(page)).filter((item) => item.url.endsWith('/api/generate'))).toHaveLength(before);
  await page.locator('#ai-toggle').click();
  await expect(page.locator('#confirm-message')).toContainText('new-model');
  await page.locator('#confirm-actions').getByRole('button', { name: 'Not now' }).click();
});

test('a model change while action consent is open invalidates the approval', async ({ page }) => {
  await mockDesktop(page);
  await page.locator('.cm-content').click(); await page.keyboard.press('Control+Home'); await page.keyboard.press('Shift+End');
  await page.getByRole('button', { name: 'AI suggestions settings' }).click();
  await page.locator('#ai-action-run').click();
  await expect(page.getByRole('heading', { name: 'Send this selection to Ollama?' })).toBeVisible();
  await page.evaluate(() => {
    const model = document.querySelector<HTMLInputElement>('#model-name')!;
    model.value = 'different-model'; model.dispatchEvent(new Event('change', { bubbles: true }));
    model.value = 'qwen2.5-coder:1.5b'; model.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.getByRole('button', { name: 'Send and review' }).click();
  await expect(page.locator('#ai-action-status')).toContainText('Nothing was sent');
  expect((await calls(page)).filter((item) => item.url.endsWith('/api/generate'))).toHaveLength(0);
  await page.locator('#ai-action-run').click();
  await expect(page.getByRole('heading', { name: 'Send this selection to Ollama?' })).toBeVisible();
  await page.locator('#confirm-actions').getByRole('button', { name: 'Cancel' }).click();
});
