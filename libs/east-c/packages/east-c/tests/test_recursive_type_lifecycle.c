/*
 * Guards the ownership model for EAST_TYPE_RECURSIVE wrappers: like every
 * other constructed type they are arena-allocated and immortal
 * (ref_count == -1), reclaimed wholesale by east_type_registry_clear().
 * There is no per-wrapper cleanup path — east_type_retain/east_type_release
 * are no-ops on them — so dropping every reference and clearing the registry
 * must leave no leak, and no code path may ever route an arena-interior
 * wrapper pointer through free().
 *
 * Exercised paths:
 *
 *   - east_recursive_type_new + east_recursive_type_set building a
 *     self-referential Variant (a linked list), plus interning: a second,
 *     structurally identical wrapper must intern to the same canonical;
 *   - the type_of_type decode path: east_type_to_value /
 *     east_type_from_value round-trips the recursive type through its
 *     EastTypeType value form (the wrapper({id, inner}) decode);
 *   - the beast2 type-table decode path: east_beast2_encode_full +
 *     east_beast2_extract_type / east_beast2_decode_auto round-trip a value
 *     of the recursive type, rebuilding BEAST2_TAG_RECURSIVE table entries.
 *
 * Run under ASan/LSan (run_leak_check.sh's build-asan configuration): a leak
 * (a missed release), an invalid free (an arena pointer reaching free()), or
 * a double free fails the gate.
 */
#include <east/east.h>

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

/* List = Recursive(self => Variant{ cons: Struct{head: Integer, tail: self},
 *                                   nil: Null })
 * Returns the canonical (interned) wrapper. */
static EastType *make_list_type(void)
{
    EastType *rec = east_recursive_type_new();
    const char *field_names[2] = {"head", "tail"};
    EastType *field_types[2] = {&east_integer_type, rec};
    EastType *cons = east_struct_type(field_names, field_types, 2);
    const char *case_names[2] = {"nil", "cons"};
    EastType *case_types[2] = {&east_null_type, cons};
    EastType *inner = east_variant_type(case_names, case_types, 2);
    east_recursive_type_set(rec, inner);
    return east_recursive_type_intern(rec);
}

/* cons{head: <head>, tail: <tail>} as a value of the List type. Returns
 * ref=1, transferring to the caller. */
static EastValue *make_cons(EastType *list, int64_t head, EastValue *tail)
{
    EastValue *h = east_integer(head); /* ref=1 */
    const char *names[2] = {"head", "tail"};
    EastValue *vals[2] = {h, tail};
    EastValue *payload = east_struct_new(names, vals, 2, NULL); /* retains both */
    east_value_release(h);
    EastValue *cell = east_variant_new("cons", payload, list); /* retains payload */
    east_value_release(payload);
    return cell;
}

int main(void)
{
    int failures = 0;

    east_type_of_type_init();

    /* Build + intern. The first build IS the canonical. */
    EastType *list = make_list_type();
    if (!list || list->kind != EAST_TYPE_RECURSIVE) {
        printf("FAIL build: expected a Recursive wrapper\n");
        return 1;
    }
    if (list->ref_count != -1) {
        printf("FAIL build: wrapper ref_count %d != -1 (arena-immortal)\n", list->ref_count);
        failures++;
    }

    /* A structurally identical second build interns to the same canonical. */
    EastType *list2 = make_list_type();
    if (list2 != list) {
        printf("FAIL intern: second build did not return the canonical wrapper\n");
        failures++;
    }

    /* retain/release (and over-release) are no-ops on the immortal wrapper. */
    east_type_retain(list);
    east_type_release(list);
    east_type_release(list);
    if (list->ref_count != -1) {
        printf("FAIL refcount: retain/release not a no-op (ref_count %d)\n", list->ref_count);
        failures++;
    }

    /* #472: the shared nullary-case value a variant type hands out is owned
     * by the (arena-immortal) type and reclaimed only with the arena, so any
     * retain/release traffic on the type must leave it live and mintable.
     * east_type_release used to carry a refcount-zero path that would have
     * free()d the shared value (and the arena-interior type) out from under
     * every holder. Shared minting needs the variant node itself — a
     * Recursive wrapper and its inner node are different `type` values, so
     * the wrapper never shares. */
    EastType *inner_variant = list->data.recursive.node;
    EastValue *shared_nil = east_variant_new("nil", east_null(), inner_variant);
    if (!shared_nil || shared_nil->ref_count != -1) {
        printf("FAIL shared case: expected the immortal shared `nil` value\n");
        failures++;
    } else {
        EastValue *again = east_variant_new("nil", east_null(), inner_variant);
        if (again != shared_nil) {
            printf("FAIL shared case: second mint did not return the shared value\n");
            failures++;
        }
        east_value_release(again);
        east_value_release(shared_nil); /* no-ops — the value is immortal */
        east_type_release(inner_variant);
        east_type_release(inner_variant); /* over-release: still a no-op */
        EastValue *after = east_variant_new("nil", east_null(), inner_variant);
        if (after != shared_nil || strcmp(east_variant_case_name(after), "nil") != 0) {
            printf("FAIL shared case: type release traffic disturbed the shared value\n");
            failures++;
        }
    }

    /* type_of_type round trip: List -> EastTypeType value -> List. */
    EastValue *tv = east_type_to_value(list);
    if (!tv) {
        printf("FAIL type_of_type: east_type_to_value returned NULL\n");
        failures++;
    } else {
        EastType *decoded = east_type_from_value(tv);
        if (!decoded || !east_type_equal(decoded, list)) {
            printf("FAIL type_of_type: decoded type not equal to original\n");
            failures++;
        }
        east_type_release(decoded);
        east_value_release(tv);
    }

    /* beast2-full round trip of cons{head: 42, tail: cons{head: 7, tail: nil}}.
     * The full encoding embeds the type table, so decode rebuilds the
     * recursive type from BEAST2_TAG_RECURSIVE entries. */
    EastValue *nil_payload = east_null();
    EastValue *nil = east_variant_new("nil", nil_payload, list);
    east_value_release(nil_payload);
    EastValue *tail = make_cons(list, 7, nil);
    east_value_release(nil);
    EastValue *cell = make_cons(list, 42, tail);
    east_value_release(tail);

    ByteBuffer *buf = east_beast2_encode_full(cell, list);
    if (!buf) {
        printf("FAIL beast2: encode_full returned NULL\n");
        failures++;
    } else {
        EastType *extracted = east_beast2_extract_type(buf->data, buf->len);
        if (!extracted || !east_type_equal(extracted, list)) {
            printf("FAIL beast2: extracted type not equal to original\n");
            failures++;
        }
        east_type_release(extracted);

        EastValue *decoded = east_beast2_decode_auto(buf->data, buf->len);
        if (!decoded || east_value_compare(decoded, cell) != 0) {
            printf("FAIL beast2: decoded value not equal to original\n");
            failures++;
        }
        east_value_release(decoded);
        byte_buffer_free(buf);
    }
    east_value_release(cell);

    /* Drop everything and sweep the arena. ASan/LSan is the oracle: a leaked
     * wrapper or a free() of an arena-interior pointer fails the gate. */
    east_type_registry_clear();

    if (failures == 0) {
        printf("GATE PASS: recursive wrappers are arena-immortal end-to-end "
               "(new + set + intern + type_of_type and beast2 type-table decode "
               "+ registry clear, no individual frees)\n");
        return 0;
    }
    printf("GATE FAIL: %d check(s) failed\n", failures);
    return 1;
}
