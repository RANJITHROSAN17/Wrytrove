import type { ManagedDocument, SaveConflictDecision } from './types';

export type DocumentStoreListener = (doc: ManagedDocument) => void;

export class DocumentStore {
  private docs = new Map<string, ManagedDocument>();
  private listeners = new Set<DocumentStoreListener>();

  subscribe(listener: DocumentStoreListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(doc: ManagedDocument): void {
    for (const listener of this.listeners) {
      listener(doc);
    }
  }

  open(input: { id: string; path: string | null; content: string; baseHash: string | null }): ManagedDocument {
    const doc: ManagedDocument = {
      id: input.id,
      path: input.path,
      content: input.content,
      revision: 1,
      dirty: false,
      baseHash: input.baseHash,
    };
    this.docs.set(doc.id, doc);
    this.emit(doc);
    return doc;
  }

  get(id: string): ManagedDocument | undefined {
    return this.docs.get(id);
  }

  updateContent(id: string, content: string): ManagedDocument {
    const existing = this.docs.get(id);
    if (!existing) throw new Error(`Document not found: ${id}`);
    const updated: ManagedDocument = {
      ...existing,
      content,
      revision: existing.revision + 1,
      dirty: true,
    };
    this.docs.set(id, updated);
    this.emit(updated);
    return updated;
  }

  canSave(id: string, expectedRevision: number, diskHash: string | null): SaveConflictDecision {
    const existing = this.docs.get(id);
    if (!existing) return { allowed: false, reason: 'not-found' };
    if (existing.revision !== expectedRevision) return { allowed: false, reason: 'stale-revision' };
    if (existing.baseHash !== null && diskHash !== null && existing.baseHash !== diskHash) {
      return { allowed: false, reason: 'external-hash-mismatch' };
    }
    return { allowed: true, reason: 'ok' };
  }

  markSaved(id: string, savedRevision: number, newHash: string): ManagedDocument {
    const existing = this.docs.get(id);
    if (!existing) throw new Error(`Document not found: ${id}`);
    const dirty = existing.revision !== savedRevision;
    const updated: ManagedDocument = {
      ...existing,
      dirty,
      baseHash: newHash,
    };
    this.docs.set(id, updated);
    this.emit(updated);
    return updated;
  }
}
