import { existsSync } from "node:fs";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ServerConfig } from "./config.js";
import { loadDocs, type LoadedDocs } from "./loader.js";
import { loadCollectPrompts } from "./prompts/collect.js";
import { EngineRegistry } from "./search/index.js";
import { makeGetDocTool } from "./tools/getDoc.js";
import { makeGetPromptTool } from "./tools/getPrompt.js";
import { makeListDocsTool } from "./tools/listDocs.js";
import { makeOutlineTool } from "./tools/outline.js";
import {
  makeListDirectoryTool,
  makeListSourceRootsTool,
  makeReadSourceTool,
} from "./tools/readSource.js";
import { makeSearchDocsTool } from "./tools/searchDocs.js";

export interface BuiltServer {
  server: McpServer;
  docs: LoadedDocs;
  registry: EngineRegistry;
}

const sanitizePromptName = (name: string): string =>
  name.replaceAll(/[^a-zA-Z0-9_]/g, "_");

/**
 * Builds and wires the MCP server with the given config.
 *
 * - Loads the agent docs from disk.
 * - Constructs the engine registry but does not eagerly initialize engines;
 *   an engine is initialized the first time it is queried.
 * - Registers four tools: list/get/search/outline.
 * - Registers every prompt under the prompts directory.
 *
 * The returned `server` is not yet connected to a transport — the caller is
 * responsible for that.
 */
export async function buildServer(config: ServerConfig): Promise<BuiltServer> {
  const docs: LoadedDocs = existsSync(config.docsDir)
    ? await loadDocs(config.docsDir)
    : { root: config.docsDir, manifest: null, docs: [] };

  const registry = new EngineRegistry();
  registry.setDocs(docs.docs);

  const server = new McpServer({
    name: "direct-context-mcp",
    version: "0.1.0",
  });

  const list = makeListDocsTool(docs);
  server.registerTool(list.name, list.config, list.handler);

  const get = makeGetDocTool(docs);
  server.registerTool(get.name, get.config, get.handler);

  const search = makeSearchDocsTool(registry, config.defaultEngine);
  server.registerTool(search.name, search.config, search.handler);

  const outline = makeOutlineTool(docs);
  server.registerTool(outline.name, outline.config, outline.handler);

  if (config.sourceRoots.length > 0) {
    const readSource = makeReadSourceTool(config.sourceRoots);
    server.registerTool(readSource.name, readSource.config, readSource.handler);

    const listRoots = makeListSourceRootsTool(config.sourceRoots);
    server.registerTool(listRoots.name, listRoots.config, listRoots.handler);

    const listDir = makeListDirectoryTool(config.sourceRoots);
    server.registerTool(listDir.name, listDir.config, listDir.handler);
  }

  const collectPrompts = await loadCollectPrompts(config.promptsDir);

  const getPrompt = makeGetPromptTool(collectPrompts);
  server.registerTool(getPrompt.name, getPrompt.config, getPrompt.handler);

  for (const prompt of collectPrompts) {
    const seeAlso =
      prompt.sources.length === 0
        ? ""
        : "\n\n## See also\n\n" +
          prompt.sources
            .map((s) => {
              const relation = s.relation ? ` _(${s.relation})_` : "";
              const path = s.path ? ` — \`${s.path}\`` : "";
              return `- **${s.id}**${relation}${path} — ${s.description}`;
            })
            .join("\n");

    server.registerPrompt(
      sanitizePromptName(prompt.name),
      { title: prompt.description, description: prompt.description },
      () => ({
        messages: [
          {
            role: "user",
            content: { type: "text", text: prompt.body + seeAlso },
          },
        ],
      }),
    );
  }

  return { server, docs, registry };
}
