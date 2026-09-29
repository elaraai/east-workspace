/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { join } from "node:path";

/**
 * Runs `f` with `make test-export`'s directory, `EXPORT_TEST_IR`, set to a
 * subdirectory of it, where the query suites' compliance tests go
 * (`query-conformance/`, `query-types/`, `query-corpus/`): each runner reads
 * every `query-*` directory as it reads the top level.
 *
 * @param name - the subdirectory
 * @param f - what exports there: a `describeEast` call
 * @returns what `f` returns
 */
export function inExportSubdirectory<T>(name: string, f: () => T): T {
  const root = process.env.EXPORT_TEST_IR;
  if (root === undefined || root === "") return f();
  process.env.EXPORT_TEST_IR = join(root, name);
  try {
    return f();
  } finally {
    process.env.EXPORT_TEST_IR = root;
  }
}
