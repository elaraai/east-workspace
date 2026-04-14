/* Debug: trace beast2 encode/decode of a closure with 1 capture.
 * Builds IR from JSON just like the compliance test does, then encodes + decodes. */
#include "east/types.h"
#include "east/values.h"
#include "east/ir.h"
#include "east/compiler.h"
#include "east/serialization.h"
#include "east/type_of_type.h"
#include "east/builtins.h"
#include "east/platform.h"
#include <stdio.h>
#include <stdlib.h>

int main(void) {
    east_type_of_type_init();

    /* Build a closure IR: (captures=[x:Integer], params=[], body=return x)
     * as an EastValue variant tree (same as what convert_ir produces). */

    /* Build the Variable for capture 'x': Variant("Variable", {type, loc_id, name, mutable, captured}) */
    EastType *var_type = NULL;
    /* Find the Variable case in east_ir_type */
    EastType *ir_inner = east_ir_type->data.recursive.node;  /* the variant */

    printf("IR variant has %zu cases\n", ir_inner->data.variant.num_cases);
    for (size_t i = 0; i < ir_inner->data.variant.num_cases; i++) {
        printf("  case[%zu] = '%s'\n", i, ir_inner->data.variant.cases[i].name);
    }

    /* Find the Function case struct type */
    size_t fn_case_idx = 0;
    for (size_t i = 0; i < ir_inner->data.variant.num_cases; i++) {
        if (strcmp(ir_inner->data.variant.cases[i].name, "Function") == 0) {
            fn_case_idx = i;
            break;
        }
    }
    EastType *fn_struct_type = ir_inner->data.variant.cases[fn_case_idx].type;
    printf("\nFunction struct has %zu fields:\n", fn_struct_type->data.struct_.num_fields);
    for (size_t i = 0; i < fn_struct_type->data.struct_.num_fields; i++) {
        char buf[128];
        east_type_print(fn_struct_type->data.struct_.fields[i].type, buf, sizeof(buf));
        printf("  field[%zu] = '%s' : %s (kind=%d)\n", i,
               fn_struct_type->data.struct_.fields[i].name, buf,
               fn_struct_type->data.struct_.fields[i].type->kind);
    }

    /* Check captures field type */
    EastType *captures_field_type = fn_struct_type->data.struct_.fields[2].type;
    printf("\nCaptures field type kind=%d\n", captures_field_type->kind);
    if (captures_field_type->kind == EAST_TYPE_ARRAY) {
        printf("  -> EAST_TYPE_ARRAY (mutable, will use value table) ✓\n");
        printf("  element kind=%d\n", captures_field_type->data.element->kind);
    } else {
        printf("  -> NOT ARRAY! kind=%d ✗\n", captures_field_type->kind);
    }

    east_type_registry_clear();
    return 0;
}
