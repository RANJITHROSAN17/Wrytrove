/**
 * Dictation. Audio is captured in the webview and transcribed by a speech server running on this
 * computer, so nothing is uploaded. The endpoints below are an exact, audited allow-list of loopback
 * addresses rather than a free-form URL field: a dictated transcript is the most sensitive thing a
 * text editor ever handles, so where it may be sent is a capability decision, not a preference.
 *
 * The engine knows nothing about the editor. It reports status, errors and finished text, and the
 * host decides where that text goes. That keeps the whole capture/transcribe loop testable without a
 * DOM, an editor or a real microphone.
 */

export type DictationStatus = 'off' | 'starting' | 'listening' | 'stopping' | 'error';

/** What a finished chunk of speech turned into. Empty means "nothing recognisable". */
export interface DictationChunk { text: string }

export interface DictationEvents {
  onStatus(status: DictationStatus): void;
  /** A user-facing failure. The engine never restarts itself after one. */
  onError(message: string): void;
  /** Called once per transcribed chunk with the text to insert. Never called with an empty string. */
  onText(text: string): void;
}

/**
 * One chunk of recorded audio, plus the failure that ended the recording. A recorder that dies
 * mid-session must report why rather than going quiet.
 */
export interface DictationRecorder {
  start(timesliceMs: number, onChunk: (audio: Blob) => void, onFailure: (error: unknown) => void): void;
  stop(): void;
}

export interface DictationDependencies {
  /** Ask the OS for the microphone. A rejection is a permission problem, not a crash. */
  requestMicrophone(): Promise<unknown>;
  createRecorder(stream: unknown): DictationRecorder;
  /** POST one chunk and return its transcript. Throwing becomes a visible error. */
  transcribe(audio: Blob): Promise<string>;
}

/** A local speech server Wrytrove is allowed to talk to. */
export interface LocalSpeechEndpoint {
  readonly id: string;
  readonly label: string;
  /** Exact loopback URL. Must also appear in the Tauri HTTP capability and both CSPs. */
  readonly url: string;
  /** Body and content type for one recorded chunk. */
  build(audio: Blob, language: string): { body: BodyInit; contentType: string | null };
  /** Read the transcript out of the response. Null means "unrecognized shape", never a guess. */
  parse(payload: unknown): string | null;
}

const multipart = (fields: Record<string, string>, audio: Blob) => {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.set(key, value);
  form.set('file', audio, 'speech.webm');
  // A content type of null lets fetch derive the multipart boundary itself.
  return { body: form as BodyInit, contentType: null };
};

/**
 * Three well-known local servers, each with the request and response shape it actually uses. Adding
 * one is a deliberate act: it needs the URL in `capabilities/default.json`, in the desktop CSP, in
 * the browser-preview CSP and in `scripts/security-audit.mjs`, or the static audit fails.
 */
export const LOCAL_SPEECH_ENDPOINTS: readonly LocalSpeechEndpoint[] = [
  {
    id: 'speaches',
    label: 'speaches / faster-whisper-server (port 8080)',
    url: 'http://127.0.0.1:8080/v1/audio/transcriptions',
    build: (audio, language) => multipart({ model: 'whisper-1', language, response_format: 'json' }, audio),
    parse: (payload) => typeof payload === 'object' && payload !== null && typeof (payload as { text?: unknown }).text === 'string'
      ? (payload as { text: string }).text : null,
  },
  {
    id: 'whispercpp',
    label: 'whisper.cpp server (port 5000)',
    url: 'http://127.0.0.1:5000/inference',
    build: (audio) => multipart({ response_format: 'json' }, audio),
    parse: (payload) => typeof payload === 'object' && payload !== null && typeof (payload as { text?: unknown }).text === 'string'
      ? (payload as { text: string }).text : null,
  },
  {
    id: 'vosk',
    label: 'vosk-server (port 2700)',
    url: 'http://127.0.0.1:2700/api/v1/recognize',
    // vosk-server takes the raw encoded audio and answers with a word list plus a joined text.
    build: (audio) => ({ body: audio as BodyInit, contentType: audio.type || 'application/octet-stream' }),
    parse: (payload) => typeof payload === 'object' && payload !== null && typeof (payload as { text?: unknown }).text === 'string'
      ? (payload as { text: string }).text : null,
  },
];

export const DEFAULT_SPEECH_ENDPOINT = LOCAL_SPEECH_ENDPOINTS[0].id;

export function speechEndpoint(id: string): LocalSpeechEndpoint {
  return LOCAL_SPEECH_ENDPOINTS.find((entry) => entry.id === id) ?? LOCAL_SPEECH_ENDPOINTS[0];
}

/** Chunk length in milliseconds, clamped so a mistyped setting cannot stall or flood the session. */
export function normalizeChunkMs(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(15_000, Math.max(1_000, Math.trunc(value))) : 4_000;
}

/** BCP-47-ish, and short enough that a garbage value cannot become a request header. */
export function normalizeSpeechLanguage(value: unknown): string {
  const text = typeof value === 'string' ? value.trim() : '';
  return /^[A-Za-z]{2,8}(-[A-Za-z0-9]{2,8})?$/u.test(text) ? text : 'en';
}

/**
 * Join a new dictated chunk onto what is already in the document. Speech servers return whole
 * sentences with their own spacing, so the only fix needed is a missing separator between chunks;
 * anything else would rewrite what the recogniser actually heard.
 */
export function joinDictatedText(existing: string, addition: string): string {
  if (!addition) return existing;
  if (!existing) return addition;
  const needsSpace = !/\s$/u.test(existing) && !/^\s/u.test(addition);
  return needsSpace ? `${existing} ${addition}` : `${existing}${addition}`;
}

/** Turn an unknown failure into one sentence. Never leaks a stack trace or a raw URL. */
export function dictationErrorMessage(error: unknown): string {
  if (error instanceof DOMException && (error.name === 'NotAllowedError' || error.name === 'SecurityError')) {
    return 'Wrytrove could not use the microphone. Allow microphone access for this app and try again.';
  }
  if (error instanceof DOMException && error.name === 'NotFoundError') {
    return 'No microphone was found. Connect one and try again.';
  }
  if (error instanceof Error && error.message) return error.message;
  return 'Dictation stopped unexpectedly.';
}

export class DictationEngine {
  private status: DictationStatus = 'off';
  private stream: unknown = null;
  private recorder: DictationRecorder | null = null;
  private stopRequested = false;

  constructor(private readonly events: DictationEvents, private readonly deps: DictationDependencies) {}

  getStatus(): DictationStatus { return this.status; }

  private setStatus(status: DictationStatus): void {
    if (this.status === status) return;
    this.status = status;
    this.events.onStatus(status);
  }

  async start(chunkMs: number): Promise<void> {
    if (this.status === 'listening' || this.status === 'starting') return;
    this.stopRequested = false;
    this.setStatus('starting');
    let stream: unknown;
    try {
      stream = await this.deps.requestMicrophone();
    } catch (error) {
      this.setStatus('error');
      this.events.onError(dictationErrorMessage(error));
      return;
    }
    // A stop that arrived while the permission prompt was open must win.
    if (this.stopRequested) { releaseStream(stream); this.setStatus('off'); return; }
    this.stream = stream;
    const recorder = this.deps.createRecorder(stream);
    this.recorder = recorder;
    recorder.start(chunkMs, (audio) => { void this.handleChunk(audio); }, (error) => this.fail(error));
    this.setStatus('listening');
  }

  stop(): void {
    if (this.status === 'off') return;
    this.stopRequested = true;
    if (this.status === 'starting') return;
    this.setStatus('stopping');
    this.recorder?.stop();
    this.teardown();
    this.setStatus('off');
  }

  private teardown(): void {
    this.recorder = null;
    releaseStream(this.stream);
    this.stream = null;
  }

  private fail(error: unknown): void {
    this.recorder?.stop();
    this.teardown();
    this.setStatus('error');
    this.events.onError(dictationErrorMessage(error));
  }

  private async handleChunk(audio: Blob): Promise<void> {
    // A recorder can flush a final empty chunk as it shuts down; transcribing it would add nothing.
    if (audio.size === 0) return;
    try {
      const text = (await this.deps.transcribe(audio)).trim();
      if (text) this.events.onText(text);
    } catch (error) {
      this.fail(error);
    }
  }
}

function releaseStream(stream: unknown): void {
  const tracks = (stream as MediaStream | null)?.getTracks?.();
  tracks?.forEach((track) => track.stop());
}

/** Default dependencies, resolved lazily so a missing API is reported rather than thrown at import. */
export function defaultDictationDependencies(endpoint: LocalSpeechEndpoint, language: string): DictationDependencies {
  return {
    requestMicrophone: async () => {
      const media = navigator.mediaDevices;
      if (!media?.getUserMedia) throw new Error('This build cannot open a microphone.');
      return media.getUserMedia({ audio: true });
    },
    createRecorder: (stream) => {
      const Recorder = window.MediaRecorder;
      if (!Recorder) throw new Error('This build cannot record audio.');
      const recorder = new Recorder(stream as MediaStream);
      return {
        start: (timesliceMs, onChunk, onFailure) => {
          recorder.ondataavailable = (event) => { if (event.data.size > 0) onChunk(event.data); };
          recorder.onerror = (event) => onFailure((event as ErrorEvent).error ?? new Error('Recording failed.'));
          recorder.start(timesliceMs);
        },
        stop: () => { if (recorder.state !== 'inactive') recorder.stop(); },
      };
    },
    transcribe: async (audio) => {
      const request = endpoint.build(audio, language);
      const headers: Record<string, string> = {};
      if (request.contentType) headers['Content-Type'] = request.contentType;
      const response = await fetch(endpoint.url, { method: 'POST', body: request.body, headers });
      if (!response.ok) throw new Error(`The speech server answered ${response.status}. Check that it is running and has a model loaded.`);
      const payload: unknown = await response.json().catch(() => null);
      const text = endpoint.parse(payload);
      if (text === null) throw new Error('The speech server answered in a shape Wrytrove does not understand.');
      return text;
    },
  };
}
