/*
 * The range builtins (#1616) — `DictRange`, `DictPrefix`, `SetRange` and
 * `SetPrefix` — the port of libs/east/src/compile/builtins/key_range.ts and
 * the evaluators it serves. One copy for a Dict and a Set: each registers its
 * two builtins over these. Private to the builtins.
 */
#ifndef EAST_BUILTINS_KEY_RANGE_H
#define EAST_BUILTINS_KEY_RANGE_H

#include "east/builtins.h"
#include "east/types.h"

/* A range builtin, made from its type parameters: `key` is the Dict's key
 * type or the Set's element type (K), `from` and `to` its bounds' types (F
 * and T). Its impl takes (collection, from: Option<F>, to: Option<T>) and
 * returns a new collection, never frozen, of the entries from the first key at
 * or past `from` up to the first at or past `to`; an end that is `none` is the
 * collection's own.
 *
 * A bound's type is a type parameter, so an IR can name one that is no leading
 * part of the key: the impl refuses it before it reads a bound, `from` first,
 * in the words every runtime refuses in (east/key_bound.h). */
BuiltinImpl east_key_range_builtin(EastType *key, EastType *from, EastType *to);

/* A prefix builtin, made from K and the prefix's type P. Its impl takes
 * (collection, prefix: P) and returns a new collection, never frozen, of the
 * entries whose key equals the prefix on every field it gives: from the first
 * key at it up to the first past it. Refused as a range's bound is, and on any
 * key that is not a struct. */
BuiltinImpl east_key_prefix_builtin(EastType *key, EastType *prefix);

#endif
