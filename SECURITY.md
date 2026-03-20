# Security Policy

## Reporting vulnerabilities

If you discover a security vulnerability in Acheron, please report it responsibly.

**Do NOT open a public GitHub issue for security vulnerabilities.**

Contact: Open a private security advisory on GitHub via the "Security" tab of this repository.

## Security model

Acheron is designed with a local-first, zero-trust security architecture:

### Network isolation
- Zero outbound network calls. No HTTP requests, DNS lookups, telemetry, analytics, or update checks.
- Communication exclusively via stdio with the parent Claude Desktop process.

### Data protection
- All data stored locally at `~/.acheron/bridge.db`.
- Directory permissions: `0700` (owner only).
- File permissions: `0600` (owner only).
- No cloud sync, no data exfiltration paths.

### Input validation
- All inputs validated via Zod schemas with strict mode before any processing.
- SQL injection prevented: only prepared statements with parameter binding.
- FTS5 queries sanitized to prevent syntax injection.
- Null bytes and control characters stripped from all string inputs.

### Code execution
- No `eval()`, `Function()`, `vm.runInContext()`, or dynamic code execution.
- Stored content is treated as opaque text, never interpreted or executed.

### Dependencies
- Minimal footprint: 4 runtime dependencies.
- `npm audit` must report zero vulnerabilities before any release.
- All versions pinned via package-lock.json.

## Supported versions

| Version | Supported          |
|---------|--------------------|
| 1.x     | :white_check_mark: |

## Scope

The following are in scope for security reports:
- SQL injection in any tool input
- Path traversal via project names or content
- Information disclosure via error messages
- Denial of service via malformed input
- Permission bypass on DB directory/file
- Any form of remote code execution

The following are out of scope:
- Issues requiring physical access to the user's machine
- Social engineering attacks
- Vulnerabilities in dependencies (report to upstream maintainers)
