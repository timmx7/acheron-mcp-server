# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.0.0] - 2026-03-20

### Added
- Initial release
- 6 MCP tools: bridge_save_context, bridge_get_context, bridge_search_context, bridge_list_contexts, bridge_delete_context, bridge_status
- SQLite storage with FTS5 full-text search
- Cross-surface context persistence (Chat ↔ Code ↔ Cowork)
- stdio transport for Claude Desktop integration
- Zod input validation on all tools
- Markdown and JSON response formats
- Comprehensive security hardening (prepared statements, file permissions, input sanitization)
