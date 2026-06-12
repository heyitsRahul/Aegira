import { randomBytes } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { KeyDestroyedError, KeyNotFoundError, KeyVault } from '../crypto/shredder';
import { SessionRepository, SessionSnapshot } from './session-repository';

/**
 * Dev/staging persistence on Node's built-in SQLite. The Postgres
 * migrations in /migrations remain the production schema; this adapter
 * mirrors their retention semantics:
 *  - sessions:   retention_class incident-scoped (ciphertext blobs only)
 *  - vault_keys: the KMS stand-in; destroy = zero + flag, never reuse
 */

export function openDatabase(path: string): DatabaseSync {
  const db = new DatabaseSync(path);
  db.exec(`
    -- retention_class: incident-scoped (snapshot holds ciphertext only)
    CREATE TABLE IF NOT EXISTS sessions (
      id       TEXT PRIMARY KEY,
      snapshot TEXT NOT NULL
    );
    -- retention_class: incident-scoped (key material; destroyed = crypto-shred)
    CREATE TABLE IF NOT EXISTS vault_keys (
      key_id    TEXT PRIMARY KEY,
      material  BLOB,
      destroyed INTEGER NOT NULL DEFAULT 0
    );
  `);
  return db;
}

export class SqliteSessionRepository implements SessionRepository {
  constructor(private readonly db: DatabaseSync) {}

  save(snapshot: SessionSnapshot): void {
    this.db
      .prepare(
        `INSERT INTO sessions (id, snapshot) VALUES (?, ?)
         ON CONFLICT(id) DO UPDATE SET snapshot = excluded.snapshot`,
      )
      .run(snapshot.sessionId, JSON.stringify(snapshot));
  }

  loadAll(): SessionSnapshot[] {
    const rows = this.db.prepare('SELECT snapshot FROM sessions').all() as Array<{
      snapshot: string;
    }>;
    return rows.map((r) => JSON.parse(r.snapshot) as SessionSnapshot);
  }
}

/**
 * KeyVault on SQLite. Same contract as the in-memory vault: key ids are
 * single-use, destruction zeroes the material and is irreversible, and a
 * destroyed key is distinguishable from one that never existed (so decrypt
 * failures surface as crypto-shred, not bugs).
 */
export class SqliteKeyVault implements KeyVault {
  constructor(private readonly db: DatabaseSync) {}

  private row(keyId: string): { material: Uint8Array | null; destroyed: number } | undefined {
    return this.db
      .prepare('SELECT material, destroyed FROM vault_keys WHERE key_id = ?')
      .get(keyId) as { material: Uint8Array | null; destroyed: number } | undefined;
  }

  createKey(keyId: string): void {
    if (this.row(keyId) !== undefined) {
      throw new Error(`key ${keyId} already exists or was destroyed; key ids are single-use`);
    }
    this.db
      .prepare('INSERT INTO vault_keys (key_id, material, destroyed) VALUES (?, ?, 0)')
      .run(keyId, randomBytes(32));
  }

  getKey(keyId: string): Buffer {
    const row = this.row(keyId);
    if (row === undefined) {
      throw new KeyNotFoundError(keyId);
    }
    if (row.destroyed === 1 || row.material === null) {
      throw new KeyDestroyedError(keyId);
    }
    return Buffer.from(row.material);
  }

  destroyKey(keyId: string): boolean {
    const row = this.row(keyId);
    if (row === undefined) {
      throw new KeyNotFoundError(keyId);
    }
    if (row.destroyed === 1) {
      return false;
    }
    this.db
      .prepare('UPDATE vault_keys SET material = NULL, destroyed = 1 WHERE key_id = ?')
      .run(keyId);
    return true;
  }

  hasLiveKey(keyId: string): boolean {
    const row = this.row(keyId);
    return row !== undefined && row.destroyed === 0;
  }
}
