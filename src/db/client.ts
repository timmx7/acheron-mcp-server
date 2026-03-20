import Database from 'better-sqlite3';
import fs from 'node:fs';
import { DB_DIR, DB_PATH } from '../constants.js';
import { initializeSchema } from './schema.js';

let dbInstance: Database.Database | null = null;

function ensureDirectory(): void {
  if (!fs.existsSync(DB_DIR)) {
    fs.mkdirSync(DB_DIR, { recursive: true, mode: 0o700 });
  } else {
    // Verify permissions on existing directory
    try {
      const stats = fs.statSync(DB_DIR);
      const mode = stats.mode & 0o777;
      if (mode !== 0o700) {
        fs.chmodSync(DB_DIR, 0o700);
        console.error(`[acheron] Fixed directory permissions on ${DB_DIR}`);
      }
    } catch {
      console.error(`[acheron] Warning: could not verify directory permissions`);
    }
  }
}

function ensureFilePermissions(): void {
  if (!fs.existsSync(DB_PATH)) {
    return;
  }
  try {
    const stats = fs.statSync(DB_PATH);
    const mode = stats.mode & 0o777;
    if (mode !== 0o600) {
      fs.chmodSync(DB_PATH, 0o600);
      console.error(`[acheron] Fixed file permissions on ${DB_PATH}`);
    }
  } catch {
    console.error(`[acheron] Warning: could not verify file permissions`);
  }
}

export function getDatabase(): Database.Database {
  if (dbInstance) {
    return dbInstance;
  }

  ensureDirectory();

  dbInstance = new Database(DB_PATH);

  // Set file permissions after creation
  ensureFilePermissions();

  // Enable WAL mode for concurrent read safety
  dbInstance.pragma('journal_mode=WAL');
  dbInstance.pragma('busy_timeout=5000');
  dbInstance.pragma('foreign_keys=ON');

  initializeSchema(dbInstance);

  console.error(`[acheron] Database initialized at ${DB_PATH}`);

  return dbInstance;
}

export function closeDatabase(): void {
  if (dbInstance) {
    try {
      dbInstance.close();
      console.error('[acheron] Database connection closed');
    } catch (error: unknown) {
      console.error('[acheron] Error closing database:', error);
    }
    dbInstance = null;
  }
}

export function getDatabaseForTesting(dbPath: string): Database.Database {
  const db = new Database(dbPath);
  db.pragma('journal_mode=WAL');
  db.pragma('busy_timeout=5000');
  db.pragma('foreign_keys=ON');
  initializeSchema(db);
  return db;
}
