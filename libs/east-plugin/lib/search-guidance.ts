export const GATE_TEXT = [
  "STOP: no East example search on record in this session, and this is East code.",
  "Before writing or changing East code, search the tested example index — it is the API reference:",
  "1. `mcp__plugin_east_east__search_east_examples` with what you are about to do (language: \"python\" for east-py, \"typescript\" otherwise); summaries come back — id, signature, inputs and result.",
  "2. `mcp__plugin_east_east__get_east_example` for the one or two that match, and pattern your code on them.",
  "Do not read node_modules/@elaraai/** or *.examples.ts files instead: the index is the same corpus, exact and far cheaper. Every East skill requires this step.",
].join("\n");

const EAST_PACKAGE_PATH = /[/\\]node_modules[/\\]@elaraai[/\\]/;
// a pattern that sweeps the East packages themselves (`node_modules/@elaraai/**`), as opposed to a project's own grep for its `@elaraai/east` imports
const EAST_PACKAGE_PATTERN = /(^|[/\\])node_modules[/\\]@elaraai([/\\]|$)/;
const EXAMPLES_FILE = /\.examples\.tsx?$/;

export const READ_TEXT = [
  "Note: the East example index is the API reference — `mcp__plugin_east_east__search_east_examples` (then `get_east_example`) returns the same tested programs as the East packages' examples and type declarations, exact, printed in TypeScript or python, at a fraction of the tokens.",
  "Reading `.d.ts` signatures or sweeping `*.examples.ts` files reliably produces broken East code that still type-checks: the signatures omit the runtime rules. Search instead, and read a specific file only when the search pointed you at it.",
].join("\n");

export function isExampleCorpusRead(tool: string, input: Record<string, unknown>): boolean {
  const file = typeof input['file_path'] === 'string' ? input['file_path'] : '';
  const dir = typeof input['path'] === 'string' ? input['path'] : '';
  const pattern = typeof input['pattern'] === 'string' ? input['pattern'] : '';
  return tool === 'Read' ? EAST_PACKAGE_PATH.test(file) || EXAMPLES_FILE.test(file)
    : EAST_PACKAGE_PATH.test(dir) || EAST_PACKAGE_PATTERN.test(pattern) || /\.examples\.tsx?/.test(pattern);
}
