/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Guards the `@elaraai/e3/browser` browser-safety contract (#99): no module
 * reachable from the compiled `browser.js` entry may import a Node built-in
 * (or a known Node-only external like `yazl`). This is what lets UI
 * libraries (`@elaraai/e3-ui`) import the authoring builders without
 * dragging `node:fs` / `node:child_process` into a browser bundle.
 *
 * The regression this catches: a new module with top-level `node:*` imports
 * gets wired (directly or transitively) into a module on the browser
 * surface — e.g. definition-time validation living in the same file as
 * export-time capture machinery.
 */

import { test } from 'node:test';
import assert from 'node:assert';
import * as fs from 'node:fs';
import { fileURLToPath } from 'node:url';

/** Bare-specifier Node built-ins (the `node:` prefix is caught separately). */
const NODE_BUILTINS = new Set([
  'assert', 'buffer', 'child_process', 'crypto', 'events', 'fs', 'http',
  'https', 'net', 'os', 'path', 'process', 'stream', 'string_decoder',
  'tls', 'url', 'util', 'worker_threads', 'zlib',
]);

/** Known Node-only external packages that must never reach the browser surface. */
const NODE_ONLY_EXTERNALS = new Set(['yazl']);

/** Extracts every static import/export-from specifier from compiled ESM. */
function importSpecifiers(source: string): string[] {
  const specifiers: string[] = [];
  const fromRe = /(?:^|\n)\s*(?:import|export)\s[^;'"]*?from\s*['"]([^'"]+)['"]/g;
  const bareRe = /(?:^|\n)\s*import\s*['"]([^'"]+)['"]/g;
  for (const re of [fromRe, bareRe]) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(source)) !== null) specifiers.push(m[1]!);
  }
  return specifiers;
}

test('browser entry import graph is free of Node built-ins', () => {
  const entry = fileURLToPath(new URL('./browser.js', import.meta.url));
  assert.ok(fs.existsSync(entry), `compiled browser entry not found at ${entry} — build first`);

  const visited = new Set<string>();
  const queue = [entry];
  const violations: string[] = [];

  while (queue.length > 0) {
    const file = queue.pop()!;
    if (visited.has(file)) continue;
    visited.add(file);
    const source = fs.readFileSync(file, 'utf8');
    for (const spec of importSpecifiers(source)) {
      if (spec.startsWith('node:') || NODE_BUILTINS.has(spec) || NODE_ONLY_EXTERNALS.has(spec)) {
        violations.push(`${file} imports '${spec}'`);
      } else if (spec.startsWith('./') || spec.startsWith('../')) {
        queue.push(fileURLToPath(new URL(spec, `file://${file}`)));
      }
      // Other bare externals (@elaraai/east, @elaraai/e3-types) are
      // browser-safe by their own contracts and are not followed here.
    }
  }

  assert.ok(visited.size > 1, 'walker followed no relative imports — check the specifier regex');
  assert.deepStrictEqual(
    violations,
    [],
    `Node-only imports reachable from @elaraai/e3/browser (breaks the #99 browser guarantee):\n${violations.join('\n')}`,
  );
});
