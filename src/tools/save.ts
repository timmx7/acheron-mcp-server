import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { saveContext } from '../services/context-manager.js';
import { formatContextMarkdown, formatContextJson } from '../utils/format.js';
import { handleDatabaseError, createToolSuccess } from '../utils/errors.js';

export function registerSaveTool(server: McpServer): void {
  server.registerTool(
    'bridge_save_context',
    {
      title: 'Remember / Save Context',
      description:
        'Remember something for later. Use this when the user says things like "remember this", "save this", "note this", "keep this for later", "don\'t forget", or when an important decision, preference, or insight comes up that should persist across conversations. This saves context that will be available in ALL Claude surfaces (Chat, Code, Cowork) — even in future sessions. Use proactively when you recognize something worth remembering: a decision made, a user preference expressed, a lesson learned, a key file identified, or a workflow established.',
      inputSchema: {
        content: z.string()
          .min(1, 'Content cannot be empty')
          .max(10000, 'Content must not exceed 10,000 characters')
          .describe('What to remember. Write it clearly so it will be useful when retrieved later by any Claude surface.'),
        type: z.enum(['decision', 'preference', 'insight', 'file_ref', 'workflow', 'note'])
          .describe('Classify the context: "decision" when the user chose between options (e.g. "let\'s use PostgreSQL", "we\'ll go with REST not GraphQL"). "preference" when the user expresses how they like things done (e.g. "I prefer tabs", "use French for conversation", "keep responses short"). "insight" when a fact or lesson is discovered (e.g. "the API rate-limits at 100 req/s", "that bug was caused by timezone handling"). "file_ref" when a key file is identified (e.g. "src/auth.ts handles all JWT logic"). "workflow" for processes (e.g. "deploy flow: merge → CI → staging → prod"). "note" for anything else worth remembering.'),
        source_surface: z.enum(['chat', 'code', 'cowork'])
          .describe('Where this conversation is happening. "chat" for Claude.ai chat, "code" for Claude Code (terminal/IDE), "cowork" for Claude Cowork sessions.'),
        project: z.string().max(200).optional()
          .describe('Project name if this context is project-specific. Use the same name consistently (e.g. "acme-site", "payments-api"). Omit for personal preferences or general notes.'),
        tags: z.array(z.string().max(50)).max(20).default([])
          .describe("Short labels for categorization. Examples: ['frontend', 'react'], ['deploy', 'ci-cd'], ['auth']. Helps with filtering later."),
        response_format: z.enum(['json', 'markdown']).default('markdown')
          .describe('Response format: json or markdown'),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ content, type, source_surface, project, tags, response_format }) => {
      try {
        const entry = saveContext({ content, type, source_surface, project, tags });
        const text = response_format === 'json'
          ? formatContextJson(entry)
          : formatContextMarkdown(entry);
        return createToolSuccess(text);
      } catch (error: unknown) {
        return handleDatabaseError(error);
      }
    }
  );
}
