import { randomBytes } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { KeyDestroyedError, KeyNotFoundError, KeyVault } from '../crypto/shredder';
import { RegistrationRecord, RegistrationStore } from '../services/registration.service';
import { WaitlistEntry, WaitlistStore } from '../services/waitlist.service';
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
    -- retention_class: durable (account-class SMS registrations, consent v2;
    -- deliberately contains no location — see migrations/0008)
    CREATE TABLE IF NOT EXISTS registrations (
      phone_ref TEXT PRIMARY KEY,
      record    TEXT NOT NULL
    );
    -- retention_class: durable (pre-launch marketing waitlist, consent v3;
    -- no location, no session link — see migrations/0011)
    CREATE TABLE IF NOT EXISTS waitlist (
      email_ref TEXT PRIMARY KEY,
      entry     TEXT NOT NULL
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

export class SqliteRegistrationStore implements RegistrationStore {
  constructor(private readonly db: DatabaseSync) {}

  save(record: RegistrationRecord): void {
    this.db
      .prepare(
        `INSERT INTO registrations (phone_ref, record) VALUES (?, ?)
         ON CONFLICT(phone_ref) DO UPDATE SET record = excluded.record`,
      )
      .run(record.phoneRef, JSON.stringify(record));
  }

  get(phoneRef: string): RegistrationRecord | undefined {
    const row = this.db
      .prepare('SELECT record FROM registrations WHERE phone_ref = ?')
      .get(phoneRef) as { record: string } | undefined;
    return row === undefined ? undefined : (JSON.parse(row.record) as RegistrationRecord);
  }

  delete(phoneRef: string): void {
    this.db.prepare('DELETE FROM registrations WHERE phone_ref = ?').run(phoneRef);
  }
}

export class SqliteWaitlistStore implements WaitlistStore {
  constructor(private readonly db: DatabaseSync) {}

  save(entry: WaitlistEntry): void {
    this.db
      .prepare(
        `INSERT INTO waitlist (email_ref, entry) VALUES (?, ?)
         ON CONFLICT(email_ref) DO NOTHING`,
      )
      .run(entry.emailRef, JSON.stringify(entry));
  }

  has(emailRef: string): boolean {
    return (
      this.db.prepare('SELECT 1 FROM waitlist WHERE email_ref = ?').get(emailRef) !== undefined
    );
  }

  count(): number {
    const row = this.db.prepare('SELECT COUNT(*) AS n FROM waitlist').get() as { n: number };
    return row.n;
  }

  recent(limit: number): WaitlistEntry[] {
    // rowid increases on insert, so DESC is insertion-recency order.
    const rows = this.db
      .prepare('SELECT entry FROM waitlist ORDER BY rowid DESC LIMIT ?')
      .all(limit) as Array<{ entry: string }>;
    return rows.map((r) => JSON.parse(r.entry) as WaitlistEntry);
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
