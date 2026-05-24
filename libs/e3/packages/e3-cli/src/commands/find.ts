/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * e3 dataset find - Search workspace dataset names by substring.
 *
 * Usage:
 *   e3 dataset find . dev greet              # all paths in workspace 'dev' containing 'greet'
 *   e3 dataset find . dev '*output*'         # glob-style substring match
 *   e3 dataset find https://server/repos/r dev greet
 */

import { parseRepoLocation, formatError, exitError } from '../utils.js';
import { buildWorkspaceIndex } from '../path-resolver.js';

/**
 * Build a name matcher from a user pattern.
 *
 * - Empty pattern matches nothing (avoids accidental "everything").
 * - Plain pattern (no `*` / `?`) becomes a literal substring match.
 * - Pattern containing `*` / `?` becomes a glob: `*` → any sequence,
 *   `?` → any single character. Regex meta-chars in the user pattern are
 *   escaped before glob expansion, so `data.csv` matches literal `data.csv`,
 *   not `dataXcsv`.
 */
export function makeMatcher(pattern: string): (name: string) => boolean {
  if (pattern.length === 0) {
    return () => false;
  }
  const hasGlob = pattern.includes('*') || pattern.includes('?');
  if (!hasGlob) {
    return (name) => name.includes(pattern);
  }
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');
  const re = new RegExp(`^${escaped}$`);
  return (name) => re.test(name);
}

export async function findCommand(repoArg: string, ws: string, pattern: string): Promise<void> {
  try {
    const location = await parseRepoLocation(repoArg);
    const index = await buildWorkspaceIndex(location, ws);
    const match = makeMatcher(pattern);

    const hits = index.filter((e) => match(e.name));
    if (hits.length === 0) {
      console.log('(no matches)');
      return;
    }
    hits.sort((a, b) => a.name.localeCompare(b.name));
    for (const e of hits) {
      console.log(`${ws}.${e.name}`);
    }
  } catch (err) {
    exitError(formatError(err));
  }
}
