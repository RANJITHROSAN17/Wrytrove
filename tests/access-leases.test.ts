import { describe, expect, it } from 'vitest';
import { LeaseRegistry } from '../src/access-leases';

describe('LeaseRegistry', () => {
  it('revokes immediately when nothing needs the lease', () => {
    const reg = new LeaseRegistry();
    const id = reg.grant('folder', 'native-handle-1');
    expect(reg.revoke(id)).toEqual({ status: 'revoked' });
    expect(reg.allowsNewAccess(id)).toBe(false);
    expect(reg.allowsExistingDocument(id)).toBe(false);
    expect(reg.list()).toEqual([]);
  });

  it('keeps an open document usable while refusing new access after a deferred revoke', () => {
    const reg = new LeaseRegistry();
    const id = reg.grant('file', 'handle-open');
    reg.retain(id, 'open-document');
    expect(reg.revoke(id)).toEqual({ status: 'deferred', reasons: ['open-document'] });
    expect(reg.allowsNewAccess(id)).toBe(false);
    expect(reg.allowsExistingDocument(id)).toBe(true);
    expect(reg.list()).toMatchObject([{ id, revokeRequested: true, revoked: false }]);
  });

  it('removes the lease when the last reason is released after a deferred revoke', () => {
    const reg = new LeaseRegistry();
    const id = reg.grant('folder', 'handle-folder');
    reg.retain(id, 'open-document');
    reg.retain(id, 'pending-operation');
    reg.revoke(id);
    reg.release(id, 'open-document');
    expect(reg.allowsExistingDocument(id)).toBe(true);
    reg.release(id, 'pending-operation');
    expect(reg.allowsExistingDocument(id)).toBe(false);
    expect(reg.list()).toEqual([]);
  });

  it('a lease with no pending revoke survives release of its reasons', () => {
    const reg = new LeaseRegistry();
    const id = reg.grant('folder', 'handle-keep');
    reg.retain(id, 'open-document');
    reg.release(id, 'open-document');
    expect(reg.allowsNewAccess(id)).toBe(true);
  });

  it('does not accept new reasons for a lease that is pending revocation', () => {
    const reg = new LeaseRegistry();
    const id = reg.grant('file', 'handle-x');
    reg.retain(id, 'open-document');
    reg.revoke(id);
    expect(reg.retain(id, 'pending-operation')).toBe(false);
  });

  it('reports unknown leases and rejects empty handles', () => {
    const reg = new LeaseRegistry();
    expect(reg.revoke('missing')).toEqual({ status: 'unknown' });
    expect(reg.allowsNewAccess('missing')).toBe(false);
    expect(() => reg.grant('file', '')).toThrow();
  });
});
