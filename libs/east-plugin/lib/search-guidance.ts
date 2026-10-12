// The search-first guidance (#654): the gate a write of corpus code meets when
// no example search is on record, and the reminder a read of the installed
// packages or the examples gets. Spoken in a plugin's own names, so a plugin
// that builds on East's gives the same guidance over its own corpus.

/** The names the search-first guidance speaks in. */
export interface SearchGuidance {
  /** The search tool as the agent calls it, e.g. `mcp__plugin_east_east__search_east_examples`. */
  searchTool: string;
  /** The fetch tool as the agent calls it, e.g. `mcp__plugin_east_east__get_east_example`. */
  getTool: string;
  /** What the code, its packages and its skills are called, e.g. `East`. */
  corpus: string;
  /** The npm scope whose installed packages the read reminder watches, e.g. `@elaraai`. */
  scope: string;
}

/** East's names. */
export const EAST_GUIDANCE: SearchGuidance = {
  searchTool: "mcp__plugin_east_east__search_east_examples",
  getTool: "mcp__plugin_east_east__get_east_example",
  corpus: "East",
  scope: "@elaraai",
};

/** A tool's own name, without the `mcp__<server>__` prefix the agent calls it by. */
function bare(tool: string): string {
  const at = tool.lastIndexOf("__");
  return at < 0 ? tool : tool.slice(at + 2);
}

/**
 * The instruction a write of corpus code meets when no search is on record.
 *
 * @param g - The names it speaks in
 * @returns The gate's text
 */
export function gateText(g: SearchGuidance): string {
  return [
    `STOP: no ${g.corpus} example search on record in this session, and this is ${g.corpus} code.`,
    `Before writing or changing ${g.corpus} code, search the tested example index — it is the API reference:`,
    `1. \`${g.searchTool}\` with what you are about to do (language: "python" for east-py, "typescript" otherwise); summaries come back — id, signature, inputs and result.`,
    `2. \`${g.getTool}\` for the one or two that match, and pattern your code on them.`,
    `Do not read node_modules/${g.scope}/** or *.examples.ts files instead: the index is the same corpus, exact and far cheaper. Every ${g.corpus} skill requires this step.`,
  ].join("\n");
}

/**
 * The reminder a read of the installed packages or the examples gets.
 *
 * @param g - The names it speaks in
 * @returns The reminder's text
 */
export function readText(g: SearchGuidance): string {
  return [
    `Note: the ${g.corpus} example index is the API reference — \`${g.searchTool}\` (then \`${bare(g.getTool)}\`) returns the same tested programs as the ${g.corpus} packages' examples and type declarations, exact, printed in TypeScript or python, at a fraction of the tokens.`,
    `Reading \`.d.ts\` signatures or sweeping \`*.examples.ts\` files reliably produces broken ${g.corpus} code that still type-checks: the signatures omit the runtime rules. Search instead, and read a specific file only when the search pointed you at it.`,
  ].join("\n");
}

/**
 * Whether a Read, Grep or Glob reaches for the example corpus: the installed
 * packages of `scope` or the `*.examples.ts` files. A project's own grep for
 * its imports of the scope is not a sweep of the packages, and a read of one
 * project file is never one.
 *
 * @param scope - The npm scope whose installed packages count, e.g. `@elaraai`
 * @returns The check, over a tool's name and input
 */
export function corpusReadFor(scope: string): (tool: string, input: Record<string, unknown>) => boolean {
  const escaped = scope.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const packagePath = new RegExp(`[/\\\\]node_modules[/\\\\]${escaped}[/\\\\]`);
  // a pattern that sweeps the packages themselves (`node_modules/@elaraai/**`), as opposed to a project's own grep for its `@elaraai/east` imports
  const packagePattern = new RegExp(`(^|[/\\\\])node_modules[/\\\\]${escaped}([/\\\\]|$)`);
  const examplesFile = /\.examples\.tsx?$/;
  return (tool, input) => {
    const file = typeof input['file_path'] === 'string' ? input['file_path'] : '';
    const dir = typeof input['path'] === 'string' ? input['path'] : '';
    const pattern = typeof input['pattern'] === 'string' ? input['pattern'] : '';
    return tool === 'Read' ? packagePath.test(file) || examplesFile.test(file)
      : packagePath.test(dir) || packagePattern.test(pattern) || /\.examples\.tsx?/.test(pattern);
  };
}

/** East's gate. */
export const GATE_TEXT: string = gateText(EAST_GUIDANCE);

/** East's read reminder. */
export const READ_TEXT: string = readText(EAST_GUIDANCE);

/** Whether a Read, Grep or Glob reaches for East's corpus. */
export const isExampleCorpusRead: (tool: string, input: Record<string, unknown>) => boolean = corpusReadFor(EAST_GUIDANCE.scope);
