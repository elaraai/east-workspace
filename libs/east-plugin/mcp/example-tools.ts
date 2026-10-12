import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { EAST_CORPUS, EAST_SCOPES, formatFull, formatResults, getEntry, loadIndexes, searchExamples, type LoadedIndex } from "../lib/search.js";

// The example search's two MCP tools (#654), for any server: East's own
// registers them with East's names over East's index, and a plugin that builds
// on East's registers them with its own names over its index — beside East's
// to answer both corpora from one server, or alone beside the East plugin.

/** East's indexed packages, as the search tool's package filter names them. */
export const EAST_PACKAGES: readonly string[] = ["east", "east-node-std", "east-node-io", "east-py-datascience", "east-ui", "e3-ui", "e3", "e3-ui-cli", "e3-create"];

/** What the search and fetch tools answer from, and the names they go by. */
export interface ExampleToolsOptions {
  /** The `index.json` files the tools answer from, read once — East's (`EAST_INDEX_PATH`) among them to answer its corpus too — or an index already loaded. */
  index: readonly string[] | Promise<LoadedIndex>;
  /** The search tool's name (default `search_east_examples`). */
  searchTool?: string;
  /** The fetch tool's name (default `get_east_example`). */
  getTool?: string;
  /** What the tools call the corpus and its code (default `East`). */
  corpus?: string;
  /** The package names the package filter's description lists (default East's). */
  packages?: readonly string[];
  /**
   * The npm scopes the corpus's packages are installed under (default East's,
   * `@elaraai`): the package filter accepts a name under any of them, and the
   * search tool tells the agent not to read the installed packages there. A
   * server answering East's corpus beside its own names both scopes.
   */
  scopes?: readonly string[];
}

function isLoaded(index: ExampleToolsOptions["index"]): index is Promise<LoadedIndex> {
  return typeof (index as { then?: unknown }).then === "function";
}

/**
 * Registers the example search and fetch tools on `server`.
 *
 * @param server - The MCP server the tools join
 * @param options - The index they answer from and the names they go by
 * @returns The index, once loaded
 */
export function registerExampleTools(server: McpServer, options: ExampleToolsOptions): Promise<LoadedIndex> {
  const searchTool = options.searchTool ?? "search_east_examples";
  const getTool = options.getTool ?? EAST_CORPUS.getTool;
  const corpus = options.corpus ?? EAST_CORPUS.corpus;
  const packages = options.packages ?? EAST_PACKAGES;
  const scopes = options.scopes ?? EAST_SCOPES;
  const names = { corpus, getTool };
  const scoped = scopes.map((scope) => `\`${scope}/\``);
  const scopesNamed = `the ${scoped.join(" and ")} scope${scoped.length === 1 ? " is" : "s are"} accepted and ignored`;
  const indexPromise = isLoaded(options.index) ? options.index : loadIndexes(options.index);

  const languageArg = z
    .enum(["typescript", "python"])
    .default("typescript")
    .describe('The language to render examples in: "typescript" (the East DSL) or "python" (east-py). Every core example is stored as IR and printed in either; UI examples are TypeScript only.');

  server.tool(
    searchTool,
    `The mandatory first step before writing or changing ${corpus} code: search the tested example index for the capability you are about to use. Every ${corpus} API has an example here, stored as IR and rendered in TypeScript or python. Returns summaries by default (id, description, signature, keywords, the example inputs and result — a few hundred bytes each); pass format: "full" for the code, or fetch one with ${getTool}. Do not read ${scopes.map((scope) => `node_modules/${scope}`).join(" or ")} or *.examples.ts files instead — this is the same corpus, exact and far cheaper.`,
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
        .describe(`Filter results to one package by its bare name — ${packages.join(", ")} — ${scopesNamed}; an unknown name is reported with the indexed names`),
    },
    async ({ query, language, format, limit, package: packageFilter }) => {
      const index = await indexPromise;
      const { entries, unknownPackage, known } = searchExamples(index, { query, limit, package: packageFilter, scopes });

      if (unknownPackage !== undefined) {
        return {
          content: [
            {
              type: "text",
              text: `Package "${unknownPackage}" is not an indexed package name. Indexed packages: ${known.join(", ")} (bare names: ${scopesNamed}). Retry with one of them, or without a package filter.`,
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
              text: `No ${corpus} examples found for query: "${query}"${scope} — try the operation's plain-English name, the East method name, or the types involved${packageFilter ? ", or drop the package filter" : ""}.`,
            },
          ],
        };
      }

      return {
        content: [
          {
            type: "text",
            text: formatResults(entries, language, format, names),
          },
        ],
      };
    }
  );

  server.tool(
    getTool,
    `One ${corpus} example in full, by the id a search returned: its code printed in the requested language from the example's IR (TypeScript or python), its signature, and the example inputs and expected result. The second step after ${searchTool}.`,
    {
      id: z.string().describe("The example id from a search result, e.g. \"east:array.examples.ts:arrayMap\""),
      language: languageArg,
    },
    async ({ id, language }) => {
      const index = await indexPromise;
      const entry = getEntry(index.search, id);
      if (entry === null) {
        return { content: [{ type: "text", text: `No ${corpus} example with id "${id}" — ids come from ${searchTool} results.` }] };
      }
      return { content: [{ type: "text", text: formatFull([entry], language) }] };
    },
  );

  return indexPromise;
}
