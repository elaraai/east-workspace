/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/* The TypeScript runtime's compiler, from IR to JavaScript closures. The code
 * lives in compile/: the pieces compiled code shares, the IR compiler with a
 * module per node family, and the builtins with a module per domain. This
 * module names what the package exports from it. */

export { isTypeValueEqual } from "./type_of_type.js";
export {
  printTypeValue, EAST_IR_SYMBOL, EAST_CAPTURES_SYMBOL, EAST_SOURCE_MAP_SYMBOL,
  requiresBoxing, ReturnException, type ContextValue, type RuntimeContext,
} from "./compile/runtime.js";
export { compile_internal } from "./compile/ir.js";
export { applyTypeParameters } from "./compile/type_parameters.js";
