# ARCHITECTURE.md — Acheron MCP Server

## System overview

```
┌─────────────────────────────────────────────────────────────────┐
│                     Claude Desktop App                          │
│                                                                 │
│  ┌──────────┐    ┌──────────────┐    ┌───────────────┐         │
│  │   Chat   │    │    Code      │    │    Cowork     │         │
│  │  (web/   │    │  (terminal/  │    │  (desktop VM/ │         │
│  │  mobile) │    │   VS Code)   │    │   sandbox)    │         │
│  └────┬─────┘    └──────┬───────┘    └──────┬────────┘         │
│       │                 │                    │                   │
│       └────────────┬────┴────────────────────┘                  │
│                    │                                             │
│            ┌───────▼──────────┐                                 │
│            │  MCP Protocol    │  (JSON-RPC over stdio)          │
│            └───────┬──────────┘                                 │
└────────────────────┼────────────────────────────────────────────┘
                     │
         ┌───────────▼──────────────┐
         │  Acheron MCP      │
         │  Server                  │
         │                          │
         │  ┌────────────────────┐  │
         │  │  Security Layer    │  │
         │  │  (Zod validation,  │  │
         │  │   sanitization)    │  │
         │  └────────┬───────────┘  │
         │           │              │
         │  ┌────────▼───────────┐  │
         │  │  Tool Handlers     │  │
         │  │  (6 registered     │  │
         │  │   MCP tools)       │  │
         │  └────────┬───────────┘  │
         │           │              │
         │  ┌────────▼───────────┐  │
         │  │  Context Manager   │  │
         │  │  (business logic)  │  │
         │  └────────┬───────────┘  │
         │           │              │
         │  ┌────────▼───────────┐  │
         │  │  SQLite + FTS5     │  │
         │  │  (prepared stmts   │  │
         │  │   only, WAL mode)  │  │
         │  └────────┬───────────┘  │
         │           │              │
         │  ┌────────▼───────────┐  │
         │  │  ~/.acheron │  │
         │  │  /bridge.db        │  │
         │  │  (0700/0600 perms) │  │
         │  └────────────────────┘  │
         └──────────────────────────┘
```

---

## Technology choices

### TypeScript

- Standard language for MCP server ecosystem
- MCP TypeScript SDK has the most mature feature set (registerTool, Zod, structured output)
- npm is the standard distribution channel for MCP servers
- stdio transport works natively in Node.js
- Strong type system catches bugs at compile time

**TypeScript**: 5.5+ · **Node.js**: 20+ LTS · **Module system**: ESM (`"type": "module"`)

### SQLite via better-sqlite3

| Option | Full-text search | Zero config | Single file | Speed | Verdict |
|--------|-----------------|-------------|-------------|-------|---------|
| Markdown files | No | Yes | No | Slow at scale | ❌ |
| JSON file | No | Yes | Yes | Slow at scale | ❌ |
| LevelDB | No | Yes | Yes | Fast key-value | ❌ |
| **SQLite + FTS5** | **Yes (native)** | **Yes** | **Yes** | **Sub-ms queries** | **✅** |
| PostgreSQL | Yes | No (server) | No | Fast | ❌ Overkill |

**Key features used**:
- **FTS5**: Full-text search with ranking (BM25) for semantic keyword queries
- **WAL mode**: Safe concurrent reads from multiple Claude surfaces
- **Prepared statements**: SQL injection impossible by design
- **Single file**: `~/.acheron/bridge.db` — easy to backup, inspect, delete

**better-sqlite3** chosen over alternatives:
- Synchronous API — simpler, no callback/promise complexity for a local tool
- Native C binding — production-grade performance
- No external server — zero-config
- Wide adoption (4k+ GitHub stars, actively maintained)

**Cowork sandbox compatibility**: The MCP server runs as a host-level process spawned by Claude Desktop, NOT inside the Cowork sandbox VM. The DB file at `~/.acheron/` is fully accessible. All reads and writes work from all surfaces including Cowork.

### stdio transport

- Runs as a local child process of Claude Desktop
- No TCP ports, no HTTP server, no TLS certificates, no authentication tokens
- Attack surface: zero (no network listener)
- Stdout reserved for MCP JSON-RPC, stderr for logging

---

## Database schema

```sql
-- Enable WAL mode for concurrent read safety
PRAGMA journal_mode=WAL;
PRAGMA busy_timeout=5000;
PRAGMA foreign_keys=ON;

-- Schema version tracking for migrations
CREATE TABLE IF NOT EXISTS schema_version (
  version INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL
);

-- Main contexts table
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
);

-- Full-text search virtual table (FTS5 with BM25 ranking)
CREATE VIRTUAL TABLE IF NOT EXISTS contexts_fts USING fts5(
  content,
  tags,
  project,
  content=contexts,
  content_rowid=rowid
);

-- Triggers to keep FTS index synchronized with main table
CREATE TRIGGER IF NOT EXISTS contexts_after_insert
AFTER INSERT ON contexts BEGIN
  INSERT INTO contexts_fts(rowid, content, tags, project)
  VALUES (new.rowid, new.content, new.tags, new.project);
END;

CREATE TRIGGER IF NOT EXISTS contexts_after_delete
AFTER DELETE ON contexts BEGIN
  INSERT INTO contexts_fts(contexts_fts, rowid, content, tags, project)
  VALUES ('delete', old.rowid, old.content, old.tags, old.project);
END;

CREATE TRIGGER IF NOT EXISTS contexts_after_update
AFTER UPDATE ON contexts BEGIN
  INSERT INTO contexts_fts(contexts_fts, rowid, content, tags, project)
  VALUES ('delete', old.rowid, old.content, old.tags, old.project);
  INSERT INTO contexts_fts(rowid, content, tags, project)
  VALUES (new.rowid, new.content, new.tags, new.project);
END;

-- Performance indexes
CREATE INDEX IF NOT EXISTS idx_contexts_project ON contexts(project);
CREATE INDEX IF NOT EXISTS idx_contexts_type ON contexts(type);
CREATE INDEX IF NOT EXISTS idx_contexts_surface ON contexts(source_surface);
CREATE INDEX IF NOT EXISTS idx_contexts_created ON contexts(created_at DESC);
```

---

## Tool specifications

### 1. bridge_save_context

**Input schema**:
```typescript
z.object({
  content: z.string()
    .min(1, "Content cannot be empty")
    .max(10000, "Content must not exceed 10,000 characters")
    .describe("The context to save: a decision, preference, insight, file reference, workflow, or note"),
  type: z.enum(['decision', 'preference', 'insight', 'file_ref', 'workflow', 'note'])
    .describe("Context type. decision=architectural/business choice. preference=user style/setting. insight=learned fact. file_ref=important file reference. workflow=process description. note=general."),
  source_surface: z.enum(['chat', 'code', 'cowork'])
    .describe("Which Claude surface this context originates from"),
  project: z.string().max(200).optional()
    .describe("Optional project name to scope this context. Use consistent names across surfaces."),
  tags: z.array(z.string().max(50)).max(20).default([])
    .describe("Optional tags for filtering. Example: ['frontend', 'react', 'auth']")
}).strict()
```

**Behavior**: Generate UUID v4 server-side. Set created_at and updated_at to current ISO 8601. Insert via prepared statement. Return created entry.

**Annotations**: `readOnlyHint: false`, `destructiveHint: false`, `idempotentHint: false`, `openWorldHint: false`

---

### 2. bridge_get_context

**Input schema**:
```typescript
z.object({
  id: z.string().uuid("Must be a valid UUID v4"),
  response_format: z.enum(['json', 'markdown']).default('markdown')
}).strict()
```

**Behavior**: SELECT by ID using prepared statement. Return 404-style error if not found.

**Annotations**: `readOnlyHint: true`, `destructiveHint: false`, `idempotentHint: true`, `openWorldHint: false`

---

### 3. bridge_search_context

**Input schema**:
```typescript
z.object({
  query: z.string().min(1).max(500)
    .describe("FTS5 search query. Supports: phrases in quotes, AND/OR/NOT operators. Example: '\"react hooks\" AND auth'"),
  project: z.string().max(200).optional(),
  source_surface: z.enum(['chat', 'code', 'cowork']).optional(),
  type: z.enum(['decision', 'preference', 'insight', 'file_ref', 'workflow', 'note']).optional(),
  limit: z.number().int().min(1).max(50).default(10),
  offset: z.number().int().min(0).default(0),
  response_format: z.enum(['json', 'markdown']).default('markdown')
}).strict()
```

**Behavior**: Sanitize FTS5 query input (escape dangerous patterns, strip null bytes). Execute MATCH query with BM25 ranking via prepared statement. Apply additional WHERE filters on joined main table. Return paginated results.

**FTS5 query sanitization** (in `src/utils/security.ts`):
```typescript
function sanitizeFtsQuery(raw: string): string {
  // 1. Strip null bytes and control characters
  let sanitized = raw.replace(/[\x00-\x1f\x7f]/g, '');
  // 2. Escape unbalanced quotes
  const quoteCount = (sanitized.match(/"/g) || []).length;
  if (quoteCount % 2 !== 0) {
    sanitized = sanitized.replace(/"/g, '');
  }
  // 3. Remove standalone special operators that could cause FTS5 syntax errors
  // Keep them only when used between terms (e.g., "react AND auth")
  sanitized = sanitized.trim();
  if (!sanitized) return '""'; // empty query returns nothing safely
  return sanitized;
}
```

**Annotations**: `readOnlyHint: true`, `destructiveHint: false`, `idempotentHint: true`, `openWorldHint: false`

---

### 4. bridge_list_contexts

**Input schema**:
```typescript
z.object({
  project: z.string().max(200).optional(),
  source_surface: z.enum(['chat', 'code', 'cowork']).optional(),
  type: z.enum(['decision', 'preference', 'insight', 'file_ref', 'workflow', 'note']).optional(),
  tags: z.array(z.string()).optional()
    .describe("Filter: entries must contain ALL specified tags"),
  since: z.string().optional()
    .describe("ISO 8601 datetime. Return entries created after this date."),
  limit: z.number().int().min(1).max(50).default(20),
  offset: z.number().int().min(0).default(0),
  response_format: z.enum(['json', 'markdown']).default('markdown')
}).strict()
```

**Behavior**: Build WHERE clause dynamically using prepared statement parameter binding (never string concatenation). Tags filter uses JSON `json_each()` with INTERSECT logic. Validate `since` as ISO 8601 if provided. Return paginated results ordered by created_at DESC.

**Annotations**: `readOnlyHint: true`, `destructiveHint: false`, `idempotentHint: true`, `openWorldHint: false`

---

### 5. bridge_delete_context

**Input schema**:
```typescript
z.object({
  id: z.string().uuid("Must be a valid UUID v4")
}).strict()
```

**Behavior**: DELETE by ID via prepared statement. FTS index updated automatically via trigger. Return success or not-found.

**Annotations**: `readOnlyHint: false`, `destructiveHint: true`, `idempotentHint: true`, `openWorldHint: false`

---

### 6. bridge_status

**Input schema**:
```typescript
z.object({
  response_format: z.enum(['json', 'markdown']).default('markdown')
}).strict()
```

**Behavior**: Run aggregate queries — COUNT by surface, COUNT by type, total count, DB file size (fs.statSync), oldest entry date, newest entry date. Return formatted stats.

**Annotations**: `readOnlyHint: true`, `destructiveHint: false`, `idempotentHint: true`, `openWorldHint: false`

---

## Data flow examples

### Scenario 1: Chat decision → Cowork applies it

```
[Chat]  User discusses tech stack
        → bridge_save_context(content="Use Next.js 15 App Router", type="decision",
          source_surface="chat", project="acme-site", tags=["frontend","nextjs"])

[Cowork] User asks to scaffold the project
         → bridge_list_contexts(project="acme-site")
         → Retrieves Next.js decision
         → Creates files accordingly
```

### Scenario 2: Code insight → Chat references it

```
[Code]  Developer fixes a Stripe webhook bug
        → bridge_save_context(content="Stripe webhook clock skew tolerance increased to 600s",
          type="insight", source_surface="code", project="payments", tags=["stripe","bugfix"])

[Chat]  User asks "what bugs did we fix this week?"
        → bridge_search_context(query="bugfix", since="2026-03-12T00:00:00Z")
        → Returns the Stripe insight from Code
```

### Scenario 3: Preferences saved once, used everywhere

```
[Chat]  → bridge_save_context(content="Prefers French informal, English technical. Metric units. CET timezone.",
          type="preference", source_surface="chat", tags=["language","format"])

[Any]   → bridge_search_context(query="preference language")
        → Retrieved and applied regardless of surface
```

---

## Implementation plan — file by file

### src/constants.ts
```typescript
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
export const CHARACTER_LIMIT = 50_000;
export const SERVER_NAME = 'acheron-mcp-server';
export const SERVER_VERSION = '1.0.0';
export const SCHEMA_VERSION = 1;
```

### src/types.ts
```typescript
export type ContextType = 'decision' | 'preference' | 'insight' | 'file_ref' | 'workflow' | 'note';
export type Surface = 'chat' | 'code' | 'cowork';

export interface ContextEntry {
  id: string;
  content: string;
  type: ContextType;
  source_surface: Surface;
  project: string | null;
  tags: string[];
  created_at: string;
  updated_at: string;
}

export interface ContextFilter {
  project?: string;
  source_surface?: Surface;
  type?: ContextType;
  tags?: string[];
  since?: string;
}

export interface PaginationParams {
  limit: number;
  offset: number;
}

export interface PaginatedResult<T> {
  total: number;
  count: number;
  offset: number;
  items: T[];
  has_more: boolean;
  next_offset?: number;
}

export interface BridgeStatus {
  total_contexts: number;
  by_surface: Record<Surface, number>;
  by_type: Record<ContextType, number>;
  db_size_bytes: number;
  oldest_entry: string | null;
  newest_entry: string | null;
}
```

### src/db/client.ts
- `getDatabase()`: check if `DB_DIR` exists, create with `mkdirSync(DB_DIR, { mode: 0o700 })` if not. Open DB with better-sqlite3. Set WAL mode, busy_timeout. Run schema init. Return singleton instance.
- `closeDatabase()`: close DB handle, called on SIGINT/SIGTERM.
- On DB open, verify file permissions. If wrong, log warning to stderr.

### src/db/schema.ts
- `initializeSchema(db: Database)`: run CREATE TABLE, CREATE VIRTUAL TABLE, CREATE TRIGGER, CREATE INDEX statements.
- `runMigrations(db: Database)`: check `schema_version` table. Apply incremental migrations if needed. Insert version record.
- All SQL in this file as string constants — no dynamic construction.

### src/services/context-manager.ts
- `saveContext(input)`: validate via Zod, generate UUID, set timestamps, INSERT via prepared statement, return entry.
- `getContext(id)`: validate UUID, SELECT via prepared statement, return entry or null.
- `searchContexts(query, filters, pagination)`: sanitize FTS query, build MATCH query with JOINs and WHERE filters using parameter binding, execute, return paginated results.
- `listContexts(filters, pagination)`: build WHERE dynamically with parameter array (never concat), execute, return paginated results.
- `deleteContext(id)`: validate UUID, DELETE via prepared statement, return boolean.
- `getStatus()`: aggregate queries (COUNT, GROUP BY), stat DB file, return BridgeStatus.

### src/utils/security.ts
- `sanitizeFtsQuery(raw: string): string` — clean FTS5 input
- `sanitizeString(raw: string): string` — strip null bytes, control chars, trim
- `validateIsoDate(raw: string): boolean` — strict ISO 8601 validation
- `ensureDirectoryPermissions(dir: string): void` — verify/set 0700

### src/utils/format.ts
- `formatContextMarkdown(entry: ContextEntry): string`
- `formatContextListMarkdown(result: PaginatedResult<ContextEntry>): string`
- `formatStatusMarkdown(status: BridgeStatus): string`
- `formatContextJson(entry: ContextEntry): string`

### src/utils/errors.ts
- `createToolError(message: string, suggestion?: string): ToolResponse`
- `handleDatabaseError(error: unknown): ToolResponse`
- `isNotFoundError(error: unknown): boolean`

### src/index.ts
- Import McpServer, StdioServerTransport
- Initialize DB via `getDatabase()`
- Import and call register functions from each `tools/*.ts`
- Connect server to transport
- Register SIGINT/SIGTERM handlers to close DB gracefully
- Add `#!/usr/bin/env node` shebang for npx execution

### Each src/tools/*.ts
- Export `function registerTool(server: McpServer): void`
- Define Zod input schema
- Call `server.registerTool()` with name, metadata, schema, annotations, handler
- Handler: validate input → call context-manager → format response → return

---

## package.json

```json
{
  "name": "acheron-mcp-server",
  "version": "1.0.0",
  "description": "MCP server bridging context between Claude Chat, Code, and Cowork",
  "author": "timmx7",
  "license": "MIT",
  "type": "module",
  "main": "dist/index.js",
  "bin": {
    "acheron-mcp-server": "dist/index.js"
  },
  "files": ["dist/", "README.md", "LICENSE", "SECURITY.md"],
  "scripts": {
    "build": "tsc",
    "start": "node dist/index.js",
    "dev": "tsc --watch",
    "test": "vitest run",
    "lint": "eslint src/",
    "prepack": "npm run build && npm run lint && npm audit"
  },
  "keywords": ["mcp", "claude", "context", "memory", "cowork", "claude-code", "ai-agent", "anthropic"],
  "engines": { "node": ">=20.0.0" },
  "repository": {
    "type": "git",
    "url": "https://github.com/timmx7/acheron-mcp-server.git"
  }
}
```

### Dependencies
```json
{
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.12.0",
    "better-sqlite3": "^11.0.0",
    "uuid": "^11.0.0",
    "zod": "^3.24.0"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.0",
    "@types/node": "^22.0.0",
    "@types/uuid": "^10.0.0",
    "typescript": "^5.5.0",
    "vitest": "^3.0.0",
    "eslint": "^9.0.0",
    "@typescript-eslint/eslint-plugin": "^8.0.0",
    "@typescript-eslint/parser": "^8.0.0"
  }
}
```

### tsconfig.json
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "tests"]
}
```

---

## Distribution

### Phase 1: Ship
- GitHub: `github.com/timmx7/acheron-mcp-server`
- npm: `acheron-mcp-server`
- Installation: `npx -y acheron-mcp-server`

### Phase 2: Ecosystem integration
- Submit to Claude Code plugin marketplace
- Submit as Cowork plugin via GitHub marketplace
- Post on community forums with demo

### Phase 3: Visibility
- Dev.to article: "I built the missing link between Claude Chat, Code, and Cowork"
- Hacker News, Reddit r/ClaudeAI, X
- Demo video showing cross-surface context flow

---

## Security policy (SECURITY.md content)

```markdown
# Security Policy

## Reporting vulnerabilities
Report security issues to: [timmx7's contact]
Do NOT open public GitHub issues for security vulnerabilities.

## Security model
- Local-only: zero network calls, zero telemetry
- All data stored locally at ~/.acheron/
- Directory permissions: 0700, file permissions: 0600
- All inputs validated via Zod before processing
- SQL injection prevented: prepared statements only
- No dynamic code execution (no eval, no Function)
- Minimal dependencies, audited before every release

## Supported versions
| Version | Supported |
|---------|-----------|
| 1.x     | Yes       |
```

---

## Future extensions (post v1.0, not in initial release)

- **Context expiry**: TTL-based auto-deletion for temporary contexts
- **Import/export**: JSON dump/restore for backup and portability
- **Context linking**: relate entries to each other (parent/child, caused-by)
- **Auto-capture hooks**: optional hooks for Claude Code plugin system
- **Semantic search**: optional embedding-based search via local model (Ollama)
- **Team sync**: optional encrypted sync for Team/Enterprise deployments
- **CLI interface**: `acheron list --project acme` for direct terminal access
