import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { formatFull, formatResults, getEntry, loadIndex, searchExamples } from "../lib/search.js";
import { checkPluginStatus, formatStatus } from "../lib/plugin-status.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
// Two levels up from .build/mcp/ to project root
const INDEX_PATH = join(__dirname, "..", "..", "index.json");

// Load index once at startup
const indexPromise = loadIndex(INDEX_PATH);

const server = new McpServer({
  name: "east",
  version: "1.0.0",
});

const languageArg = z
  .enum(["typescript", "python"])
  .default("typescript")
  .describe('The language to render examples in: "typescript" (the East DSL) or "python" (east-py). Every core example is stored as IR and printed in either; UI examples are TypeScript only.');

server.tool(
  "search_east_examples",
  "The mandatory first step before writing or changing East code: search the tested example index for the capability you are about to use. Every East API has an example here, stored as IR and rendered in TypeScript or python. Returns summaries by default (id, description, signature, keywords, the example inputs and result — a few hundred bytes each); pass format: \"full\" for the code, or fetch one with get_east_example. Do not read node_modules/@elaraai or *.examples.ts files instead — this is the same corpus, exact and far cheaper.",
  {
    query: z.string().describe("What you need, in words: the operation, the types involved, the method name if you know it (e.g. \"group by key and sum\", \"dict merge\", \"parse csv blob\")"),
    language: languageArg,
    format: z
      .enum(["summary", "full"])
      .default("summary")
      .describe('"summary" (default) lists the hits in one line each; "full" includes each hit\'s code in the requested language'),
    limit: z
      .number()
      .int()
      .min(1)
      .max(20)
      .default(5)
      .describe("Maximum number of results to return (default 5, max 20)"),
    package: z
      .string()
      .optional()
      .describe("Filter results to one package by its bare name — east, east-node-std, east-node-io, east-py-datascience, east-ui, e3-ui, e3, e3-ui-cli, e3-create — the `@elaraai/` scope is accepted and ignored; an unknown name is reported with the indexed names"),
  },
  async ({ query, language, format, limit, package: packageFilter }) => {
    const index = await indexPromise;
    const { entries, unknownPackage, known } = searchExamples(index, { query, limit, package: packageFilter });

    if (unknownPackage !== undefined) {
      return {
        content: [
          {
            type: "text",
            text: `Package "${unknownPackage}" is not an indexed package name. Indexed packages: ${known.join(", ")} (bare names; \`@elaraai/east-node-io\` and \`east-node-io\` are the same). Retry with one of them, or without a package filter.`,
          },
        ],
      };
    }

    if (entries.length === 0) {
      const scope = packageFilter ? ` in package "${packageFilter}"` : "";
      return {
        content: [
          {
            type: "text",
            text: `No East examples found for query: "${query}"${scope} — try the operation's plain-English name, the East method name, or the types involved${packageFilter ? ", or drop the package filter" : ""}.`,
          },
        ],
      };
    }

    return {
      content: [
        {
          type: "text",
          text: formatResults(entries, language, format),
        },
      ],
    };
  }
);

server.tool(
  "get_east_example",
  "One East example in full, by the id a search returned: its code printed in the requested language from the example's IR (TypeScript or python), its signature, and the example inputs and expected result. The second step after search_east_examples.",
  {
    id: z.string().describe("The example id from a search result, e.g. \"east:array.examples.ts:arrayMap\""),
    language: languageArg,
  },
  async ({ id, language }) => {
    const index = await indexPromise;
    const entry = getEntry(index.search, id);
    if (entry === null) {
      return { content: [{ type: "text", text: `No East example with id "${id}" — ids come from search_east_examples results.` }] };
    }
    return { content: [{ type: "text", text: formatFull([entry], language) }] };
  },
);

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

const transport = new StdioServerTransport();
await server.connect(transport);
