# Acheron

**Shared persistent memory across Claude Chat, Code, and Cowork.**

[![acheron-mcp-server MCP server](https://glama.ai/mcp/servers/timmx7/acheron-mcp-server/badges/card.svg)](https://glama.ai/mcp/servers/timmx7/acheron-mcp-server)

```
  ┌───────────┐     ┌───────────┐     ┌───────────┐
  │   Chat    │     │   Code    │     │  Cowork   │
  └─────┬─────┘     └─────┬─────┘     └─────┬─────┘
        │                 │                  │
        └────────┬────────┴────────┬─────────┘
                 │                 │
           ┌─────▼─────────────────▼─────┐
           │        Acheron MCP          │
           │  ┌───────────────────────┐  │
           │  │  ~/.acheron/bridge.db │  │
           │  └───────────────────────┘  │
           └─────────────────────────────┘
                  Local · No cloud
```

Save a decision in Chat. Retrieve it in Cowork. Search for it from Code. All local, all offline, zero configuration.

## Install

### Claude Desktop (recommended)

This connects Acheron to **all surfaces** — Chat, Code, Cowork, and Dispatch. This is the recommended setup for full cross-surface bridging.

Open Claude Desktop → `Settings` → `Developer` → `Edit Config`, then add:

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

Restart Claude Desktop.

### Claude Code only

If you only need Acheron in Claude Code (terminal / IDE):

```bash
claude mcp add acheron -- npx -y acheron-mcp-server
```

Requires Node.js 20+. Native build tools may be needed for better-sqlite3 ([details](#troubleshooting)).

## Usage

Just talk naturally. Acheron's tool descriptions are written so Claude uses them automatically.

**Save context** — say "remember this", "save this decision", "note that we chose X":

> "Remember: we're using Next.js App Router for the acme-site project."

**Search context** — say "what did I decide about...", "find my notes on...":

> "What did we decide about the authentication approach?"

**Browse context** — say "show me my preferences", "list all decisions for this project":

> "Show me everything saved for acme-site."

## How it works

Acheron is an MCP server. It stores context in a local SQLite database (`~/.acheron/bridge.db`) with full-text search. No cloud, no network calls, no telemetry. Data never leaves your machine.

Six tools, all prefixed `bridge_`:

| Tool | Purpose |
|------|---------|
| `bridge_save_context` | Remember decisions, preferences, insights, notes |
| `bridge_get_context` | Retrieve full details of a saved context |
| `bridge_search_context` | Full-text search across all saved contexts |
| `bridge_list_contexts` | Browse and filter by project, surface, type, tags |
| `bridge_delete_context` | Forget a saved context |
| `bridge_status` | Overview of what's stored |

## Troubleshooting

**`better-sqlite3` install fails?** You need native build tools:
- macOS: `xcode-select --install`
- Linux: `sudo apt install build-essential`
- Windows: [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/)

**Database issues?** Delete `~/.acheron/bridge.db` — Acheron recreates it on next start.

## License

MIT