/*
 * Gate for issue #423: the live footprint of an EastValue.
 *
 * A row of a real MultiValue table that encodes to 9.7 KB as beast2 occupied
 * 464 KB live, because every value — an int64 included — paid for one 104-byte
 * one-size-fits-all node plus whatever it allocated alongside. Four things
 * changed, and each is asserted here:
 *
 *   B  a struct instance borrows its field names from its (interned, immortal)
 *      StructType instead of strdup'ing them per instance
 *   C  a nullary variant case of a typed variant — `none` above all — is one
 *      shared immortal value, not a fresh node per occurrence
 *   D  strings up to EAST_STRING_INLINE_CAP live inside the node, in union
 *      space the string arm was leaving dead
 *   E  a node is sized by its kind: a leaf stops at its own union arm and skips
 *      the GC header entirely, so a scalar is 16 bytes rather than 104
 *
 * The footprint checks read east_value_slab_stats().bytes_live plus the
 * malloc'd side allocations we can account for exactly, so they assert the
 * representation rather than process RSS — deterministic across platforms and
 * allocators. scripts/profile_value_memory.c is the RSS-based companion that
 * reproduces the issue's own methodology.
 *
 * Run under ASan/LSan (scripts/run_leak_check.sh's build-asan config): the
 * shared-none cache and the borrowed field names are both new lifetime rules,
 * and freed slab slots are now poisoned so a use-after-free on inline string
 * bytes is caught rather than silently reading a recycled slot.
 */
#include <east/east.h>
#include <east/value_slab.h>

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static int failures = 0;

static void check(bool ok, const char *what)
{
    if (!ok) {
        printf("FAIL: %s\n", what);
        failures++;
    }
}

static void check_size(EastValueKind kind, size_t expect, const char *what)
{
    size_t got = east_value_alloc_size(kind);
    if (got != expect) {
        printf("FAIL: %s — %zu bytes, expected %zu\n", what, got, expect);
        failures++;
    }
}

/* Bytes the slab is holding for live values right now. */
static size_t live_bytes(void)
{
    return east_value_slab_stats().bytes_live;
}

static size_t live_nodes(void)
{
    return east_value_slab_stats().live;
}

/* ---- E: a node costs what its kind needs ------------------------------- */

static void test_size_classes(void)
{
    /* The leaf kinds stop at their own union arm; only the kinds that can sit
     * in a reference cycle carry the trailing GC header. The byte counts are
     * pinned for the 64-bit targets the CI matrix covers; a 32-bit build (WASM)
     * lands smaller, so only the invariants below apply there. */
    if (sizeof(void *) == 8) {
        check_size(EAST_VAL_INTEGER, 16, "Integer node");
        check_size(EAST_VAL_FLOAT, 16, "Float node");
        check_size(EAST_VAL_BOOLEAN, 16, "Boolean node");
        check_size(EAST_VAL_DATETIME, 16, "DateTime node");
        check_size(EAST_VAL_BLOB, 24, "Blob node");
        check_size(EAST_VAL_VECTOR, 32, "Vector node");
        check_size(EAST_VAL_MATRIX, 40, "Matrix node");
        check_size(EAST_VAL_STRING, 72, "String node");
        check(sizeof(EastValue) <= 104, "sizeof(EastValue) must not grow past 104");
    }
    check_size(EAST_VAL_ARRAY, sizeof(EastValue), "Array node");
    check_size(EAST_VAL_DICT, sizeof(EastValue), "Dict node");

    /* Every leaf must come in under the full struct — that is the whole point. */
    const EastValueKind leaves[] = {EAST_VAL_NULL,  EAST_VAL_BOOLEAN, EAST_VAL_INTEGER,
                                    EAST_VAL_FLOAT, EAST_VAL_STRING,  EAST_VAL_DATETIME,
                                    EAST_VAL_BLOB,  EAST_VAL_VECTOR,  EAST_VAL_MATRIX};
    for (size_t i = 0; i < sizeof(leaves) / sizeof(*leaves); i++) {
        check(east_value_alloc_size(leaves[i]) < sizeof(EastValue),
              "a leaf node must be smaller than the full struct");
        check(east_value_alloc_size(leaves[i]) >= 2 * sizeof(void *),
              "every size class must hold the slab free-list overlay");
        check(east_value_alloc_size(leaves[i]) % 8 == 0, "size classes are 8-byte granular");
    }

    check(!east_value_kind_has_gc(EAST_VAL_INTEGER), "Integer is not a GC kind");
    check(!east_value_kind_has_gc(EAST_VAL_STRING), "String is not a GC kind");
    check(east_value_kind_has_gc(EAST_VAL_ARRAY), "Array is a GC kind");
    check(east_value_kind_has_gc(EAST_VAL_VARIANT), "Variant is a GC kind");

    /* And the sizing is what the slab actually charges. */
    size_t before = live_bytes();
    EastValue *i = east_integer(42);
    check(live_bytes() - before == east_value_alloc_size(EAST_VAL_INTEGER),
          "an Integer costs exactly its size class in slab bytes");
    east_value_release(i);
    check(live_bytes() == before, "releasing it gives the bytes back");
}

/* ---- D: short strings need no second allocation ------------------------ */

static void test_inline_strings(void)
{
    /* Boundary: the last inline length, and the first that spills to the heap. */
    char at_cap[EAST_STRING_INLINE_CAP + 1];
    memset(at_cap, 'x', EAST_STRING_INLINE_CAP);
    at_cap[EAST_STRING_INLINE_CAP] = '\0';
    char over_cap[EAST_STRING_INLINE_CAP + 2];
    memset(over_cap, 'y', EAST_STRING_INLINE_CAP + 1);
    over_cap[EAST_STRING_INLINE_CAP + 1] = '\0';

    struct {
        const char *text;
        bool inline_expected;
    } cases[] = {
        {"", true}, {"0.00", true}, {"/", true}, {at_cap, true}, {over_cap, false},
    };

    for (size_t c = 0; c < sizeof(cases) / sizeof(*cases); c++) {
        EastValue *s = east_string(cases[c].text);
        bool is_inline = s->data.string.data == s->data.string.inline_data;
        check(is_inline == cases[c].inline_expected,
              cases[c].inline_expected ? "string of this length should be inline"
                                       : "string past the cap should be heap-allocated");
        check(s->data.string.len == strlen(cases[c].text), "inline string keeps its length");
        check(strcmp(s->data.string.data, cases[c].text) == 0, "inline string keeps its bytes");
        east_value_release(s);
    }

    /* An inline string and a heap string of the same content are still equal
     * and still order together — nothing may key on where the bytes live. */
    char long_a[80];
    memset(long_a, 'z', sizeof(long_a) - 1);
    long_a[sizeof(long_a) - 1] = '\0';
    EastValue *heap1 = east_string(long_a);
    EastValue *heap2 = east_string(long_a);
    EastValue *short1 = east_string("abc");
    EastValue *short2 = east_string("abc");
    check(east_value_equal(heap1, heap2), "two heap strings compare equal");
    check(east_value_equal(short1, short2), "two inline strings compare equal");
    check(east_value_compare(short1, short2) == 0, "two inline strings order equal");
    check(!east_value_equal(short1, heap1), "different content is not equal");
    east_value_release(heap1);
    east_value_release(heap2);
    east_value_release(short1);
    east_value_release(short2);

    /* east_string_len must accept embedded NULs and non-NUL-terminated input. */
    EastValue *embedded = east_string_len("a\0b", 3);
    check(embedded->data.string.len == 3, "east_string_len keeps an embedded NUL");
    check(memcmp(embedded->data.string.data, "a\0b", 3) == 0, "embedded NUL bytes survive");
    east_value_release(embedded);
}

/* ---- C: `none` is one shared value ------------------------------------- */

static EastType *option_of(EastType *inner)
{
    const char *names[2] = {"none", "some"};
    EastType *types[2] = {&east_null_type, inner};
    return east_variant_type(names, types, 2);
}

static void test_shared_none(void)
{
    EastType *opt_int = option_of(&east_integer_type);
    EastType *opt_str = option_of(&east_string_type);

    size_t before_nodes = live_nodes();
    EastValue *n1 = east_variant_new("none", east_null(), opt_int);
    EastValue *n2 = east_variant_new("none", east_null(), opt_int);
    EastValue *n3 = east_variant_new_idx(0, east_null(), opt_int);
    check(n1 == n2 && n2 == n3, "every `none` of one OptionType is the same value");
    check(live_nodes() == before_nodes, "a shared `none` allocates no slab node");
    check(n1->ref_count == -1, "the shared `none` is immortal");
    check(!east_value_is_tracked(n1), "the shared `none` is never GC-tracked");
    check(strcmp(east_variant_case_name(n1), "none") == 0, "the shared `none` keeps its tag");
    check(n1->data.variant.type == opt_int, "the shared `none` keeps its own type");

    /* Different OptionTypes must NOT collapse: the printer and the JSON encoder
     * resolve the payload type by case index against this very type. */
    EastValue *other = east_variant_new("none", east_null(), opt_str);
    check(other != n1, "`none` of a different OptionType is a different value");
    check(other->data.variant.type == opt_str, "and carries that type");

    /* Retain/release are no-ops, so ownership at the call sites is unchanged. */
    east_value_retain(n1);
    east_value_release(n1);
    east_value_release(n1);
    check(n1->ref_count == -1, "retain/release leave the immortal untouched");
    check(east_variant_new("none", east_null(), opt_int) == n1, "and it is still cached");

    /* A carried payload is never shared, whatever the case. */
    EastValue *payload = east_integer(7);
    EastValue *some1 = east_variant_new("some", payload, opt_int);
    EastValue *some2 = east_variant_new("some", payload, opt_int);
    check(some1 != some2, "`some` values are not shared");
    east_value_release(some1);
    east_value_release(some2);
    east_value_release(payload);

    /* An untyped variant must stay unshared: retype_patch rewrites exactly
     * those in place, and would otherwise corrupt a shared value process-wide. */
    EastValue *untyped1 = east_variant_new("none", east_null(), NULL);
    EastValue *untyped2 = east_variant_new("none", east_null(), NULL);
    check(untyped1 != untyped2, "untyped `none` values are never shared");
    east_value_release(untyped1);
    east_value_release(untyped2);

    /* A whole array of them costs one pointer each. */
    EastType *arr_type = east_array_type(opt_int);
    EastValue *arr = east_array_new(arr_type->data.element);
    size_t before_bytes = live_bytes();
    for (int i = 0; i < 1000; i++)
        east_array_push(arr, east_variant_new("none", east_null(), opt_int));
    check(live_bytes() == before_bytes, "1000 `none` elements add no slab bytes");
    check(east_array_len(arr) == 1000, "and the array still holds them all");
    east_value_release(arr);
}

/* ---- B: struct field names come from the type -------------------------- */

static void test_struct_field_names(void)
{
    const char *names[3] = {"alpha", "beta", "gamma"};
    EastType *types[3] = {&east_integer_type, &east_string_type, &east_float_type};
    EastType *st = east_struct_type(names, types, 3);

    EastValue *fields[3] = {east_integer(1), east_string("two"), east_float(3.0)};
    EastValue *s = east_struct_new(names, fields, 3, st);

    check(s->data.struct_.field_names == NULL, "a typed struct carries no name copies");
    for (size_t i = 0; i < 3; i++) {
        check(strcmp(east_struct_field_name(s, i), names[i]) == 0,
              "borrowed names read back correctly");
        check(east_struct_field_name(s, i) == st->data.struct_.fields[i].name,
              "and point straight at the type's storage");
    }
    check(east_struct_get_field(s, "beta") == fields[1], "lookup by name still works");
    check(east_struct_get_field(s, "missing") == NULL, "a missing field is still NULL");

    /* Two instances of the same type compare and order by name as before. */
    EastValue *s2 = east_struct_new(names, fields, 3, st);
    check(east_value_equal(s, s2), "two typed instances compare equal");
    check(east_value_compare(s, s2) == 0, "two typed instances order equal");

    /* Untyped structs — every patch payload is one — keep their own copies. */
    EastValue *untyped = east_struct_new(names, fields, 3, NULL);
    check(untyped->data.struct_.field_names != NULL, "an untyped struct copies its names");
    for (size_t i = 0; i < 3; i++)
        check(strcmp(east_struct_field_name(untyped, i), names[i]) == 0,
              "copied names read back correctly");
    check(east_struct_get_field(untyped, "gamma") == fields[2], "lookup works untyped too");
    check(east_value_equal(s, untyped), "typed and untyped instances still compare equal");

    /* A type whose fields disagree with the instance must fall back rather than
     * silently rename: compiler.c takes the count from the IR node and the type
     * from a separate conversion, with nothing cross-checking them. */
    const char *other_names[3] = {"alpha", "delta", "gamma"};
    EastValue *mismatched = east_struct_new(other_names, fields, 3, st);
    check(mismatched->data.struct_.field_names != NULL, "a name mismatch falls back to copies");
    check(strcmp(east_struct_field_name(mismatched, 1), "delta") == 0,
          "and keeps the instance's own name");

    const char *two_names[2] = {"alpha", "beta"};
    EastValue *short_struct = east_struct_new(two_names, fields, 2, st);
    check(short_struct->data.struct_.field_names != NULL,
          "a field-count mismatch falls back to copies");
    check(strcmp(east_struct_field_name(short_struct, 1), "beta") == 0, "and reads its own names");

    /* Printing goes through the same accessor. */
    char buf[256];
    east_value_print(s, buf, sizeof(buf));
    check(strstr(buf, "alpha") != NULL, "printing a typed struct shows its field names");

    east_value_release(s);
    east_value_release(s2);
    east_value_release(untyped);
    east_value_release(mismatched);
    east_value_release(short_struct);
    for (size_t i = 0; i < 3; i++)
        east_value_release(fields[i]);
}

/* ---- page reclamation -------------------------------------------------- */

/* east_value_slab_drain had no callers before this change and now has to cope
 * with one page list per size class. Prove it reclaims, leaves live values
 * alone, and hands back a free list that still allocates. */
static void test_slab_drain(void)
{
    EastValue *keep = east_string("kept across a drain");
    EastValue *keep_int = east_integer(1234);

    /* Enough to span several pages: the page still being bump-allocated from is
     * deliberately never reclaimed, and the first page holds the two values
     * kept live, so the reclaimable ones are in between. */
    const size_t churn = 20000;
    EastValue **tmp = malloc(churn * sizeof(EastValue *));
    for (size_t i = 0; i < churn; i++)
        tmp[i] = east_integer((int64_t)i);
    size_t pages_peak = east_value_slab_stats().pages;
    for (size_t i = 0; i < churn; i++)
        east_value_release(tmp[i]);
    free(tmp);

    east_value_slab_drain();
    check(east_value_slab_stats().pages < pages_peak, "drain reclaims fully free pages");
    check(strcmp(keep->data.string.data, "kept across a drain") == 0,
          "a live string survives a drain");
    check(keep_int->data.integer == 1234, "a live scalar survives a drain");

    /* The rebuilt free lists must still serve every class. */
    EastValue *after_int = east_integer(7);
    EastValue *after_str = east_string("after");
    EastValue *after_arr = east_array_new(&east_integer_type);
    check(after_int->data.integer == 7, "scalars allocate after a drain");
    check(strcmp(after_str->data.string.data, "after") == 0, "strings allocate after a drain");
    check(after_arr->kind == EAST_VAL_ARRAY, "containers allocate after a drain");
    east_value_release(after_int);
    east_value_release(after_str);
    east_value_release(after_arr);
    east_value_release(keep);
    east_value_release(keep_int);
}

/* ---- the shapes the issue measured ------------------------------------- */

/* Slab bytes per element for an Array<Option<Float>> struct row, the shape the
 * client table is made of. Reported, and floor-checked against the old
 * representation so a regression is visible rather than silent. */
static void test_row_footprint(void)
{
    const char *fnames[5] = {"a", "b", "c", "d", "e"};
    EastType *opt_float = option_of(&east_float_type);
    EastType *ftypes[5] = {opt_float, opt_float, opt_float, opt_float, opt_float};
    EastType *row_type = east_struct_type(fnames, ftypes, 5);

    const size_t rows = 2000;
    size_t before = live_bytes();
    EastValue *arr = east_array_new(row_type);
    for (size_t r = 0; r < rows; r++) {
        EastValue *vals[5];
        for (size_t f = 0; f < 5; f++) {
            /* One cell in five is empty, as in the measured table. */
            if (f == 2) {
                vals[f] = east_variant_new("none", east_null(), opt_float);
            } else {
                EastValue *num = east_float((double)(r + f));
                vals[f] = east_variant_new("some", num, opt_float);
                east_value_release(num);
            }
        }
        EastValue *row = east_struct_new(fnames, vals, 5, row_type);
        east_array_push(arr, row);
        east_value_release(row);
        for (size_t f = 0; f < 5; f++)
            east_value_release(vals[f]);
    }
    size_t per_row = (live_bytes() - before) / rows;
    printf("  Array<Struct<5x Option<Float>>>: %zu slab bytes/row\n", per_row);
    /* Old representation: struct node 104 + names array 40 + 5 strdups (>=160)
     * + 5 variant nodes 520 + 4 float nodes 416 + 1 `none` node 104 = 1344,
     * before the array's own item pointer. */
    check(per_row < 700, "a 5-field option row must cost well under the old ~1.3 KB");

    east_value_release(arr);
    check(live_bytes() == before, "and all of it comes back");
}

int main(void)
{
    east_type_of_type_init();

    printf("value layout gate (issue #423)\n");
    test_size_classes();
    test_inline_strings();
    test_shared_none();
    test_struct_field_names();
    test_slab_drain();
    test_row_footprint();

    /* The shared `none` values are owned by their VariantType and reclaimed
     * with the type arena — LSan is the oracle that the purge hook is wired. */
    east_type_registry_clear();
    east_value_slab_drain();

    if (failures == 0) {
        printf("GATE PASS: value representation is size-classed, strings inline, "
               "`none` shared, struct names borrowed (issue #423)\n");
        return 0;
    }
    printf("GATE FAIL: %d check(s) failed\n", failures);
    return 1;
}
