import type Database from 'better-sqlite3';
import { SCHEMA_VERSION } from '../constants.js';

const CREATE_SCHEMA_VERSION = `
CREATE TABLE IF NOT EXISTS schema_version (
  version INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL
)`;

const CREATE_CONTEXTS = `
CREATE TABLE IF NOT EXISTS contexts (
  id TEXT PRIMARY KEY,
  content TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN (
    'decision', 'preference', 'insight',
    'file_ref', 'workflow', 'note'
  )),
  source_surface TEXT NOT NULL CHECK(source_surface IN (
    'chat', 'code', 'cowork'
  )),
  project TEXT,
  tags TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
)`;

const CREATE_FTS = `
CREATE VIRTUAL TABLE IF NOT EXISTS contexts_fts USING fts5(
  content,
  tags,
  project,
  content=contexts,
  content_rowid=rowid
)`;

const CREATE_TRIGGER_INSERT = `
CREATE TRIGGER IF NOT EXISTS contexts_after_insert
AFTER INSERT ON contexts BEGIN
  INSERT INTO contexts_fts(rowid, content, tags, project)
  VALUES (new.rowid, new.content, new.tags, new.project);
END`;

const CREATE_TRIGGER_DELETE = `
CREATE TRIGGER IF NOT EXISTS contexts_after_delete
AFTER DELETE ON contexts BEGIN
  INSERT INTO contexts_fts(contexts_fts, rowid, content, tags, project)
  VALUES ('delete', old.rowid, old.content, old.tags, old.project);
END`;

const CREATE_TRIGGER_UPDATE = `
CREATE TRIGGER IF NOT EXISTS contexts_after_update
AFTER UPDATE ON contexts BEGIN
  INSERT INTO contexts_fts(contexts_fts, rowid, content, tags, project)
  VALUES ('delete', old.rowid, old.content, old.tags, old.project);
  INSERT INTO contexts_fts(rowid, content, tags, project)
  VALUES (new.rowid, new.content, new.tags, new.project);
END`;

const CREATE_INDEXES = [
  'CREATE INDEX IF NOT EXISTS idx_contexts_project ON contexts(project)',
  'CREATE INDEX IF NOT EXISTS idx_contexts_type ON contexts(type)',
  'CREATE INDEX IF NOT EXISTS idx_contexts_surface ON contexts(source_surface)',
  'CREATE INDEX IF NOT EXISTS idx_contexts_created ON contexts(created_at DESC)',
];

export function initializeSchema(db: Database.Database): void {
  db.exec(CREATE_SCHEMA_VERSION);
  db.exec(CREATE_CONTEXTS);
  db.exec(CREATE_FTS);
  db.exec(CREATE_TRIGGER_INSERT);
  db.exec(CREATE_TRIGGER_DELETE);
  db.exec(CREATE_TRIGGER_UPDATE);
  for (const sql of CREATE_INDEXES) {
    db.exec(sql);
  }
  runMigrations(db);
}

function runMigrations(db: Database.Database): void {
  const row = db.prepare(
    'SELECT MAX(version) as version FROM schema_version'
  ).get() as { version: number | null } | undefined;

  const currentVersion = row?.version ?? 0;

  if (currentVersion < SCHEMA_VERSION) {
    db.prepare(
      'INSERT OR REPLACE INTO schema_version (version, applied_at) VALUES (?, ?)'
    ).run(SCHEMA_VERSION, new Date().toISOString());
  }
}
