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
//
// Heap maps are reference-counted: every EastCompiledFn that resolves against
// a map holds one reference (east_compiled_fn_free drops it), so a closure
// decoded from a blob — or created while a map was current — keeps that map
// alive for as long as it can raise, however the decode's own state is torn
// down. A map embedded in another struct (ref_count 0) is never freed by
// east_source_map_release; free its contents with east_source_map_free.
typedef struct EastSourceMap {
    EastLocation **stacks; // stacks[i] = array of EastLocation frames
    size_t *stack_counts;  // stack_counts[i] = number of frames in stack i
    size_t num_stacks;     // total number of stacks (including sentinel 0)
    int ref_count;         // holders of a heap map; 0 = embedded (not refcounted)
} EastSourceMap;

// A fresh, empty heap map holding one reference (the caller's). NULL on OOM.
EastSourceMap *east_source_map_new(void);

// Take / drop one reference on a heap map. NULL and embedded (ref_count 0)
// maps are no-ops; the last release frees the contents and the struct.
void east_source_map_retain(EastSourceMap *sm);
void east_source_map_release(EastSourceMap *sm);

// Free a source map's contents (stacks, stack_counts, filenames) in place,
// leaving the struct itself — for embedded instances and the last release.
void east_source_map_free(EastSourceMap *sm);

// Resolve a loc_id to EastLocation using a source map.
// Returns the location stack and count. Does NOT allocate — pointers
// into the source map are returned directly. Returns NULL if loc_id
// is 0 or out of range.
const EastLocation *east_source_map_resolve(const EastSourceMap *sm, int64_t loc_id,
                                            size_t *out_count);

#endif
