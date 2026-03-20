import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { initializeSchema } from '../src/db/schema.js';

// We test the context-manager directly since tool handlers are thin wrappers
import {
  saveContext,
  getContext,
  searchContexts,
  listContexts,
  deleteContext,
  getStatus,
} from '../src/services/context-manager.js';

let tmpDir: string;
let dbPath: string;
let db: Database.Database;

// Mock getDatabase to use test DB
vi.mock('../src/db/client.js', () => {
  return {
    getDatabase: () => db,
  };
});

// Mock DB_PATH for getStatus file size check
vi.mock('../src/constants.js', async () => {
  const actual = await vi.importActual('../src/constants.js');
  return {
    ...actual,
    get DB_PATH() {
      return dbPath;
    },
  };
});

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'acheron-tools-test-'));
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

describe('saveContext', () => {
  it('saves and returns a context entry', () => {
    const entry = saveContext({
      content: 'Use React for frontend',
      type: 'decision',
      source_surface: 'chat',
      project: 'my-project',
      tags: ['frontend', 'react'],
    });

    expect(entry.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    expect(entry.content).toBe('Use React for frontend');
    expect(entry.type).toBe('decision');
    expect(entry.source_surface).toBe('chat');
    expect(entry.project).toBe('my-project');
    expect(entry.tags).toEqual(['frontend', 'react']);
    expect(entry.created_at).toBeTruthy();
    expect(entry.updated_at).toBe(entry.created_at);
  });

  it('saves with null project', () => {
    const entry = saveContext({
      content: 'General note',
      type: 'note',
      source_surface: 'cowork',
      tags: [],
    });

    expect(entry.project).toBeNull();
  });

  it('trims content and tags', () => {
    const entry = saveContext({
      content: '  trimmed content  ',
      type: 'note',
      source_surface: 'chat',
      tags: ['  tag1  '],
    });

    expect(entry.content).toBe('trimmed content');
    expect(entry.tags).toEqual(['tag1']);
  });

  it('rejects null bytes in content', () => {
    expect(() => {
      saveContext({
        content: 'hello\0world',
        type: 'note',
        source_surface: 'chat',
        tags: [],
      });
    }).toThrow('null bytes');
  });

  it('rejects empty content after trim', () => {
    expect(() => {
      saveContext({
        content: '   ',
        type: 'note',
        source_surface: 'chat',
        tags: [],
      });
    }).toThrow('empty');
  });

  it('rejects null bytes in tags', () => {
    expect(() => {
      saveContext({
        content: 'valid',
        type: 'note',
        source_surface: 'chat',
        tags: ['good', 'bad\0tag'],
      });
    }).toThrow('null bytes');
  });
});

describe('getContext', () => {
  it('retrieves a saved context by ID', () => {
    const saved = saveContext({
      content: 'Test content',
      type: 'insight',
      source_surface: 'code',
      tags: ['test'],
    });

    const retrieved = getContext(saved.id);
    expect(retrieved).not.toBeNull();
    expect(retrieved!.id).toBe(saved.id);
    expect(retrieved!.content).toBe(saved.content);
    expect(retrieved!.tags).toEqual(saved.tags);
  });

  it('returns null for non-existent ID', () => {
    const result = getContext('00000000-0000-4000-8000-000000000000');
    expect(result).toBeNull();
  });
});

describe('searchContexts', () => {
  beforeEach(() => {
    saveContext({ content: 'React hooks for state management', type: 'insight', source_surface: 'code', tags: ['react'] });
    saveContext({ content: 'Vue composition API patterns', type: 'insight', source_surface: 'chat', tags: ['vue'] });
    saveContext({ content: 'React testing best practices', type: 'note', source_surface: 'code', tags: ['react', 'testing'] });
  });

  it('finds contexts matching query', () => {
    const result = searchContexts(
      { query: 'React' },
      { limit: 10, offset: 0 }
    );
    expect(result.total).toBe(2);
    expect(result.items.length).toBe(2);
  });

  it('filters by source_surface', () => {
    const result = searchContexts(
      { query: 'React', source_surface: 'code' },
      { limit: 10, offset: 0 }
    );
    expect(result.total).toBe(2);
    expect(result.items.every((i) => i.source_surface === 'code')).toBe(true);
  });

  it('filters by type', () => {
    const result = searchContexts(
      { query: 'React', type: 'note' },
      { limit: 10, offset: 0 }
    );
    expect(result.total).toBe(1);
    expect(result.items[0].type).toBe('note');
  });

  it('paginates results', () => {
    const page1 = searchContexts(
      { query: 'React' },
      { limit: 1, offset: 0 }
    );
    expect(page1.items.length).toBe(1);
    expect(page1.has_more).toBe(true);
    expect(page1.next_offset).toBe(1);

    const page2 = searchContexts(
      { query: 'React' },
      { limit: 1, offset: 1 }
    );
    expect(page2.items.length).toBe(1);
    expect(page2.has_more).toBe(false);
  });

  it('returns empty for no matches', () => {
    const result = searchContexts(
      { query: 'nonexistent' },
      { limit: 10, offset: 0 }
    );
    expect(result.total).toBe(0);
    expect(result.items).toEqual([]);
  });
});

describe('listContexts', () => {
  beforeEach(() => {
    saveContext({ content: 'Chat decision', type: 'decision', source_surface: 'chat', project: 'alpha', tags: ['arch'] });
    saveContext({ content: 'Code insight', type: 'insight', source_surface: 'code', project: 'alpha', tags: ['perf'] });
    saveContext({ content: 'Cowork note', type: 'note', source_surface: 'cowork', project: 'beta', tags: ['arch'] });
  });

  it('lists all contexts without filters', () => {
    const result = listContexts({}, { limit: 20, offset: 0 });
    expect(result.total).toBe(3);
    expect(result.items.length).toBe(3);
  });

  it('filters by project', () => {
    const result = listContexts({ project: 'alpha' }, { limit: 20, offset: 0 });
    expect(result.total).toBe(2);
    expect(result.items.every((i) => i.project === 'alpha')).toBe(true);
  });

  it('filters by surface', () => {
    const result = listContexts({ source_surface: 'chat' }, { limit: 20, offset: 0 });
    expect(result.total).toBe(1);
    expect(result.items[0].source_surface).toBe('chat');
  });

  it('filters by type', () => {
    const result = listContexts({ type: 'insight' }, { limit: 20, offset: 0 });
    expect(result.total).toBe(1);
    expect(result.items[0].type).toBe('insight');
  });

  it('filters by tags (AND logic)', () => {
    const result = listContexts({ tags: ['arch'] }, { limit: 20, offset: 0 });
    expect(result.total).toBe(2);
  });

  it('filters by since date', () => {
    const result = listContexts({ since: '2020-01-01T00:00:00Z' }, { limit: 20, offset: 0 });
    expect(result.total).toBe(3);

    const futureResult = listContexts({ since: '2099-01-01T00:00:00Z' }, { limit: 20, offset: 0 });
    expect(futureResult.total).toBe(0);
  });

  it('rejects invalid since date', () => {
    expect(() => {
      listContexts({ since: 'not-a-date' }, { limit: 20, offset: 0 });
    }).toThrow('Invalid ISO 8601');
  });

  it('combines multiple filters', () => {
    const result = listContexts(
      { project: 'alpha', type: 'decision' },
      { limit: 20, offset: 0 }
    );
    expect(result.total).toBe(1);
    expect(result.items[0].content).toBe('Chat decision');
  });

  it('paginates correctly', () => {
    const page1 = listContexts({}, { limit: 2, offset: 0 });
    expect(page1.items.length).toBe(2);
    expect(page1.has_more).toBe(true);

    const page2 = listContexts({}, { limit: 2, offset: 2 });
    expect(page2.items.length).toBe(1);
    expect(page2.has_more).toBe(false);
  });

  it('returns empty result for empty DB', () => {
    db.exec('DELETE FROM contexts');
    const result = listContexts({}, { limit: 20, offset: 0 });
    expect(result.total).toBe(0);
    expect(result.items).toEqual([]);
    expect(result.has_more).toBe(false);
  });
});

describe('deleteContext', () => {
  it('deletes an existing context', () => {
    const entry = saveContext({ content: 'To delete', type: 'note', source_surface: 'chat', tags: [] });
    expect(deleteContext(entry.id)).toBe(true);
    expect(getContext(entry.id)).toBeNull();
  });

  it('returns false for non-existent ID', () => {
    expect(deleteContext('00000000-0000-4000-8000-000000000000')).toBe(false);
  });

  it('removes entry from FTS index', () => {
    const entry = saveContext({ content: 'Searchable unique term xylophone', type: 'note', source_surface: 'chat', tags: [] });
    deleteContext(entry.id);

    const result = searchContexts({ query: 'xylophone' }, { limit: 10, offset: 0 });
    expect(result.total).toBe(0);
  });
});

describe('getStatus', () => {
  it('returns zeroes for empty database', () => {
    const status = getStatus();
    expect(status.total_contexts).toBe(0);
    expect(status.by_surface.chat).toBe(0);
    expect(status.by_surface.code).toBe(0);
    expect(status.by_surface.cowork).toBe(0);
    expect(status.oldest_entry).toBeNull();
    expect(status.newest_entry).toBeNull();
  });

  it('returns accurate counts', () => {
    saveContext({ content: 'A', type: 'decision', source_surface: 'chat', tags: [] });
    saveContext({ content: 'B', type: 'insight', source_surface: 'code', tags: [] });
    saveContext({ content: 'C', type: 'note', source_surface: 'cowork', tags: [] });

    const status = getStatus();
    expect(status.total_contexts).toBe(3);
    expect(status.by_surface.chat).toBe(1);
    expect(status.by_surface.code).toBe(1);
    expect(status.by_surface.cowork).toBe(1);
    expect(status.by_type.decision).toBe(1);
    expect(status.by_type.insight).toBe(1);
    expect(status.by_type.note).toBe(1);
    expect(status.oldest_entry).toBeTruthy();
    expect(status.newest_entry).toBeTruthy();
    expect(status.db_size_bytes).toBeGreaterThan(0);
  });
});

describe('SQL injection resistance', () => {
  it('handles SQL injection in content', () => {
    const entry = saveContext({
      content: "'; DROP TABLE contexts; --",
      type: 'note',
      source_surface: 'chat',
      tags: [],
    });

    // Table still exists and entry was saved
    const retrieved = getContext(entry.id);
    expect(retrieved).not.toBeNull();
    expect(retrieved!.content).toBe("'; DROP TABLE contexts; --");

    // Verify table is intact
    const count = db.prepare('SELECT COUNT(*) as c FROM contexts').get() as { c: number };
    expect(count.c).toBeGreaterThan(0);
  });

  it('handles SQL injection in tags', () => {
    const entry = saveContext({
      content: 'Test',
      type: 'note',
      source_surface: 'chat',
      tags: ["'; DROP TABLE contexts; --"],
    });
    expect(entry.tags).toEqual(["'; DROP TABLE contexts; --"]);
  });

  it('handles SQL injection in project name', () => {
    const entry = saveContext({
      content: 'Test',
      type: 'note',
      source_surface: 'chat',
      project: "'; DROP TABLE contexts; --",
      tags: [],
    });
    expect(entry.project).toBe("'; DROP TABLE contexts; --");
  });

  it('handles SQL injection in search query', () => {
    saveContext({ content: 'Normal content', type: 'note', source_surface: 'chat', tags: [] });
    // This should not crash — FTS MATCH is parameterized
    expect(() => {
      searchContexts(
        { query: "'; DROP TABLE contexts; --" },
        { limit: 10, offset: 0 }
      );
    }).not.toThrow();
  });
});
