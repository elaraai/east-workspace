#ifndef EAST_TYPE_OF_TYPE_H
#define EAST_TYPE_OF_TYPE_H

#include "types.h"
#include "values.h"
#include "ir.h"

/*
 * Type descriptors for East's homoiconic type system.
 *
 * East types and IR nodes are themselves East values (variants).
 * These type descriptors allow JSON (de)serialization of types and IR:
 *
 *   EastValue *ir_val = east_json_decode(json, east_ir_type);
 *   IRNode *ir = east_ir_from_value(ir_val);
 *
 * Call east_type_of_type_init() once before using these globals.
 */

// Type descriptors (initialized by east_type_of_type_init)
extern EAST_DATA EastType *east_type_type;          // Recursive variant: 19 type cases
extern EAST_DATA EastType *east_literal_value_type; // Variant: 7 literal value cases
extern EAST_DATA EastType *east_ir_type;            // Recursive variant: 34 IR node cases
extern EAST_DATA EastType
    *east_ir_type_with_refs; // IRType with EastTypeType → IntegerType (for type table)

// Initialize the type descriptors. Call once at startup.
void east_type_of_type_init(void);

// Free the type descriptors. Called by east_type_registry_clear().
void east_type_of_type_free(void);

// Convert decoded EastTypeType variant value -> EastType*
EastType *east_type_from_value(EastValue *value);

// Convert EastType* -> EastTypeType variant value
EastValue *east_type_to_value(EastType *type);

// Convert decoded IRType variant value -> IRNode*
IRNode *east_ir_from_value(EastValue *value);

// Source map: array of location stacks for loc_id → location resolution.
typedef struct EastSourceMap {
    EastLocation **stacks; // stacks[i] = array of EastLocation frames
    size_t *stack_counts;  // stack_counts[i] = number of frames in stack i
    size_t num_stacks;     // total number of stacks (including sentinel 0)
} EastSourceMap;

// Free a source map's contents (stacks, stack_counts, filenames).
void east_source_map_free(EastSourceMap *sm);

// Resolve a loc_id to EastLocation using a source map.
// Returns the location stack and count. Does NOT allocate — pointers
// into the source map are returned directly. Returns NULL if loc_id
// is 0 or out of range.
const EastLocation *east_source_map_resolve(const EastSourceMap *sm, int64_t loc_id,
                                            size_t *out_count);

#endif
