#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { SERVER_NAME, SERVER_VERSION } from './constants.js';
import { getDatabase, closeDatabase } from './db/client.js';
import { registerSaveTool } from './tools/save.js';
import { registerGetTool } from './tools/get.js';
import { registerSearchTool } from './tools/search.js';
import { registerListTool } from './tools/list.js';
import { registerDeleteTool } from './tools/delete.js';
import { registerStatusTool } from './tools/status.js';

async function main(): Promise<void> {
  // Initialize database before anything else
  getDatabase();

  const server = new McpServer({
    name: SERVER_NAME,
    version: SERVER_VERSION,
  });

  // Register all tools
  registerSaveTool(server);
  registerGetTool(server);
  registerSearchTool(server);
  registerListTool(server);
  registerDeleteTool(server);
  registerStatusTool(server);

  // Graceful shutdown
  const shutdown = (): void => {
    console.error('[acheron] Shutting down...');
    closeDatabase();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  // Connect to stdio transport
  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error(`[acheron] ${SERVER_NAME} v${SERVER_VERSION} running on stdio`);
}

main().catch((error: unknown) => {
  console.error('[acheron] Fatal error:', error);
  closeDatabase();
  process.exit(1);
});
