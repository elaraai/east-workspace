#ifndef EAST_IR_NORMALIZE_H
#define EAST_IR_NORMALIZE_H

#include "values.h"
#include "type_of_type.h"

/*
 * IR normalization — the round-trip equality contract, implemented once.
 *
 * Two IR values built for the same program by different authors (the
 * TypeScript builder, the python builder, a printed-and-rebuilt program)
 * differ only in what the builder chose freely: the loc_ids indexing its
 * own source map, the names it minted for variables and labels, the ids
 * it minted for recursive types, and the order it discovered captures in.
 * east_ir_normalize rewrites an IR value (an IRType variant) into the one
 * canonical form every author converges on:
 *
 *   - every loc_id (nodes and labels) is 0 — locations are not structure;
 *   - variables are renamed `_N` and labels `_N` in the order the
 *     TypeScript lowering (ast_to_ir) mints them — a Let's value before its
 *     variable, a function's parameters at entry, a match case's variable
 *     before its body, a loop's label then its value/key variables then its
 *     body, a try's body then its message/stack variables then the catch
 *     and finally bodies — so a TypeScript-built program normalizes to
 *     itself, loc_ids aside;
 *   - every Function's `captures` is recomputed as the outer variables its
 *     body reads, in first-resolution order (TypeScript's Set order), and
 *     every Variable's `captured` flag is whether some function captures it;
 *   - recursive type ids are renumbered per type value, wrappers in
 *     pre-order from 0, so equal types encode equally.
 *
 * The result is a fresh retained value; the input is not modified.
 */
EastValue *east_ir_normalize(EastValue *ir);

/* The first structural difference between two values, as a path from the
 * root — `$(Function).body(Block).statements[2](Let).type` reads: the root
 * is a Function whose payload field `body` is a Block whose statement 2 is a
 * Let whose `type` differs — or NULL when they are equal. The caller frees
 * the string. Structs compare field by field (names and values), variants
 * by case then payload, arrays element by element; everything else by
 * east_value_equal. */
char *east_value_diff_path(EastValue *a, EastValue *b);

/* The source-map value `{stacks: [[{filename, line, column}]]}` of a map
 * (a NULL or empty map gives one empty stack list), and the type of the
 * JSON IR wrapper `{ir, source_map}` the TypeScript export writes. Types
 * are interned and immortal; values are retained for the caller. */
EastValue *east_source_map_to_value(const EastSourceMap *sm);
EastType *east_source_map_value_type(void);
EastType *east_ir_wrapper_type(void);

#endif
