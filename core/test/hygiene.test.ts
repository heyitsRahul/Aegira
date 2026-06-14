import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Static checks that encode CLAUDE.md invariants directly against the
 * source tree, so violations fail CI even if no behavioral test catches
 * them.
 */

const ROOT = join(__dirname, '..');

function listFiles(dir: string, suffix: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...listFiles(full, suffix));
    } else if (entry.name.endsWith(suffix)) {
      out.push(full);
    }
  }
  return out;
}

describe('migrations declare retention classes (invariant 8)', () => {
  const migrationFiles = listFiles(join(ROOT, 'migrations'), '.sql');

  it('there are migrations to check', () => {
    expect(migrationFiles.length).toBeGreaterThan(0);
  });

  for (const file of listFiles(join(ROOT, 'migrations'), '.sql')) {
    it(`${file.split('/').pop()} declares a retention class for its tables`, () => {
      const sql = readFileSync(file, 'utf8');
      if (/CREATE TABLE/i.test(sql)) {
        expect(sql).toMatch(/--\s*retention_class:\s*(durable|incident-scoped|ephemeral)/);
      }
    });
  }

  it('location tables bind every row to a session (invariant 1)', () => {
    const sql = readFileSync(join(ROOT, 'migrations', '0003_create_location_pings.sql'), 'utf8');
    expect(sql).toMatch(/session_id\s+UUID\s+NOT NULL/);
    expect(sql).not.toMatch(/\b(lat|lng|latitude|longitude)\b\s+(DOUBLE|NUMERIC|REAL|FLOAT)/i);
  });
});

describe('domain layer purity', () => {
  const domainFiles = listFiles(join(ROOT, 'src', 'domain'), '.ts');

  it('domain imports nothing but its own modules and node builtins', () => {
    for (const file of domainFiles) {
      const source = readFileSync(file, 'utf8');
      const imports = [...source.matchAll(/from '([^']+)'/g)].map((m) => m[1]);
      for (const spec of imports) {
        expect(
          spec.startsWith('./') || spec.startsWith('../') || spec.startsWith('node:'),
          `${file} imports forbidden module ${spec}`,
        ).toBe(true);
      }
    }
  });
});

describe('time is always injected', () => {
  it('no wall-clock reads in domain/ or services/', () => {
    const files = [
      ...listFiles(join(ROOT, 'src', 'domain'), '.ts'),
      ...listFiles(join(ROOT, 'src', 'services'), '.ts'),
    ];
    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      expect(source.includes('Date.now('), `${file} calls Date.now()`).toBe(false);
      expect(/new Date\(\)/.test(source), `${file} calls new Date() with no args`).toBe(false);
    }
  });
});

describe('strict typing in domain and services', () => {
  it('no `any` escapes', () => {
    const files = [
      ...listFiles(join(ROOT, 'src', 'domain'), '.ts'),
      ...listFiles(join(ROOT, 'src', 'services'), '.ts'),
    ];
    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      expect(/:\s*any\b|as any\b|<any>/.test(source), `${file} uses any`).toBe(false);
    }
  });
});

describe('no public incident feed (invariant 5)', () => {
  it('the API exposes no route that lists or searches incidents', () => {
    for (const file of listFiles(join(ROOT, 'src', 'api'), '.ts')) {
      const source = readFileSync(file, 'utf8');
      // Targets the actual invariant-5 risk: a listing of incidents/sessions
      // by area or recency. "recent <waitlist signups>" is fine; "nearby",
      // "incident", "heatmap", a "/feed" route, or "recent incident/session/
      // alert" are not.
      expect(
        /nearby|incident|heatmap|\/feed|recent\s*(incident|session|alert)/i.test(source),
        `${file} smells like an incident feed`,
      ).toBe(false);
    }
  });

  it('the only GET routes are session-scoped by id', () => {
    const controller = readFileSync(join(ROOT, 'src', 'api', 'session.controller.ts'), 'utf8');
    const gets = [...controller.matchAll(/@Get\(([^)]*)\)/g)].map((m) => m[1]);
    expect(gets.length).toBeGreaterThan(0);
    for (const route of gets) {
      expect(route, `GET ${route || '(root)'} is not scoped to a session id`).toContain(':id');
    }
  });
});
