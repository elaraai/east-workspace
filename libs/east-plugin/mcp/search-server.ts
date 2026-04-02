import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { buildSearchIndex, formatResults, MIN_SCORE } from "../lib/search.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
// Two levels up from .build/mcp/ to project root
const INDEX_PATH = join(__dirname, "..", "..", "index.json");

// Load index once at startup
const indexPromise = buildSearchIndex(INDEX_PATH);

const server = new McpServer({
  name: "east-search",
  version: "1.0.0",
});

server.tool(
  "search_east_examples",
  "Search the East example index for relevant code examples. Use this to find East language patterns, API usage, and idiomatic examples for specific tasks.",
  {
    query: z.string().describe("Search terms to find relevant East examples"),
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
      .describe(
        "Filter results to a specific East package (e.g. @elaraai/east, @elaraai/east-node-std)"
      ),
  },
  async ({ query, limit, package: packageFilter }) => {
    const miniSearch = await indexPromise;

    let results = miniSearch.search(query, { limit: limit * 2 } as Parameters<typeof miniSearch.search>[1]);

    // Filter out low-relevance noise
    results = results.filter((r) => r.score >= MIN_SCORE);

    // Filter by package if specified
    if (packageFilter) {
      results = results.filter((r) => r.package === packageFilter);
    }

    results = results.slice(0, limit);

    if (results.length === 0) {
      return {
        content: [
          {
            type: "text",
            text: `No East examples found for query: "${query}"`,
          },
        ],
      };
    }

    return {
      content: [
        {
          type: "text",
          text: formatResults(results),
        },
      ],
    };
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
