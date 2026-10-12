import { EastLspPool } from "../lib/lsp-client.js";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { registerExampleTools } from "./example-tools.js";
import { checkPluginStatus, formatStatus } from "../lib/plugin-status.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
// Two levels up from .build/mcp/ to project root
const INDEX_PATH = join(__dirname, "..", "..", "index.json");

const server = new McpServer({
  name: "east",
  version: "1.0.0",
});

// The example search and fetch, over East's index, loaded once before the
// server connects: an index that does not load fails it at startup, naming why.
await registerExampleTools(server, { index: [INDEX_PATH] });

server.tool(
  "east_status",
  "Report whether the East plugin's features are installed and working: bundled hooks, the example-search index, the PostToolUse diagnostics daemon, skills, and East project detection. Use when asked to check or confirm the East plugin's status or health.",
  {
    directory: z
      .string()
      .optional()
      .describe("Project directory to check for diagnostics readiness (defaults to the current working directory)"),
  },
  async ({ directory }) => {
    const checks = await checkPluginStatus(join(__dirname, "..", ".."), directory ?? process.cwd());
    return { content: [{ type: "text", text: formatStatus(checks) }] };
  },
);

const lsp = new EastLspPool();
server.tool(
  "east_lsp_diagnostics",
  "Run the bundled real TypeScript/TSX or Python language server on a source file. Connections stay warm. Returns the next diagnostic publication; Python's build tier may publish later. Use refresh: false to read the latest publication after waiting. No publication means unavailable or still pending, never a clean bill of health.",
  {
    file: z.string().describe("Absolute source file path (.ts, .tsx, .py)"),
    timeout_ms: z.number().int().min(100).max(30000).default(15000),
    refresh: z.boolean().default(true),
  },
  async ({ file, timeout_ms, refresh }) => {
    try {
      const publication = await lsp.diagnostics(file, timeout_ms, refresh);
      return { content: [{ type: "text" as const, text: publication === null
        ? "No diagnostic publication available. The server may still be computing, or this project may lack its language runtime. This does not mean the file is clean."
        : JSON.stringify({ ...publication, scope: "East-aware diagnostics only. Empty diagnostics can also mean the file is outside the server scope; check east_status for runtime readiness. Python build-tier updates may arrive later; poll with refresh: false." }, null, 2) }] };
    } catch (error) {
      return { isError: true, content: [{ type: "text" as const, text: String(error) }] };
    }
  },
);
server.server.onclose = () => lsp.close();
// The stdio transport never reports end of input: a client that closes stdin
// has gone, and the language servers' pipes must not keep this process alive.
process.stdin.once("end", () => lsp.close());
for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => { lsp.close(); process.exit(0); });

const transport = new StdioServerTransport();
await server.connect(transport);
