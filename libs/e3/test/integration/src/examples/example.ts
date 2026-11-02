/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * The e3 examples the plugin's search index serves (`libs/east-plugin`,
 * `index.config.json`): each `export const x = example({ … })` in a
 * `*.examples.ts` beside this file is indexed as its `fn`'s source, and
 * `examples.spec.ts` builds and exports every one, so an example that no
 * longer builds fails here rather than misleading whoever reads it.
 */

import type { PackageDef } from '@elaraai/e3';

/** One e3 example: what a search for it would say, and the package it builds. */
export interface E3Example {
  /** What a search for it would say. */
  keywords: string[];
  /** One sentence: what the example shows. */
  description: string;
  /** Builds the example's package. */
  fn: () => PackageDef<Record<string, unknown>>;
}

/**
 * Declares an e3 example: indexed by its `fn`'s source, and built and exported by the spec.
 *
 * @param def - Its keywords, description and the function building its package
 * @returns The example, as given
 */
export function example(def: E3Example): E3Example {
  return def;
}
