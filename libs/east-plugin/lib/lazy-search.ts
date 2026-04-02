import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { buildSearchIndex, formatResults, MIN_SCORE } from "./search.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
// When bundled by esbuild into .build/hooks/, __dirname is .build/hooks/
// so we need ../../index.json to reach the project root.
const INDEX_PATH = join(__dirname, "..", "..", "index.json");

let indexPromise: ReturnType<typeof buildSearchIndex> | null = null;

function getIndex() {
  if (!indexPromise) {
    indexPromise = buildSearchIndex(INDEX_PATH);
  }
  return indexPromise;
}

export async function searchAndFormat(
  query: string,
  filterSkills: string[] | null = null,
  limit = 5,
): Promise<string | null> {
  let miniSearch: Awaited<ReturnType<typeof buildSearchIndex>>;
  try {
    miniSearch = await getIndex();
  } catch {
    return null;
  }

  // MiniSearch supports `limit` at runtime but it's not in the type definitions
  let results = miniSearch.search(query, { limit: limit * 2 } as Parameters<typeof miniSearch.search>[1]);

  results = results.filter((r) => r.score >= MIN_SCORE);

  if (filterSkills && results.length > 0) {
    const filtered = results.filter((r) => filterSkills.includes(r.skill as string));
    if (filtered.length > 0) {
      results = filtered;
    }
  }

  results = results.slice(0, limit);

  if (results.length === 0) return null;

  return formatResults(results);
}

export { MIN_SCORE, formatResults };
