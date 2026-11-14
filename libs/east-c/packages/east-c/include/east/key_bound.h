#ifndef EAST_KEY_BOUND_H
#define EAST_KEY_BOUND_H

/*
 * A bound of a key range (#1616, D2): a leading part of a Dict's key or a
 * Set's element.
 *
 * A key's fields, in the key type's order and through nested structs, are its
 * leaves: `{ press, day, job }` has three, and an index's `{ ik: { on, key },
 * k }` has `on`'s, then `key`, then `k`'s. A field that is not a struct is one
 * leaf, whatever it holds. Struct keys compare field by field in declaration
 * order, so the leaves in order are the key's sort order.
 *
 * A bound gives the first leaves and stops. Its type is the key's type cut
 * short: for a struct key, a struct of its first fields in order, each of the
 * key's own type but the last, which may be cut short the same way; for any
 * other key, the key's type.
 *
 * A key is at or past a bound when its first leaves, compared in order by
 * East's order for each, are greater than or equal to the bound's. That test
 * is false, then true, over the keys in order, so a bound names one row of a
 * sorted collection and a pair of them one run of rows.
 *
 * One copy of the rule for C: the range builtins and the pager's row range
 * both read it here. TypeScript's is `key_bound.ts`, and the two refuse in the
 * same words.
 */

#include "east/types.h"
#include "east/values.h"
#include <stdbool.h>

/* Which bound a refusal names: a range's `from` or `to`, or a prefix. */
typedef enum {
    EAST_KEY_BOUND_FROM,
    EAST_KEY_BOUND_TO,
    EAST_KEY_BOUND_PREFIX,
} EastKeyBoundName;

/* Whether `bound_type` is `key_type` cut short: the key's own type, or — for a
 * struct key — a struct of its first fields in order, each of the key's own
 * type but the last, which may be cut short the same way. */
bool east_key_bound_type_ok(EastType *key_type, EastType *bound_type);

/* Why a bound's type is refused, in the words every runtime says, or NULL for
 * a type that is a leading part of the key. The caller frees the string.
 *
 * A bound's type is a type parameter of the range builtins, so an IR can name
 * one that is no leading part of the key: it is refused where the builtin is
 * made from its type parameters, and never trusted. A prefix is the first
 * fields of a struct key, so on any other key it is refused whatever its type.
 * A NULL `bound_type` is refused as no leading part. Returns NULL as well when
 * memory for the words cannot be had; a caller that must refuse checks
 * east_key_bound_type_ok. */
char *east_key_bound_refusal(EastKeyBoundName name, EastType *key_type, EastType *bound_type);

/* How a key stands to a bound: negative before it, zero at it — equal on every
 * leaf the bound gives — positive past it.
 *
 * `bound_type` is the bound's type, a leading part of the key's
 * (east_key_bound_type_ok). The walk follows the bound's fields and stops at
 * the fewest any of the three holds, so it never reads past a value's fields
 * whatever it is handed. Monotone over the keys in order, since it reads only
 * the leading leaves, which the order sorts by first. */
int east_key_bound_compare(EastValue *key, EastValue *bound, const EastType *bound_type);

#endif
