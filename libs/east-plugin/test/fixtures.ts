import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TestContext } from "node:test";
import type { IndexEntry } from "../lib/search.js";

// Two small corpora, East's and a downstream plugin's ("Acme"), written as the
// index files a plugin serves, for the tests of a plugin that builds on East's.

/** An authored (non-program) example entry. */
export function entry(pkg: string, file: string, name: string, test: string, keywords: string[]): IndexEntry {
  return {
    id: `${pkg}:${file}:${name}`,
    skill: pkg,
    package: pkg,
    file: `${pkg}/test/${file}`,
    suite: "",
    test,
    keywords,
    imports: [],
    languages: ["typescript"],
    source: `// ${test}\n${name}()`,
  };
}

export const EAST_ENTRIES: IndexEntry[] = [
  entry("east", "array.examples.ts", "arrayMap", "maps every element of an array", ["array", "map"]),
  entry("east", "dict.examples.ts", "dictMerge", "merges two dicts", ["dict", "merge"]),
];

export const ACME_ENTRIES: IndexEntry[] = [
  entry("acme", "deploy.examples.ts", "deployApp", "deploys an app to the cloud", ["deploy", "app", "cloud"]),
  entry("acme", "release.examples.ts", "releaseApp", "releases an app from staging", ["release", "app", "staging"]),
];

/** Writes each corpus as an `index.json` in a new temporary directory, which
 *  the test removes once it ends. */
export function writeIndexes(t: TestContext, ...corpora: IndexEntry[][]): string[] {
  const dir = mkdtempSync(join(tmpdir(), "east-plugin-index-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return corpora.map((entries, i) => {
    const path = join(dir, `index-${i}.json`);
    writeFileSync(path, JSON.stringify({ version: 2, entries }));
    return path;
  });
}
