# CLAUDE.md — Acheron MCP Server

## Project identity

- **Author**: timmx7
- **Repository**: github.com/timmx7/acheron-mcp-server
- **Package**: acheron-mcp-server (npm)
- **License**: MIT

Git configuration for this project:
```
git config user.name "timmx7"
git config user.email "<tim's email>"
```
No other contributors. All commits must be authored by timmx7 only. Do not add co-author trailers or any other attribution metadata to commits.

---

## What is this project?

Acheron is an MCP (Model Context Protocol) server that solves the biggest structural gap in the Claude ecosystem: **Chat, Code, and Cowork are three separate surfaces with zero shared context between them.**

- Claude Chat has memory about the user but cannot touch files or execute code
- Claude Code has Auto Memory for code projects but knows nothing about Chat conversations or Cowork sessions
- Claude Cowork can act on local files but resets completely every session with no persistent memory at all

Acheron is the missing link. A single MCP server that, once connected, works across all three surfaces. It captures context from any surface and makes it available to all others — a shared persistent brain for all Claude instances.

---

## Why this matters

- Cowork's lack of cross-session memory is the most reported user complaint across community forums, blog posts, and GitHub issues
- Claude Code Auto Memory is siloed to code projects and inaccessible from Cowork or Chat
- Every existing workaround (CLAUDE.md files, context files, Personal Preferences) is manual and fragile
- MCP servers are the only technical mechanism that natively crosses all three Claude surfaces
- No tool currently provides automated cross-surface context persistence

---

## Architecture overview

See ARCHITECTURE.md for the complete technical design. Summary:

- **Language**: TypeScript (standard for the MCP ecosystem)
- **Storage**: SQLite with FTS5 via better-sqlite3 (fast, zero-config, local-first, single file)
- **Transport**: stdio (local process, no network)
- **Security model**: local-only, no network calls, no telemetry, no data exfiltration, prepared statements only, strict input validation, hardened file permissions

---

## Project structure

```
acheron-mcp-server/
├── .gitignore
├── .eslintrc.json
├── CLAUDE.md
├── ARCHITECTURE.md
├── README.md
├── LICENSE
├── SECURITY.md
├── CHANGELOG.md
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts               # Entry point: server init, tool registration, transport, shutdown
│   ├── constants.ts           # All shared constants (paths, limits, version)
│   ├── types.ts               # TypeScript interfaces and type definitions
│   ├── db/
│   │   ├── schema.ts          # SQLite schema, migrations, FTS5 setup
│   │   └── client.ts          # DB singleton: open, init, close, health check
│   ├── tools/
│   │   ├── save.ts            # bridge_save_context
│   │   ├── get.ts             # bridge_get_context
│   │   ├── search.ts          # bridge_search_context
│   │   ├── list.ts            # bridge_list_contexts
│   │   ├── delete.ts          # bridge_delete_context
│   │   └── status.ts          # bridge_status
│   ├── services/
│   │   ├── context-manager.ts # Core CRUD business logic
│   │   └── relevance.ts       # FTS5 rank scoring, deduplication
│   └── utils/
│       ├── format.ts          # Markdown + JSON response formatters
│       ├── errors.ts          # Standardized error handling
│       └── security.ts        # Input sanitization, path validation, size guards
├── tests/
│   ├── tools.test.ts          # Tool-level integration tests
│   ├── db.test.ts             # Database layer tests
│   ├── security.test.ts       # Security-specific tests (injection, overflow, permissions)
│   └── fixtures/
│       └── sample-contexts.json
└── eval/
    └── evaluation.xml         # MCP evaluation questions (10 scenarios)
```

---

## Tools

| Tool | Purpose | Read-only | Destructive |
|------|---------|-----------|-------------|
| `bridge_save_context` | Save a context entry (decision, preference, insight, file ref, workflow, note) | No | No |
| `bridge_get_context` | Retrieve a specific context by ID | Yes | No |
| `bridge_search_context` | Full-text keyword search across all contexts (FTS5) | Yes | No |
| `bridge_list_contexts` | List and filter contexts by project, surface, type, date, tags | Yes | No |
| `bridge_delete_context` | Remove a context entry by ID | No | Yes |
| `bridge_status` | Show statistics: counts per surface/type, DB size, date range | Yes | No |

---

## Context data model

```typescript
interface ContextEntry {
  id: string;              // UUID v4, generated server-side only
  content: string;         // The context content (max 10,000 chars, sanitized)
  type: ContextType;       // 'decision' | 'preference' | 'insight' | 'file_ref' | 'workflow' | 'note'
  source_surface: Surface; // 'chat' | 'code' | 'cowork'
  project?: string;        // Optional project scope (max 200 chars, sanitized)
  tags: string[];          // Tags for filtering (max 20 tags, max 50 chars each, sanitized)
  created_at: string;      // ISO 8601, set server-side (never trust client timestamps)
  updated_at: string;      // ISO 8601, set server-side
}
```

---

## Security requirements — MANDATORY

Every implementation decision must respect these constraints. No exceptions.

### Network isolation
- ZERO outbound network calls. No HTTP requests, no DNS lookups, no telemetry, no analytics, no update checks, no phone-home behavior of any kind.
- The server communicates exclusively via stdio with the parent process.
- Any dependency that attempts network access must be identified and removed.
- Verify with: `strace -e network node dist/index.js` (Linux) or `dtrace` (macOS).

### Data locality
- All data stored at `~/.acheron/bridge.db` on the user's local filesystem.
- DB directory created with permissions `0700` (owner: rwx, group: none, others: none).
- DB file created with permissions `0600` (owner: rw, group: none, others: none).
- On Windows, use user-profile-scoped directory with default ACLs.
- No temporary files outside `~/.acheron/`.
- No data written to stdout (reserved for MCP protocol).

### Input validation — defense in depth
- ALL inputs validated via Zod schemas with `.strict()` before any processing.
- Content: max 10,000 chars, trimmed, reject if empty after trim.
- Tags: max 20 tags, each max 50 chars, trimmed, reject empty strings.
- Project name: max 200 chars, trimmed, reject control characters.
- UUID: validated format before any SELECT or DELETE.
- FTS5 queries: escape special FTS5 operators (`*`, `"`, `NEAR`, `OR`, `AND`, `NOT` used as operators) to prevent FTS5 syntax errors. Strip null bytes and control characters.
- All string inputs: reject null bytes (`\0`), strip leading/trailing whitespace.

### SQL injection prevention
- ONLY prepared statements via better-sqlite3 parameter binding.
- No string concatenation, template literals, or interpolation in any SQL string.
- FTS5 MATCH queries use parameterized input: `WHERE contexts_fts MATCH ?`.

### Error handling
- Internal errors (stack traces, file paths, SQL error details, OS info) are NEVER exposed in tool responses.
- All errors return a sanitized, actionable message to the client.
- Database errors are caught and mapped to user-friendly responses.
- Corrupted/inaccessible DB: return clear error message suggesting manual inspection of `~/.acheron/`.
- Unexpected exceptions: log full details to stderr, return generic "internal error" to client.

### Dependency security
- Minimal dependencies: `@modelcontextprotocol/sdk`, `better-sqlite3`, `uuid`, `zod`.
- No transitive dependencies performing network I/O.
- Lock exact versions via package-lock.json.
- `npm audit` must report zero vulnerabilities before any release.
- Review `node_modules` for unexpected network-capable code if in doubt.

### Content safety
- Stored content is opaque text. Never interpreted, executed, evaluated, or rendered as code/HTML.
- No `eval()`, `Function()`, `vm.runInContext()`, or any dynamic code execution.
- No `innerHTML`, `dangerouslySetInnerHTML`, or DOM manipulation (not applicable but stated for completeness).

---

## Coding standards

- TypeScript `strict: true` — no `any` type anywhere, explicit return types on all functions and methods
- Zod `.strict()` on every input schema — reject unknown fields
- Tool names prefixed with `bridge_` — prevent collisions with other MCP servers
- Error messages must be actionable — state what went wrong AND suggest what to do
- Responses support JSON and Markdown via `response_format` parameter
- Logging to stderr only — `console.error()` for all logs, never `console.log()`
- Named exports only — no default exports
- English comments — concise, explain intent not mechanics
- No dead code — remove unused imports, variables, functions
- No TODO/FIXME in released code — either fix it or file an issue

---

## Build and run

```bash
npm install              # Install dependencies
npm run build            # Compile TypeScript → dist/
npm run lint             # ESLint strict check
npm test                 # Run full test suite (vitest)
npm start                # Run server (stdio transport)
npm audit                # Verify zero vulnerabilities
```

---

## Installation for end users

Add to Claude Desktop config (`Settings > Developer > Edit Config`):

```json
{
  "mcpServers": {
    "acheron": {
      "command": "npx",
      "args": ["-y", "acheron-mcp-server"]
    }
  }
}
```

Restart Claude Desktop. Acheron is now available in Chat, Code, and Cowork.

---

## Design decisions

1. **SQLite over markdown files**: FTS5 provides sub-millisecond full-text search over thousands of entries. Markdown requires directory scans and regex — unusable at scale.
2. **stdio over HTTP**: Local child process of Claude Desktop. No ports, no auth, no attack surface.
3. **No LLM processing**: Context operations are deterministic. No summarization, no embeddings, no API calls. Fast, free, predictable, offline.
4. **Flat tags over hierarchy**: Contexts are tagged and filterable. Real-world context is cross-cutting, not siloed into folders.
5. **Surface-aware metadata**: Every entry records its origin surface. Enables "what did Cowork do?" queries from any surface.
6. **Explicit save over auto-capture**: User or agent decides what to save. Auto-capture generates noise and raises privacy concerns.

---

## What this project does NOT do

- Does NOT access Claude's internal server-side memory system
- Does NOT auto-capture without explicit tool invocation
- Does NOT make network requests or sync to any cloud
- Does NOT replace CLAUDE.md (instructions) — Bridge stores accumulated knowledge
- Does NOT store secrets (passwords, API keys, tokens)
- Does NOT execute or interpret stored content

---

## Testing checklist

### Functional
- [ ] `npm run build` — zero errors, zero warnings
- [ ] `npm run lint` — zero issues
- [ ] `npm audit` — zero vulnerabilities
- [ ] All 6 tools register in MCP Inspector
- [ ] Save + get round-trip preserves all fields exactly
- [ ] FTS5 search returns ranked results
- [ ] FTS5 special characters in query do not crash
- [ ] Pagination: correct slices, accurate has_more and total
- [ ] Filters (project, surface, type, tags, since) work alone and combined
- [ ] Delete removes from both main table and FTS index
- [ ] Status shows accurate counts, DB size, date range
- [ ] Empty database returns sensible defaults, not errors
- [ ] Concurrent save operations do not corrupt data (WAL mode)

### Security
- [ ] SQL injection in content, tags, project, search query: harmless
- [ ] Oversized inputs rejected with actionable error
- [ ] Invalid UUIDs rejected before DB query
- [ ] Null bytes in strings rejected
- [ ] Control characters in project name rejected
- [ ] DB directory: 0700 permissions verified
- [ ] DB file: 0600 permissions verified
- [ ] No stdout output except MCP protocol
- [ ] No network calls during any operation
- [ ] Corrupted DB file: graceful error, no crash, no data leak

### Integration
- [ ] Works in Claude Desktop Chat
- [ ] Works in Claude Code terminal
- [ ] Works in Claude Code VS Code extension
- [ ] Works in Cowork sessions
- [ ] Cross-surface: save in Chat, retrieve in Cowork
- [ ] Cross-surface: save in Code, retrieve in Chat
