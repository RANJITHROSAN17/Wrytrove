export type WorkbenchCommand =
  | { type: 'file.new' }
  | { type: 'file.open' }
  | { type: 'file.save' }
  | { type: 'file.saveAs' }
  | { type: 'search.find' }
  | { type: 'ai.askDocument' }
  | { type: 'settings.open' }
  | { type: 'commandPalette.open' };

export interface ManagedDocument {
  readonly id: string;
  readonly path: string | null;
  readonly content: string;
  readonly revision: number;
  readonly dirty: boolean;
  readonly baseHash: string | null;
}

export interface SaveConflictDecision {
  readonly allowed: boolean;
  readonly reason: 'ok' | 'stale-revision' | 'external-hash-mismatch' | 'not-found';
}

export interface FileService {
  readText(path: string): Promise<{ content: string; hash: string }>;
  writeText(path: string, content: string, expectedHash: string | null): Promise<{ hash: string }>;
}

export interface RecoveryService {
  scheduleDraft(docId: string, content: string, revision: number): void;
  flush(): Promise<void>;
}

export interface SearchService {
  search(query: string): Promise<readonly { path: string; line: number; preview: string }[]>;
}

export interface AiService {
  askDocument(question: string, docId: string): Promise<string>;
}

export interface NoteIndexService {
  rebuild(): Promise<void>;
}
