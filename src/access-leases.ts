// AUD-03: a pure model of persisted file-access leases. A lease is the right to touch a
// selected file or folder again after a restart. A lease stays alive while something needs it
// (an open document or a pending operation). Revoking a lease that is still needed is deferred:
// open documents keep working, but no new access is allowed, and the lease is removed when its
// last reason is released. This module does not talk to Tauri; the native layer must check
// `allowsNewAccess` before any read or write through a persisted scope.

export type LeaseKind = 'file' | 'folder';
export type LeaseReason = 'open-document' | 'pending-operation';

export interface Lease {
  id: string;
  kind: LeaseKind;
  /** Opaque handle supplied by the native layer. Raw paths are not kept in this model. */
  handle: string;
  reasons: LeaseReason[];
  revokeRequested: boolean;
  revoked: boolean;
}

export type RevokeResult =
  | { status: 'revoked' }
  | { status: 'deferred'; reasons: LeaseReason[] }
  | { status: 'unknown' };

export class LeaseRegistry {
  private readonly leases = new Map<string, Lease>();
  private counter = 0;

  /** Grant a new lease for a native handle. Returns its id. */
  grant(kind: LeaseKind, handle: string): string {
    if (!handle || handle.length > 4096) throw new Error('A lease needs a handle of 1 to 4096 characters.');
    this.counter += 1;
    const id = `lease-${this.counter}`;
    this.leases.set(id, { id, kind, handle, reasons: [], revokeRequested: false, revoked: false });
    return id;
  }

  /** Mark a lease as needed by an open document or pending operation. */
  retain(id: string, reason: LeaseReason): boolean {
    const lease = this.active(id);
    if (!lease) return false;
    if (!lease.reasons.includes(reason)) lease.reasons.push(reason);
    return true;
  }

  /** Drop one reason. A lease with no reasons left and a pending revoke is removed now. */
  release(id: string, reason: LeaseReason): void {
    const lease = this.leases.get(id);
    if (!lease || lease.revoked) return;
    lease.reasons = lease.reasons.filter((r) => r !== reason);
    if (lease.reasons.length === 0 && lease.revokeRequested) lease.revoked = true;
  }

  /** Revoke immediately if nothing needs the lease; otherwise defer until it is released. */
  revoke(id: string): RevokeResult {
    const lease = this.leases.get(id);
    if (!lease || lease.revoked) return { status: 'unknown' };
    if (lease.reasons.length === 0) {
      lease.revoked = true;
      return { status: 'revoked' };
    }
    lease.revokeRequested = true;
    return { status: 'deferred', reasons: [...lease.reasons] };
  }

  /** Whether a brand-new read or write may use this lease. Revoked and pending-revoke leases refuse. */
  allowsNewAccess(id: string): boolean {
    const lease = this.leases.get(id);
    return !!lease && !lease.revoked && !lease.revokeRequested;
  }

  /** Whether an already open document may keep using this lease until it closes. */
  allowsExistingDocument(id: string): boolean {
    const lease = this.leases.get(id);
    return !!lease && !lease.revoked;
  }

  /** Active and deferred leases, for the Access leases panel. */
  list(): Lease[] {
    return [...this.leases.values()].filter((l) => !l.revoked).map((l) => ({ ...l, reasons: [...l.reasons] }));
  }

  /** A lease that may accept new reasons; revoked or pending-revoke leases may not. */
  private active(id: string): Lease | undefined {
    const lease = this.leases.get(id);
    return lease && !lease.revoked && !lease.revokeRequested ? lease : undefined;
  }
}
