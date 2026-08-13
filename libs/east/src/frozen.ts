/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The frozen-value registry.
 *
 * Frozen East values are produced by the frozen decode/parse surfaces
 * (`decodeBeast2For(type, { frozen: true })`, `parseFor(type, true)`,
 * `fromJSONFor(type, true)`, `openBeast2LazyFor(type, { frozen: true })`) and
 * are deeply immutable: mutating builtins throw, and frozen collections
 * compare as value types under `Is`.
 *
 * Most frozen values are branded with `Object.freeze` at construction. This
 * registry brands the ones `Object.freeze` cannot:
 *
 * - non-empty typed arrays (Vector values, Matrix data, Blob bytes) — the
 *   spec forbids freezing array buffer views with elements,
 * - lazy pager-backed collections — freezing them would break their own
 *   internal hydration writes (and probing a lazy Array proxy with
 *   `Object.isFrozen` must not touch its traps).
 *
 * Registry membership OR `Object.isFrozen` together define frozen-ness; use
 * {@link isFrozenValue} rather than either primitive directly.
 */

const frozenValues = new WeakSet<object>();

/**
 * Brands a value as frozen in the registry.
 *
 * Used by the frozen decode paths for values `Object.freeze` cannot brand
 * (typed arrays, lazy pager-backed collections). Non-objects pass through
 * untouched.
 *
 * @param value - the value to brand
 * @returns the same value
 * @internal
 */
export function markFrozen<T>(value: T): T {
  if (typeof value === "object" && value !== null) {
    frozenValues.add(value);
  }
  return value;
}

/**
 * Tests whether a value is a frozen East value.
 *
 * A value is frozen when a frozen decode/parse constructed it — either
 * branded with `Object.freeze` or recorded in the frozen registry (typed
 * arrays and lazy pager-backed collections, which cannot be `Object.freeze`d).
 * Host code may also `Object.freeze` a container itself; such a container is
 * treated as frozen too, since it is equally immutable.
 *
 * Frozen `Array`/`Set`/`Dict`/`Vector`/`Matrix` values are value types:
 * `Is` compares two frozen operands by deep value equality (the `Blob`
 * precedent), and every mutating builtin throws.
 *
 * @param value - the value to test
 * @returns `true` when the value is frozen
 *
 * @example
 * ```ts
 * const decoded = decodeBeast2For(ArrayType(IntegerType), { frozen: true })(blob);
 * isFrozenValue(decoded);  // true
 * isFrozenValue([1n]);     // false
 * ```
 */
export function isFrozenValue(value: unknown): boolean {
  return typeof value === "object" && value !== null && (frozenValues.has(value) || Object.isFrozen(value));
}
