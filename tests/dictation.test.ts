import { describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_SPEECH_ENDPOINT,
  DictationEngine,
  LOCAL_SPEECH_ENDPOINTS,
  dictationErrorMessage,
  joinDictatedText,
  normalizeChunkMs,
  normalizeSpeechLanguage,
  speechEndpoint,
  type DictationDependencies,
  type DictationEvents,
  type DictationRecorder,
  type DictationStatus,
} from '../src/dictation';

/** A recorder stub that captures the chunk callback so tests can speak on demand. */
function recorder() {
  let onChunk: ((audio: Blob) => void) | null = null;
  let onFailure: ((error: unknown) => void) | null = null;
  const started: number[] = [];
  const stopped = vi.fn();
  const stub: DictationRecorder & { started: number[]; stopped: ReturnType<typeof vi.fn> } = {
    start: (timesliceMs, chunk, failure) => { started.push(timesliceMs); onChunk = chunk; onFailure = failure; },
    stop: () => { stopped(); onChunk = null; },
    started,
    stopped,
  };
  const harness = {
    recorder: stub,
    speak: (text: string, size = text.length) => {
      const blob = new Blob([text], { type: 'audio/webm' });
      Object.defineProperty(blob, 'size', { value: size });
      onChunk?.(blob);
    },
    fail: (error: unknown) => onFailure?.(error),
    get startedTimeslice() { return started[0]; },
  };
  return harness;
}

type SpyEvents = {
  onStatus: ReturnType<typeof vi.fn<(status: DictationStatus) => void>>;
  onError: ReturnType<typeof vi.fn<(message: string) => void>>;
  onText: ReturnType<typeof vi.fn<(text: string) => void>>;
};

function harness(options: { chunks?: string[]; transcript?: string; microphone?: unknown; throws?: Error; transcribeThrows?: Error } = {}) {
  const events = { onStatus: vi.fn(), onError: vi.fn(), onText: vi.fn() } as SpyEvents;
  const statuses: string[] = [];
  const recording = recorder();
  // A shared `throws` is honoured by every call, so a test can make transcription fail once.
  const transcribe = vi.fn(async (audio: Blob) => {
    if (options.transcribeThrows) throw options.transcribeThrows;
    // Each call answers with its own chunk so ordering can be asserted.
    const index = transcribe.mock.calls.findIndex((call) => call[0] === audio);
    return options.transcript ?? options.chunks?.[index] ?? '';
  });
  const deps: DictationDependencies = {
    requestMicrophone: vi.fn(async () => {
      // Only the microphone path honours `throws`; transcription failures use `transcribeThrows`.
      if (options.throws) throw options.throws;
      return options.microphone ?? { getTracks: () => [] };
    }),
    createRecorder: vi.fn(() => recording.recorder),
    transcribe,
  };
  const engine = new DictationEngine(
    { onStatus: (status) => { statuses.push(status); events.onStatus(status); }, onError: events.onError, onText: events.onText },
    deps,
  );
  return { engine, deps, events, statuses, recording, transcribe };
}

describe('speech server allow-list', () => {
  it('offers only loopback servers, so no audio can reach a third party', () => {
    expect(LOCAL_SPEECH_ENDPOINTS.length).toBeGreaterThan(0);
    for (const entry of LOCAL_SPEECH_ENDPOINTS) {
      expect(entry.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\//u);
      expect(entry.url).not.toMatch(/tauri\.localhost|arena\.ai/iu);
    }
  });

  it('falls back to the default for an unknown id instead of inventing a URL', () => {
    expect(speechEndpoint('nonsense').id).toBe(DEFAULT_SPEECH_ENDPOINT);
    expect(speechEndpoint('whispercpp').url).toBe('http://127.0.0.1:5000/inference');
  });

  it('parses only the documented response shape', () => {
    const entry = speechEndpoint('speaches');
    expect(entry.parse({ text: 'hello' })).toBe('hello');
    expect(entry.parse({ transcript: 'hello' })).toBeNull();
    expect(entry.parse('hello')).toBeNull();
    expect(entry.parse(null)).toBeNull();
    expect(entry.parse([])).toBeNull();
  });

  it('clamps chunk length and language to safe values', () => {
    expect(normalizeChunkMs(0)).toBe(1000);
    expect(normalizeChunkMs(99_999)).toBe(15_000);
    expect(normalizeChunkMs('four' as unknown)).toBe(4000);
    expect(normalizeSpeechLanguage(' en-GB ')).toBe('en-GB');
    expect(normalizeSpeechLanguage('../../etc')).toBe('en');
    expect(normalizeSpeechLanguage(undefined)).toBe('en');
  });
});

describe('joinDictatedText', () => {
  it('separates chunks only where a separator is missing', () => {
    expect(joinDictatedText('', 'hello')).toBe('hello');
    expect(joinDictatedText('hello', ' world')).toBe('hello world');
    expect(joinDictatedText('hello', 'world')).toBe('hello world');
    expect(joinDictatedText('hello ', 'world')).toBe('hello world');
    expect(joinDictatedText('hello', '')).toBe('hello');
    expect(joinDictatedText('line\n', 'next')).toBe('line\nnext');
  });
});

describe('dictationErrorMessage', () => {
  it('turns a microphone refusal into a sentence a user can act on', () => {
    expect(dictationErrorMessage(new DOMException('nope', 'NotAllowedError'))).toMatch(/microphone/i);
    expect(dictationErrorMessage(new DOMException('nope', 'NotFoundError'))).toMatch(/no microphone/i);
    expect(dictationErrorMessage(new Error('The speech server answered 500.'))).toBe('The speech server answered 500.');
    expect(dictationErrorMessage('weird')).toMatch(/stopped unexpectedly/i);
  });
});

describe('DictationEngine', () => {
  it('never touches the microphone until start() is called', async () => {
    const { engine, deps, recording } = harness();
    expect(deps.requestMicrophone).not.toHaveBeenCalled();
    await engine.start(4000);
    expect(deps.requestMicrophone).toHaveBeenCalledTimes(1);
    expect(recording.startedTimeslice).toBe(4000);
    expect(engine.getStatus()).toBe('listening');
  });

  it('ignores a second start() while already listening', async () => {
    const { engine, deps } = harness();
    await engine.start(4000);
    await engine.start(4000);
    expect(deps.requestMicrophone).toHaveBeenCalledTimes(1);
  });

  it('reports each transcribed chunk in order', async () => {
    const { engine, events, recording } = harness({ chunks: ['first sentence.', 'second sentence.'] });
    await engine.start(4000);
    recording.speak('a');
    await vi.waitFor(() => expect(events.onText).toHaveBeenCalledTimes(1));
    recording.speak('b');
    await vi.waitFor(() => expect(events.onText).toHaveBeenCalledTimes(2));
    expect(events.onText.mock.calls.map((call) => call[0])).toEqual(['first sentence.', 'second sentence.']);
    expect(events.onError).not.toHaveBeenCalled();
  });

  it('does not transcribe an empty flush from the recorder', async () => {
    const { engine, events, recording, transcribe } = harness({ transcript: 'ignored' });
    await engine.start(4000);
    recording.speak('x', 0);
    await Promise.resolve();
    expect(transcribe).not.toHaveBeenCalled();
    expect(events.onText).not.toHaveBeenCalled();
  });

  it('stops cleanly and reports off, without a restart', async () => {
    const { engine, statuses, recording, deps } = harness();
    await engine.start(4000);
    engine.stop();
    expect(recording.recorder.stopped).toHaveBeenCalledTimes(1);
    expect(engine.getStatus()).toBe('off');
    expect(statuses).toEqual(['starting', 'listening', 'stopping', 'off']);
    // No self-recovery: a stopped session stays stopped.
    await engine.start(4000);
    expect(deps.requestMicrophone).toHaveBeenCalledTimes(2);
  });

  it('surfaces a microphone refusal as an error and stays off', async () => {
    const { engine, events, deps } = harness({ throws: new DOMException('denied', 'NotAllowedError') });
    await engine.start(4000);
    expect(engine.getStatus()).toBe('error');
    expect(events.onError).toHaveBeenCalledTimes(1);
    expect(events.onError.mock.calls[0][0]).toMatch(/microphone/i);
    expect(deps.createRecorder).not.toHaveBeenCalled();
  });

  it('surfaces a transcription failure and closes the session', async () => {
    const { engine, events, recording } = harness({ transcribeThrows: new Error('The speech server answered 500.') });
    await engine.start(4000);
    recording.speak('audio');
    await vi.waitFor(() => expect(events.onError).toHaveBeenCalledTimes(1));
    expect(engine.getStatus()).toBe('error');
    expect(events.onError.mock.calls[0][0]).toMatch(/speech server/i);
    expect(recording.recorder.stopped).toHaveBeenCalled();
  });

  it('surfaces a recorder failure and closes the session', async () => {
    const { engine, events, recording } = harness();
    await engine.start(4000);
    recording.fail(new Error('device removed'));
    expect(events.onError).toHaveBeenCalledWith('device removed');
    expect(engine.getStatus()).toBe('error');
    expect(recording.recorder.stopped).toHaveBeenCalled();
  });

  it('honours a stop that arrives while the permission prompt is still open', async () => {
    let resolveMicrophone: (value: unknown) => void = () => {};
    const events: DictationEvents = { onStatus: vi.fn(), onError: vi.fn(), onText: vi.fn() };
    const stream = { getTracks: () => [{ stop: vi.fn() }] };
    const engine = new DictationEngine(events, {
      requestMicrophone: () => new Promise((resolve) => { resolveMicrophone = resolve; }),
      createRecorder: vi.fn(() => recorder().recorder),
      transcribe: vi.fn(),
    });
    const started = engine.start(4000);
    engine.stop();
    resolveMicrophone(stream);
    await started;
    expect(engine.getStatus()).toBe('off');
    expect(events.onStatus).not.toHaveBeenCalledWith('listening');
  });
});
