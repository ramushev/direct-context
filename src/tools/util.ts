import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

/**
 * Wrap a JSON-serializable value as a tool response with both `content`
 * (plain text JSON, for clients that don't read structuredContent) and
 * `structuredContent` (for clients that do).
 */
export const jsonResult = (value: unknown): CallToolResult => ({
  content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
  structuredContent: value as Record<string, unknown>,
});

export const errorResult = (message: string): CallToolResult => ({
  isError: true,
  content: [{ type: "text", text: message }],
});
