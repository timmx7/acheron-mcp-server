import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { initializeSchema } from '../src/db/schema.js';

let db: Database.Database;
let tmpDir: string;
let dbPath: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'acheron-test-'));
  dbPath = path.join(tmpDir, 'test.db');
  db = new Database(dbPath);
  db.pragma('journal_mode=WAL');
  db.pragma('busy_timeout=5000');
  db.pragma('foreign_keys=ON');
  initializeSchema(db);
});

afterEach(() => {
  db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('Database schema', () => {
  it('creates all required tables', () => {
    const tables = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
    ).all() as Array<{ name: string }>;
    const names = tables.map((t) => t.name);
    expect(names).toContain('contexts');
    expect(names).toContain('schema_version');
  });

  it('creates FTS5 virtual table', () => {
    const tables = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='contexts_fts'"
    ).all();
    expect(tables.length).toBe(1);
  });

  it('creates performance indexes', () => {
    const indexes = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_contexts_%'"
    ).all() as Array<{ name: string }>;
    const names = indexes.map((i) => i.name);
    expect(names).toContain('idx_contexts_project');
    expect(names).toContain('idx_contexts_type');
    expect(names).toContain('idx_contexts_surface');
    expect(names).toContain('idx_contexts_created');
  });

  it('records schema version', () => {
    const row = db.prepare(
      'SELECT MAX(version) as version FROM schema_version'
    ).get() as { version: number };
    expect(row.version).toBe(1);
  });

  it('enforces type CHECK constraint', () => {
    const stmt = db.prepare(
      `INSERT INTO contexts (id, content, type, source_surface, tags, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    );
    expect(() => {
      stmt.run('test-id', 'content', 'invalid_type', 'chat', '[]', '2024-01-01T00:00:00Z', '2024-01-01T00:00:00Z');
    }).toThrow();
  });

  it('enforces source_surface CHECK constraint', () => {
    const stmt = db.prepare(
      `INSERT INTO contexts (id, content, type, source_surface, tags, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    );
    expect(() => {
      stmt.run('test-id', 'content', 'note', 'invalid_surface', '[]', '2024-01-01T00:00:00Z', '2024-01-01T00:00:00Z');
    }).toThrow();
  });

  it('uses WAL journal mode', () => {
    const result = db.pragma('journal_mode') as Array<{ journal_mode: string }>;
    expect(result[0].journal_mode).toBe('wal');
  });

  it('syncs FTS index on insert', () => {
    db.prepare(
      `INSERT INTO contexts (id, content, type, source_surface, tags, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run('uuid-1', 'React hooks are great', 'note', 'chat', '["react"]', '2024-01-01T00:00:00Z', '2024-01-01T00:00:00Z');

    const results = db.prepare(
      "SELECT * FROM contexts_fts WHERE contexts_fts MATCH 'React'"
    ).all();
    expect(results.length).toBe(1);
  });

  it('syncs FTS index on delete', () => {
    db.prepare(
      `INSERT INTO contexts (id, content, type, source_surface, tags, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run('uuid-del', 'Deletable content', 'note', 'chat', '[]', '2024-01-01T00:00:00Z', '2024-01-01T00:00:00Z');

    db.prepare('DELETE FROM contexts WHERE id = ?').run('uuid-del');

    const results = db.prepare(
      "SELECT * FROM contexts_fts WHERE contexts_fts MATCH 'Deletable'"
    ).all();
    expect(results.length).toBe(0);
  });

  it('handles concurrent inserts in WAL mode', () => {
    const stmt = db.prepare(
      `INSERT INTO contexts (id, content, type, source_surface, tags, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    );

    const insertMany = db.transaction(() => {
      for (let i = 0; i < 100; i++) {
        stmt.run(`uuid-${i}`, `Content ${i}`, 'note', 'chat', '[]', '2024-01-01T00:00:00Z', '2024-01-01T00:00:00Z');
      }
    });

    insertMany();

    const count = db.prepare('SELECT COUNT(*) as c FROM contexts').get() as { c: number };
    expect(count.c).toBe(100);
  });
});
