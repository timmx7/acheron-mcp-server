import path from 'node:path';
import os from 'node:os';

export const DB_DIR = path.join(os.homedir(), '.acheron');
export const DB_PATH = path.join(DB_DIR, 'bridge.db');
export const MAX_CONTENT_LENGTH = 10_000;
export const MAX_TAG_LENGTH = 50;
export const MAX_TAGS = 20;
export const MAX_PROJECT_LENGTH = 200;
export const MAX_SEARCH_QUERY_LENGTH = 500;
export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 50;
export const SERVER_NAME = 'acheron-mcp-server';
export const SERVER_VERSION = '1.0.0';
export const SCHEMA_VERSION = 1;
