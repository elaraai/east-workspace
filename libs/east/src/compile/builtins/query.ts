/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import type { SourceMap } from "../../location.js";
import type { BuiltinEvaluators } from "../runtime.js";

/** @internal The `Query` builtin (#1041): a query's program and input names beside its translation, which it gives, so calling it runs the translation. */
export const query_builtins = {
  Query: (_loc_id: bigint, _source_map: SourceMap | null) => (_query: unknown, translation: unknown) => translation,
} satisfies BuiltinEvaluators;
