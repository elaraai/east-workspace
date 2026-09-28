/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The names of the builtins a jq query can call.
 *
 * The builtins of jq 1.8 (`jq -n 'builtins'`, less its private `_`-prefixed
 * helpers) and East's additions (`devdocs/QUERY.md` §7 and §9). `not` is a
 * builtin too, but the lexer shows it as a keyword. Which of them a query may
 * use, and how each is typed, is the checker's catalog.
 *
 * @packageDocumentation
 */

/** jq 1.8's builtins, by name. */
const JQ_BUILTINS: readonly string[] = [
  "IN", "INDEX", "JOIN", "abs", "acos", "acosh", "add", "all", "any", "arrays", "ascii_downcase",
  "ascii_upcase", "asin", "asinh", "atan", "atan2", "atanh", "booleans", "bsearch", "builtins",
  "capture", "cbrt", "ceil", "combinations", "contains", "copysign", "cos", "cosh", "debug", "del",
  "delpaths", "drem", "empty", "endswith", "env", "erf", "erfc", "error", "exp", "exp10", "exp2",
  "explode", "expm1", "fabs", "fdim", "finites", "first", "flatten", "floor", "fma", "fmax", "fmin",
  "fmod", "format", "frexp", "from_entries", "fromdate", "fromdateiso8601", "fromjson", "fromstream",
  "gamma", "get_jq_origin", "get_prog_origin", "get_search_list", "getpath", "gmtime", "group_by",
  "gsub", "halt", "halt_error", "has", "have_decnum", "have_literal_numbers", "hypot", "implode",
  "in", "index", "indices", "infinite", "input", "input_filename", "input_line_number", "inputs",
  "inside", "isempty", "isfinite", "isinfinite", "isnan", "isnormal", "iterables", "j0", "j1", "jn",
  "join", "keys", "keys_unsorted", "last", "ldexp", "length", "lgamma", "lgamma_r", "limit",
  "localtime", "log", "log10", "log1p", "log2", "logb", "ltrim", "ltrimstr", "map", "map_values",
  "match", "max", "max_by", "min", "min_by", "mktime", "modf", "modulemeta", "nan", "nearbyint",
  "nextafter", "nexttoward", "normals", "not", "now", "nth", "nulls", "numbers", "objects", "path",
  "paths", "pick", "pow", "range", "recurse", "remainder", "repeat", "reverse", "rindex", "rint",
  "round", "rtrim", "rtrimstr", "scalars", "scalb", "scalbln", "scan", "select", "setpath",
  "significand", "sin", "sinh", "skip", "sort", "sort_by", "split", "splits", "sqrt", "startswith",
  "stderr", "strflocaltime", "strftime", "strings", "strptime", "sub", "tan", "tanh", "test",
  "tgamma", "to_entries", "toboolean", "todate", "todateiso8601", "tojson", "tonumber", "tostream",
  "tostring", "transpose", "trim", "trimstr", "trunc", "truncate_stream", "type", "unique",
  "unique_by", "until", "utf8bytelength", "values", "walk", "while", "with_entries", "y0", "y1", "yn",
];

/** East's additions: calling a function value, the DateTime parts and
 *  arithmetic, and the tooling-only inspection of function values. */
const EAST_BUILTINS: readonly string[] = [
  "call", "calls", "captures", "datetime_add", "datetime_diff", "day", "epoch_ms", "hour",
  "millisecond", "minute", "month", "second", "signature", "source", "weekday", "year",
];

const BUILTIN_NAMES: ReadonlySet<string> = new Set([...JQ_BUILTINS, ...EAST_BUILTINS]);

/**
 * Whether a name is a builtin a jq query can call: one of jq 1.8's, or one of
 * East's additions.
 *
 * @param name - the name, as written in the query
 * @returns `true` for a builtin's name
 *
 * @example
 * ```ts
 * isJqBuiltin("select");   // true
 * isJqBuiltin("revenue");  // false: a `def` could name it
 * ```
 */
export function isJqBuiltin(name: string): boolean {
  return BUILTIN_NAMES.has(name);
}
