/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import type { BuiltinName } from "../../builtins.js";
import type { BuiltinEvaluator } from "../runtime.js";
import { compare_builtins } from "./compare.js";
import { primitives_builtins } from "./primitives.js";
import { string_builtins } from "./string.js";
import { datetime_builtins } from "./datetime.js";
import { blob_builtins } from "./blob.js";
import { ref_builtins } from "./ref.js";
import { array_builtins } from "./array.js";
import { set_builtins } from "./set.js";
import { dict_builtins } from "./dict.js";
import { vector_builtins } from "./vector.js";
import { sparse_builtins } from "./sparse.js";
import { matrix_builtins } from "./matrix.js";

/** @internal Every builtin's implementation, keyed by name. */
export const builtin_evaluators: Record<BuiltinName, BuiltinEvaluator> = {
  ...compare_builtins,
  ...primitives_builtins,
  ...string_builtins,
  ...datetime_builtins,
  ...blob_builtins,
  ...ref_builtins,
  ...array_builtins,
  ...set_builtins,
  ...dict_builtins,
  ...vector_builtins,
  ...sparse_builtins,
  ...matrix_builtins,
};
