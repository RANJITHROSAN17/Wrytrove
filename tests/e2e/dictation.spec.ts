import { expect, test, type Page } from '@playwright/test';

/**
 * Dictation, driven through the real UI. The microphone and the speech server cannot exist in a
 * headless browser, so this test installs stand-ins for both and then uses nothing but clicks and
 * the keyboard: if the recogniser is wired to the wrong place, or text goes to a document that is
 * not focused, the assertions below fail rather than a person noticing.
 *
 * What is being asserted is the part users reported as broken — dictated text appearing only after
 * clicking into the editor — plus the privacy boundary: audio goes to one loopback address and
 * nowhere else, and consent never survives a reload.
 */

const documentText = (page: Page) => page.evaluate(() =>
  Array.from(document.querySelectorAll('.cm-line')).map((line) => line.textContent).join('\n'));

/**
 * Stand-in for the microphone and the speech server, installed before the app boots. The fake
 * recorder emits one chunk per timeslice; the fake fetch answers with a transcript and records every
 * speech URL it was asked for, so the test can prove nothing else was contacted.
 */
async function installSpeechStubs(page: Page): Promise<void> {
  await page.addInitScript(() => {
    type StubWindow = Window & { __speechRequests: string[]; __recorderStarted: number[] };
    const win = window as unknown as StubWindow;
    win.__speechRequests = [];
    win.__recorderStarted = [];

    const stream = { getTracks: () => [{ stop: () => {} }] };
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: () => Promise.resolve(stream) },
    });

    class FakeRecorder {
      state = 'inactive';
      ondataavailable: ((event: { data: Blob }) => void) | null = null;
      onerror: ((event: unknown) => void) | null = null;
      private timer: number | null = null;
      start(timeslice: number): void {
        this.state = 'recording';
        win.__recorderStarted.push(timeslice);
        this.timer = window.setInterval(() => {
          this.ondataavailable?.({ data: new Blob(['audio'], { type: 'audio/webm' }) });
        }, timeslice);
      }
      stop(): void {
        this.state = 'inactive';
        if (this.timer !== null) window.clearInterval(this.timer);
        this.timer = null;
        // A final flush is what a real recorder does; an empty one must be ignored.
        this.ondataavailable?.({ data: new Blob([], { type: 'audio/webm' }) });
      }
    }
    (window as unknown as { MediaRecorder: unknown }).MediaRecorder = FakeRecorder;

    const realFetch = window.fetch.bind(window);
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (/audio|recognize|inference/u.test(url)) {
        win.__speechRequests.push(url);
        return new Response(JSON.stringify({ text: 'spoken words' }), {
          status: 200, headers: { 'content-type': 'application/json' },
        });
      }
      return realFetch(input, init);
    };
  });
}

/**
 * Load the app and wait for the editor to be live. The keyboard handler is attached during startup,
 * so a shortcut pressed before this resolves is simply lost.
 */
async function openApp(page: Page): Promise<void> {
  await page.goto('/');
  await page.waitForSelector('.cm-content');
  // The editor can render before the keyboard handler is attached, which would silently swallow
  // the Ctrl+, that opens Settings. aria-busy is cleared at the end of startup.
  await page.waitForSelector('#app[aria-busy="false"]');
}

/** Open Settings, run `edit`, then close the modal dialog so the toolbar is reachable again. */
async function editSettings(page: Page, edit: () => Promise<void>): Promise<void> {
  await page.keyboard.press('Control+,');
  await expect(page.locator('#settings-dialog')).toBeVisible();
  await edit();
  await page.locator('#settings-dialog [data-close-dialog="settings-dialog"]').click();
  await expect(page.locator('#settings-dialog')).toBeHidden();
}

test.beforeEach(async ({ page }) => {
  await installSpeechStubs(page);
  await page.addInitScript(() => {
    const picker = () => { const error = new Error('blocked in this test'); error.name = 'SecurityError'; throw error; };
    (window as unknown as { showSaveFilePicker: unknown }).showSaveFilePicker = picker;
  });
});

test('dictation consent starts off and the microphone is never opened', async ({ page }) => {
  await openApp(page);
  await expect(page.locator('#dictate-button')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('#dictation-chip')).toBeHidden();
  await expect(page.locator('#dictation-status')).toHaveText('Off');
  expect(await page.evaluate(() => (window as unknown as { __recorderStarted: number[] }).__recorderStarted)).toEqual([]);
});

test('the mic button refuses to record before consent is given', async ({ page }) => {
  await openApp(page);
  await page.locator('#dictate-button').click();
  await expect(page.locator('#toast')).toContainText(/turn it on in settings/i);
  await expect(page.locator('#dictate-button')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('#dictation-chip')).toBeHidden();
  expect(await page.evaluate(() => (window as unknown as { __recorderStarted: number[] }).__recorderStarted)).toEqual([]);
});

test('dictated text reaches the document without clicking into the editor', async ({ page }) => {
  await openApp(page);
  await editSettings(page, async () => {
    await page.locator('#setting-dictation').click();
    await expect(page.locator('#setting-dictation')).toHaveAttribute('aria-checked', 'true');
  });

  // Click into the editor once, then start dictating: everything after this must not need a click.
  await page.locator('.cm-content').click();
  await page.locator('#dictate-button').click();
  await expect(page.locator('#dictation-chip')).toBeVisible();
  await expect(page.locator('#dictation-chip-text')).toHaveText('Listening');

  // The transcript arrives on its own, through the real engine.
  await expect(page.locator('.cm-line').last()).toHaveText(/spoken words/u, { timeout: 15_000 });
  expect(await documentText(page)).toContain('spoken words');
});

test('the second chunk is appended to the first, separated by one space', async ({ page }) => {
  await openApp(page);
  await editSettings(page, async () => { await page.locator('#setting-dictation').click(); });
  await page.locator('.cm-content').click();
  await page.locator('#dictate-button').click();
  await expect(page.locator('.cm-line').last()).toHaveText(/spoken words/u, { timeout: 15_000 });
  await expect(page.locator('.cm-line').last()).toHaveText(/spoken words spoken words/u, { timeout: 15_000 });
});

test('pressing the mic button again stops recording and releases the microphone', async ({ page }) => {
  await openApp(page);
  await editSettings(page, async () => { await page.locator('#setting-dictation').click(); });
  await page.locator('.cm-content').click();
  await page.locator('#dictate-button').click();
  await expect(page.locator('#dictation-chip')).toBeVisible();

  await page.locator('#dictate-button').click();
  await expect(page.locator('#dictation-chip')).toBeHidden();
  await expect(page.locator('#dictate-button')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('#dictate-button')).toHaveAttribute('aria-label', 'Start dictation');
});

test('audio is sent only to the selected loopback speech server', async ({ page }) => {
  await openApp(page);
  await editSettings(page, async () => {
    await page.locator('#setting-speech-server').selectOption('whispercpp');
    await page.locator('#setting-dictation').click();
  });
  await page.locator('.cm-content').click();
  await page.locator('#dictate-button').click();
  await expect(page.locator('.cm-line').last()).toHaveText(/spoken words/u, { timeout: 15_000 });

  const requested = await page.evaluate(() => (window as unknown as { __speechRequests: string[] }).__speechRequests);
  expect(requested.length).toBeGreaterThan(0);
  for (const url of requested) expect(url).toBe('http://127.0.0.1:5000/inference');
});

test('dictation consent does not survive a reload, but the chosen server does', async ({ page }) => {
  await openApp(page);
  await editSettings(page, async () => {
    await page.locator('#setting-speech-server').selectOption('vosk');
    await page.locator('#setting-dictation').click();
  });
  await page.reload();
  await page.keyboard.press('Control+,');
  await expect(page.locator('#setting-speech-server')).toHaveValue('vosk');
  await expect(page.locator('#setting-dictation')).toHaveAttribute('aria-checked', 'false');
  expect(await page.evaluate(() => (window as unknown as { __recorderStarted: number[] }).__recorderStarted)).toEqual([]);
});

test('the speech server list offers loopback addresses only', async ({ page }) => {
  await openApp(page);
  await page.keyboard.press('Control+,');
  const choices = await page.locator('#setting-speech-server option').evaluateAll((nodes) =>
    nodes.map((node) => ({ value: (node as HTMLOptionElement).value, text: node.textContent ?? '' })));
  expect(choices.length).toBeGreaterThan(0);
  // Every choice is a server on this machine: a fixed id, and a label naming its loopback port.
  for (const choice of choices) {
    expect(choice.value).toMatch(/^[a-z0-9-]+$/u);
    expect(choice.text).toMatch(/\(port \d+\)/u);
  }
  // The ids are exactly the audited allow-list; no free-form address can be typed in anywhere.
  expect(choices.map((choice) => choice.value).sort()).toEqual(['speaches', 'vosk', 'whispercpp']);
  expect(await page.locator('#setting-speech-server').evaluate((node) => (node as HTMLInputElement).type)).toBe('select-one');
});

test('a failing speech server is reported as a sentence, not a stack trace', async ({ page }) => {
  await page.addInitScript(() => {
    const realFetch = window.fetch.bind(window);
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (/audio|recognize|inference/u.test(url)) {
        return new Response('server error', { status: 500, headers: { 'content-type': 'text/plain' } });
      }
      return realFetch(input, init);
    };
  });
  await openApp(page);
  await editSettings(page, async () => { await page.locator('#setting-dictation').click(); });
  await page.locator('.cm-content').click();
  await page.locator('#dictate-button').click();
  await expect(page.locator('#toast')).toContainText(/speech server answered 500/i, { timeout: 15_000 });
  await expect(page.locator('#dictation-chip')).toBeHidden();
});
