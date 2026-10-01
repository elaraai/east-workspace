/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The checker's diagnostics: every sentence it says, in one place, because the
 * python twin must say the same words (`devdocs/QUERY.md` §12 lists them).
 *
 * @packageDocumentation
 */

import { none, some, variant } from "../../containers/variant.js";
import type { ValueTypeOf } from "../../types.js";
import type { QueryErrorType, QueryFixType } from "../types.js";
import { toQuerySpan, type JqRange } from "./spans.js";

/** A diagnostic, as the query wire types hold it. @internal */
export type QueryError = ValueTypeOf<typeof QueryErrorType>;
/** A one-click fix. @internal */
export type QueryFix = ValueTypeOf<typeof QueryFixType>;

/**
 * Builds a diagnostic.
 *
 * @param text - the program's text
 * @param code - the diagnostic's code
 * @param range - the text it is about, or `undefined`
 * @param message - its sentence, led by its code
 * @param options - suggestions (replacement texts for the range, best first),
 *   fixes, and `warning` for a lint
 * @returns the diagnostic
 *
 * @internal
 */
export function report(
  text: string, code: string, range: JqRange | undefined, message: string,
  options: { suggestions?: string[]; fixes?: QueryFix[]; warning?: boolean } = {},
): QueryError {
  return {
    code,
    fixes: options.fixes ?? [],
    message,
    severity: options.warning === true ? variant("warning", null) : variant("error", null),
    span: range === undefined ? none : some(toQuerySpan(text, range.from, range.to)),
    suggestions: options.suggestions ?? [],
  };
}

/**
 * A fix of one edit.
 *
 * @param label - what the fix does
 * @param from - where the replaced text starts
 * @param to - where it ends
 * @param insert - the new text
 * @returns the fix
 *
 * @internal
 */
export function edit(label: string, from: number, to: number, insert: string): QueryFix {
  return { edits: [{ insert, length: BigInt(to - from), offset: BigInt(from) }], label };
}

/**
 * The edit distance between two names: insertions, deletions and
 * substitutions of UTF-16 code units.
 *
 * @internal
 */
export function distance(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      current[j] = Math.min(previous[j]! + 1, current[j - 1]! + 1, previous[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    previous = current;
  }
  return previous[b.length]!;
}

/**
 * The names closest to a misspelt one: within `max(2, ⌊length / 3⌋)` edits,
 * or containing it, or contained in it, nearest first, then in the order
 * given.
 *
 * @param name - the name as written
 * @param candidates - the names it could have meant
 * @returns up to three suggestions
 *
 * @internal
 */
export function closest(name: string, candidates: Iterable<string>): string[] {
  const limit = Math.max(2, Math.floor(name.length / 3));
  const scored: { candidate: string; score: number; order: number }[] = [];
  let order = 0;
  for (const candidate of candidates) {
    const d = distance(name.toLowerCase(), candidate.toLowerCase());
    const related = name.length >= 3 && (candidate.includes(name) || name.includes(candidate));
    if (d <= limit || related) scored.push({ candidate, score: related ? Math.min(d, limit) : d, order: order++ });
    else order++;
  }
  scored.sort((x, y) => x.score - y.score || x.order - y.order);
  return scored.slice(0, 3).map(s => s.candidate);
}

/**
 * Lists names in a sentence: `a`, `a and b`, `a, b and c`.
 *
 * @internal
 */
export function listWords(names: readonly string[]): string {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** "a" or "an" before a type's name. */
function article(word: string): string {
  return /^[AEIOU]/i.test(word) ? "an" : "a";
}

/** The sentences, by situation. @internal */
export const MESSAGES = {
  unknownField: (field: string, type: string, suggestion?: string) =>
    `unknown_field: ${field} is not a field of ${type}.${suggestion === undefined ? "" : ` Did you mean ${suggestion}?`}`,
  unknownDataset: (field: string, suggestion?: string) =>
    `unknown_field: ${field} is not a dataset in this workspace.${suggestion === undefined ? "" : ` Did you mean ${suggestion}?`}`,
  unknownPayloadField: (field: string, suggestion?: string) =>
    `unknown_field: ${field} is not a field of any case of this variant.${suggestion === undefined ? "" : ` Did you mean ${suggestion}?`}`,
  unknownVariantField: (field: string, path: string) =>
    `unknown_field: ${field} is not a field of ${path}: a variant reads as {type, value}.`,
  unknownCase: (path: string, name: string, cases: readonly string[], suggestion?: string) => suggestion === undefined
    ? `unknown_case: ${path} has no case ${name}; its cases are ${listWords(cases)}.`
    : `unknown_case: ${path} has no case ${name}. Did you mean ${suggestion}?`,
  unknownType: (name: string, names: readonly string[], suggestion?: string) => suggestion === undefined
    ? `unknown_case: type gives ${listWords(names.map(n => `"${n}"`))}, never ${name}.`
    : `unknown_case: type never gives ${name}. Did you mean ${suggestion}?`,
  unknownFunction: (name: string, arity: number, suggestion?: string) =>
    `unknown_function: ${name}/${arity} is not a builtin or a def.${suggestion === undefined ? "" : ` Did you mean ${suggestion}?`}`,
  unknownVariable: (name: string) => `unknown_function: $${name} is not bound here.`,
  unknownLabel: (name: string) => `unknown_function: there is no label $${name} around this break.`,
  arity: (name: string, arities: readonly number[], given: number) =>
    `arity: ${name} takes ${listWords(arities.map(String))} argument${arities.length === 1 && arities[0] === 1 ? "" : "s"}, not ${given}.`,
  notAField: (field: string, type: string) => `type_mismatch: ${field} reads a field, but its input is ${type}.`,
  notIterable: (form: string, type: string) => `not_iterable: ${form} needs an array; its input is ${type}.`,
  notIterableNull: (form: string, type: string) =>
    `not_iterable: ${form} needs an array; its input is ${type}. Use ${form}? to skip null.`,
  notIndexable: (target: string, type: string) => `not_indexable: ${target} is ${type}.`,
  keyType: (form: string, key: string, keyText: string, given: string) =>
    `type_mismatch: ${form} needs ${article(key)} ${key} key; ${keyText} is ${given}.`,
  mutableKey: (keyText: string, given: string) => `type_mismatch: ${keyText} is ${given}, and a dict's keys must be immutable.`,
  sliceBound: (given: string) => `type_mismatch: .[a:b] needs Integer bounds, got ${given}.`,
  sliceUpdate: (form: string, given: string) => `type_mismatch: ${form} is updated with an array, not ${given}.`,
  stringSlice: (form: string) => `type_mismatch: ${form} cannot update part of a string; update the whole string.`,
  updateKey: (text: string) => `unsupported: ${text} gives more or fewer than one value; an update's keys and bounds give one each.`,
  walkUpdate: (path: string, from: string, to: string) =>
    `type_mismatch: an update through ${path} keeps each value's type, but here ${from} would become ${to}.`,
  structKey: (form: string) => `type_mismatch: ${form} on a struct needs a literal field name; a computed name needs a dict.`,
  compares: (op: string, left: string, right: string) => `type_mismatch: ${op} compares ${left} with ${right}.`,
  neverEqual: (op: string) => op === "=="
    ? "type_mismatch: Integer == Float is never true here."
    : "type_mismatch: Integer != Float is always true here.",
  arithmetic: (op: string, left: string, right: string) => `type_mismatch: ${left} ${op} ${right} is not defined.`,
  negate: (type: string) => `type_mismatch: - negates a number, not ${type}.`,
  wholeVariant: (path: string, type: string) =>
    `type_mismatch: ${path} is ${type}; variants read as {type, value} — compare ${path}.type with a case name.`,
  narrowFirst: (path: string, type: string, caseName: string, variantPath: string, leaf: string) =>
    `type_mismatch: ${path} is ${type} here — only the "${caseName}" case of ${variantPath} has ${leaf}. Narrow first with select(${variantPath}.type == "${caseName}").`,
  input: (name: string, expected: string, given: string) => `type_mismatch: ${name} needs ${expected}; its input is ${given}.`,
  dateAsString: (name: string) =>
    `type_mismatch: ${name} needs a string; its input is DateTime. Compare its parts (year == 2026 and month == 9), or its text (todate | ${name}(…)).`,
  argument: (name: string, position: string, expected: string, given: string) =>
    `type_mismatch: ${name}'s ${position} argument must be ${expected}, not ${given}.`,
  runArgument: (name: string, element: string, given: string, wrapped: string) =>
    `type_mismatch: ${name} takes an array as a run of elements, which must be ${element}, not ${given}. To find one element, wrap it: ${wrapped}.`,
  literalArgument: (name: string, position: string, expected: string) =>
    `type_mismatch: ${name}'s ${position} argument must be ${expected}, written in the query.`,
  isoDate: (value: string) => `type_mismatch: ${value} is not an ISO-8601 date — DateTime literals are parsed at check time.`,
  emptyRange: (text: string) => `type_mismatch: ${text} yields nothing.`,
  regex: (pattern: string, reason: string) => `type_mismatch: ${pattern} is not an East regular expression: ${reason}.`,
  replacement: (name: string) =>
    `type_mismatch: ${name}'s replacement can interpolate only the pattern's named groups, as \\(.name).`,
  mixedDelete: (text: string) => `ambiguous_output: ${text} leaves values of different types where one type must hold them all.`,
  mixedKeys: () => "type_mismatch: an object's keys are all written as names, or all computed — a struct or a dict, not both.",
  noCommonType: (a: string, b: string) => `ambiguous_output: ${a} and ${b} have no common type.`,
  accumulator: (form: string, first: string, next: string) =>
    `cannot_infer: the accumulator of this ${form} is ${first}, then ${next}; start it with a value of the final type.`,
  recursion: (name: string) => `cannot_infer: ${name} does not settle on one type for this input. Use recurse, while or until.`,
  excluded: (name: string) => `unsupported: ${name} is excluded — queries are deterministic and have no host access.`,
  unavailable: (name: string, reason: string) => `unsupported: ${name} is not available in queries: ${reason}.`,
  notYet: (name: string) => `unsupported: ${name} is not available in queries yet.`,
  tooling: (name: string) => `unsupported: ${name} is tooling: it needs the TypeScript IR printers, which queries do not have yet.`,
  wholeRoot: (names: readonly string[]) =>
    `unsupported: reading the whole root loads every dataset — name them: ${names.slice(0, 3).map(n => `.${n}`).join(", ")}${names.length > 3 ? ", …" : ""}.`,
  asyncCall: () => "unsupported: call cannot run an async function.",
  recursiveFilter: (name: string) =>
    `unsupported: ${name} calls itself and takes a filter parameter. Use recurse, while or until.`,
  regexFlag: (flag: string) => `unsupported: regex flag "${flag}" — East regular expressions take the flags g and i.`,
  formatCode: (code: string) =>
    `unsupported: %${code} — strftime and strptime take %Y %m %d %H %M %S %b %B %a %A %F %T and %%.`,
  duplicateOutputs: (generator: string) =>
    `duplicate_outputs: select(${generator} | …) emits the row once per matching element. Use any(${generator}; …).`,
  arrayOnElement: (name: string, stream: string, type: string, collected: string) =>
    `array_builtin_on_element: ${name} needs an array, but runs here on each element of ${stream}, which is ${type}. Collect the stream first: ${collected}.`,
  duplicateKey: (key: string) => `duplicate_key: ${key} is set twice in this object; the last one wins.`,
  neverMissing: (path: string, type: string) => `never_missing: ${path} is ${type}, never null, so //= changes nothing.`,
  longRange: (text: string, count: string) =>
    `long_range: ${text} gives ${count} values; a query returns 1 000 at most by default.`,
} as const;
