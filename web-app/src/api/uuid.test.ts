import { afterEach, describe, expect, it, vi } from 'vitest';
import { uuid } from './uuid';

const V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const real = globalThis.crypto;

afterEach(() => {
  Object.defineProperty(globalThis, 'crypto', { value: real, configurable: true, writable: true });
  vi.restoreAllMocks();
});
const useCrypto = (value: unknown) => Object.defineProperty(globalThis, 'crypto', { value, configurable: true, writable: true });

describe('uuid', () => {
  it('uses the built-in when the page is in a secure context', () => {
    const randomUUID = vi.fn(() => '11111111-2222-4333-8444-555555555555');
    useCrypto({ randomUUID, getRandomValues: real.getRandomValues.bind(real) });
    expect(uuid()).toBe('11111111-2222-4333-8444-555555555555');
    expect(randomUUID).toHaveBeenCalledOnce();
  });

  // The case that broke the phone: plain HTTP on a LAN address, where
  // randomUUID is undefined but getRandomValues still works.
  it('falls back to getRandomValues off HTTPS', () => {
    useCrypto({ getRandomValues: real.getRandomValues.bind(real) });
    const ids = new Set(Array.from({ length: 200 }, () => uuid()));
    expect(ids.size).toBe(200);
    for (const id of ids) expect(id).toMatch(V4);
  });

  it('still returns a usable id when no crypto is exposed at all', () => {
    useCrypto(undefined);
    expect(uuid()).toMatch(V4);
    expect(uuid()).not.toBe(uuid());
  });
});
