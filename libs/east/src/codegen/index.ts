/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The IR → TypeScript printer (#628) — the TypeScript half of East's
 * bidirectional codegen: `toSource` renders any East IR as the
 * `East.function` builder source that rebuilds it, the python half
 * (`east.codegen.to_python_source`) renders it as python, and the
 * three-way sweep pins `IR₁ ≡ IR₂ ≡ IR₃` across both.
 */

export { toSource, Unprintable, type ToSourceOptions } from "./printer.js";
export { SPELLINGS, RAW_ONLY, spellingFor, type Spelling } from "./spellings.js";
export { typeSource, typeKey, TYPE_IMPORTS } from "./types.js";
