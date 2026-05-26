#!/usr/bin/env node
import http from "node:http";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { parseConfig } from "./config.js";
import { buildServer } from "./server.js";

const log = (msg: string): void => {
  process.stderr.write(`[direct-context-mcp] ${msg}\n`);
};

const config = parseConfig();
const { server, docs } = await buildServer(config);

log(`loaded ${docs.docs.length} doc(s) from ${docs.root}`);
log(`default engine: ${config.defaultEngine}`);

if (config.sourceRoots.length > 0) {
  for (const r of config.sourceRoots) {
    log(`source root: ${r.name} -> ${r.path}`);
  }
  log("tools registered: read_source_file, list_source_roots");
} else if (docs.docs.length > 0) {
  log(
    "no source roots configured — read_source_file is NOT exposed.\n" +
      "[direct-context-mcp]   re-run `pnpm ctx:load` from a local path to auto-register one,\n" +
      "[direct-context-mcp]   or pass --source-root /path/to/repo when starting the server.",
  );
}

let httpServer: http.Server | undefined;

if (config.transport === "http") {
  httpServer = http.createServer(async (req, res) => {
    if (req.method !== "POST") {
      res.writeHead(405, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Method not allowed" }));
      return;
    }

    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);

    let body: unknown;
    try {
      body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Invalid JSON" }));
      return;
    }

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });
    res.on("close", () => {
      void transport.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, body);
  });

  httpServer.listen(config.port, () => {
    log(`HTTP transport listening on :${config.port}`);
  });
} else {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
  log(`${signal} received, shutting down`);
  try {
    await server.close();
    httpServer?.close();
  } catch {
    // best-effort
  }
  process.exit(0);
};

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => void shutdown(signal));
}
