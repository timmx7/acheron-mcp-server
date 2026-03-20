// Standardized error handling — never expose internals to clients

export interface ToolResponse {
  [key: string]: unknown;
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}

export function createToolError(message: string, suggestion?: string): ToolResponse {
  const text = suggestion ? `${message}\n\nSuggestion: ${suggestion}` : message;
  return {
    content: [{ type: 'text', text }],
    isError: true,
  };
}

export function handleDatabaseError(error: unknown): ToolResponse {
  // Log full details to stderr for debugging
  console.error('[acheron] Database error:', error);

  // Return sanitized message to client
  return createToolError(
    'A database error occurred. The operation could not be completed.',
    'If this persists, check that ~/.acheron/ is accessible and the database file is not corrupted.'
  );
}

export function createToolSuccess(text: string): ToolResponse {
  return {
    content: [{ type: 'text', text }],
  };
}
