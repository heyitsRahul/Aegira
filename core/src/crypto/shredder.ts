import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * Per-session envelope encryption with crypto-shredding (invariant 7).
 * Every session gets its own AES-256-GCM data key held in a vault; purging
 * a session destroys the key, which renders every ciphertext written under
 * it permanently unreadable. Deletion is key destruction, never a bare
 * DELETE.
 *
 * InMemoryKeyVault stands in for a KMS; the production KMS adapter must
 * implement the same KeyVault interface.
 */

export class KeyNotFoundError extends Error {
  constructor(keyId: string) {
    super(`no key exists for ${keyId}`);
    this.name = 'KeyNotFoundError';
  }
}

export class KeyDestroyedError extends Error {
  constructor(keyId: string) {
    super(`key for ${keyId} has been destroyed (crypto-shredded)`);
    this.name = 'KeyDestroyedError';
  }
}

export interface KeyVault {
  createKey(keyId: string): void;
  /** Throws KeyDestroyedError after shredding, KeyNotFoundError otherwise. */
  getKey(keyId: string): Buffer;
  /** Returns false if the key was already destroyed (idempotent). */
  destroyKey(keyId: string): boolean;
  hasLiveKey(keyId: string): boolean;
}

export class InMemoryKeyVault implements KeyVault {
  private readonly keys = new Map<string, Buffer>();
  private readonly destroyed = new Set<string>();

  createKey(keyId: string): void {
    if (this.keys.has(keyId) || this.destroyed.has(keyId)) {
      throw new Error(`key ${keyId} already exists or was destroyed; key ids are single-use`);
    }
    this.keys.set(keyId, randomBytes(32));
  }

  getKey(keyId: string): Buffer {
    const key = this.keys.get(keyId);
    if (key === undefined) {
      if (this.destroyed.has(keyId)) {
        throw new KeyDestroyedError(keyId);
      }
      throw new KeyNotFoundError(keyId);
    }
    return key;
  }

  destroyKey(keyId: string): boolean {
    const key = this.keys.get(keyId);
    if (key === undefined) {
      if (this.destroyed.has(keyId)) {
        return false;
      }
      throw new KeyNotFoundError(keyId);
    }
    key.fill(0);
    this.keys.delete(keyId);
    this.destroyed.add(keyId);
    return true;
  }

  hasLiveKey(keyId: string): boolean {
    return this.keys.has(keyId);
  }
}

export interface EncryptedBlob {
  readonly keyId: string;
  readonly iv: string;
  readonly tag: string;
  readonly ciphertext: string;
}

export class SessionCrypto {
  constructor(private readonly vault: KeyVault) {}

  provisionSession(sessionId: string): void {
    this.vault.createKey(sessionId);
  }

  encrypt(sessionId: string, plaintext: string): EncryptedBlob {
    const key = this.vault.getKey(sessionId);
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    return {
      keyId: sessionId,
      iv: iv.toString('base64'),
      tag: cipher.getAuthTag().toString('base64'),
      ciphertext: ciphertext.toString('base64'),
    };
  }

  decrypt(blob: EncryptedBlob): string {
    const key = this.vault.getKey(blob.keyId);
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(blob.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(blob.tag, 'base64'));
    return Buffer.concat([
      decipher.update(Buffer.from(blob.ciphertext, 'base64')),
      decipher.final(),
    ]).toString('utf8');
  }

  /** The purge primitive: destroys the session's key. Idempotent. */
  shred(sessionId: string): boolean {
    return this.vault.destroyKey(sessionId);
  }

  isShredded(sessionId: string): boolean {
    return !this.vault.hasLiveKey(sessionId);
  }
}
