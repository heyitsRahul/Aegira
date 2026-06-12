import { describe, expect, it } from 'vitest';
import {
  InMemoryKeyVault,
  KeyDestroyedError,
  KeyNotFoundError,
  SessionCrypto,
} from '../src/crypto/shredder';

describe('crypto-shredding (invariant 7)', () => {
  it('round-trips plaintext under a per-session key', () => {
    const crypto = new SessionCrypto(new InMemoryKeyVault());
    crypto.provisionSession('s1');
    const blob = crypto.encrypt('s1', '{"lat":12.9716,"lng":77.5946}');
    expect(crypto.decrypt(blob)).toBe('{"lat":12.9716,"lng":77.5946}');
  });

  it('shred destroys the key: decryption becomes permanently impossible', () => {
    const crypto = new SessionCrypto(new InMemoryKeyVault());
    crypto.provisionSession('s1');
    const blob = crypto.encrypt('s1', 'sensitive');
    expect(crypto.shred('s1')).toBe(true);
    expect(crypto.isShredded('s1')).toBe(true);
    expect(() => crypto.decrypt(blob)).toThrow(KeyDestroyedError);
    expect(() => crypto.encrypt('s1', 'more')).toThrow(KeyDestroyedError);
  });

  it('shred is idempotent', () => {
    const crypto = new SessionCrypto(new InMemoryKeyVault());
    crypto.provisionSession('s1');
    expect(crypto.shred('s1')).toBe(true);
    expect(crypto.shred('s1')).toBe(false);
  });

  it('keys are isolated per session', () => {
    const crypto = new SessionCrypto(new InMemoryKeyVault());
    crypto.provisionSession('s1');
    crypto.provisionSession('s2');
    const blob2 = crypto.encrypt('s2', 'session two data');
    crypto.shred('s1');
    expect(crypto.decrypt(blob2)).toBe('session two data');
  });

  it('key ids are single-use: a shredded id can never be re-provisioned', () => {
    const vault = new InMemoryKeyVault();
    const crypto = new SessionCrypto(vault);
    crypto.provisionSession('s1');
    crypto.shred('s1');
    expect(() => crypto.provisionSession('s1')).toThrow();
  });

  it('tampered ciphertext fails authentication', () => {
    const crypto = new SessionCrypto(new InMemoryKeyVault());
    crypto.provisionSession('s1');
    const blob = crypto.encrypt('s1', 'integrity matters');
    const bytes = Buffer.from(blob.ciphertext, 'base64');
    bytes[0] ^= 0xff;
    expect(() =>
      crypto.decrypt({ ...blob, ciphertext: bytes.toString('base64') }),
    ).toThrow();
  });

  it('unknown keys throw KeyNotFoundError, distinct from destroyed keys', () => {
    const vault = new InMemoryKeyVault();
    expect(() => vault.getKey('never-existed')).toThrow(KeyNotFoundError);
  });
});
