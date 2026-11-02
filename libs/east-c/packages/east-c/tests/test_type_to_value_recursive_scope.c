/*
 * Regression gate: east_type_to_value's memo (issue #83) never serves a value
 * made inside a recursive type's scope outside it.
 *
 * A value made while a recursive wrapper is in scope may hold
 * Recursive(ref(id)) back-references, which name a wrapper only within it.
 * A collection manifest's type (beast2 v5) is normalized, its wrapper ids
 * renumbered, and a reader of the manifest — the TS reference's beast2
 * decoder — refuses a ref with no wrapper around it ("Recursive type context
 * not found"). The TS reference caches only with no RecursiveType on its stack
 * (libs/east/src/type_of_type.ts).
 *
 * The type under test is Struct{x: Dict<String, P>, y: Dict<String, P>} where
 *   P = Recursive(self => Struct{name: String, parts: Dict<String, self>})
 * Interning makes P's own `parts` field the same Dict<String, P> as x and y,
 * so the Dict is first converted inside P's scope — holding ref(P) — and then
 * looked up again for y, outside it. Every ref must sit inside its wrapper,
 * before and after normalization.
 */
#include <east/east.h>
#include <east/ir_normalize.h>

#include <stdio.h>
#include <string.h>

/* Whether every Recursive(ref(id)) in a type value sits inside a Recursive(wrapper({id, …}))
 * holding it. */
static int refs_in_scope(EastValue *v, int64_t *ids, size_t depth, size_t cap)
{
    if (!v) return 1;
    if (v->kind == EAST_VAL_VARIANT) {
        EastValue *payload = v->data.variant.value;
        if (strcmp(east_variant_case_name(v), "Recursive") != 0)
            return refs_in_scope(payload, ids, depth, cap);
        EastValue *held = payload->data.variant.value;
        if (strcmp(east_variant_case_name(payload), "ref") == 0) {
            for (size_t i = 0; i < depth; i++)
                if (ids[i] == held->data.integer) return 1;
            return 0;
        }
        if (depth >= cap) return 0;
        ids[depth] = east_struct_get_field(held, "id")->data.integer;
        return refs_in_scope(east_struct_get_field(held, "inner"), ids, depth + 1, cap);
    }
    if (v->kind == EAST_VAL_STRUCT) {
        for (size_t i = 0; i < v->data.struct_.num_fields; i++)
            if (!refs_in_scope(v->data.struct_.field_values[i], ids, depth, cap)) return 0;
        return 1;
    }
    if (v->kind == EAST_VAL_ARRAY) {
        for (size_t i = 0; i < v->data.array.len; i++)
            if (!refs_in_scope(v->data.array.items[i], ids, depth, cap)) return 0;
        return 1;
    }
    return 1;
}

int main(void)
{
    int failures = 0;
    int64_t ids[16];

    east_type_of_type_init();

    /* P = Recursive(self => Struct{name: String, parts: Dict<String, self>}) */
    EastType *part = east_recursive_type_new();
    EastType *parts = east_dict_type(&east_string_type, part);
    const char *part_names[2] = {"name", "parts"};
    EastType *part_types[2] = {&east_string_type, parts};
    east_recursive_type_set(part, east_struct_type(part_names, part_types, 2));
    part = east_recursive_type_intern(part);

    /* Struct{x: Dict<String, P>, y: Dict<String, P>}: both fields, and P's own parts, the one
     * interned Dict. */
    EastType *dict = east_dict_type(&east_string_type, part);
    const char *field_names[2] = {"x", "y"};
    EastType *field_types[2] = {dict, dict};
    EastType *outer = east_struct_type(field_names, field_types, 2);

    EastValue *tv = east_type_to_value(outer);
    if (!tv) {
        printf("FAIL: east_type_to_value returned NULL\n");
        failures++;
    } else {
        if (!refs_in_scope(tv, ids, 0, 16)) {
            printf("FAIL: a Recursive(ref) outside its wrapper: a value made inside P's scope "
                   "served outside it\n");
            failures++;
        }
        EastValue *normalized = east_type_value_normalize(tv);
        if (!normalized || !refs_in_scope(normalized, ids, 0, 16)) {
            printf("FAIL: the normalized type value holds a Recursive(ref) outside its wrapper\n");
            failures++;
        }
        if (normalized) east_value_release(normalized);
        east_value_release(tv);
    }

    east_type_registry_clear();

    if (failures == 0) {
        printf("GATE PASS: east_type_to_value serves no value made inside a recursive scope "
               "outside it\n");
        return 0;
    }
    printf("GATE FAIL: %d check(s) failed\n", failures);
    return 1;
}
