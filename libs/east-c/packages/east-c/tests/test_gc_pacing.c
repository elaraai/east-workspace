/*
 * GC pacing + pure-data untracking gate (issue #437).
 *
 * Two properties, each of which shipped as a real quadratic build:
 *
 *   1. Full collections are paced on OLD-GENERATION GROWTH, not on a fixed
 *      allocation interval. A fixed interval walks the whole live graph every
 *      N allocations while a large structure is still being built — O(N·A)
 *      for A allocations reaching N live values (CPython bpo-4074). The gate
 *      builds a large live set of tracked values through the scheduled-
 *      collection path and asserts the number of full passes stays on the
 *      geometric schedule (O(log growth)), not the linear one.
 *
 *   2. Structs and variants whose TYPE cannot participate in a reference
 *      cycle (no Function or Ref transitively, and no type recursion — see
 *      east_type_can_cycle) are not tracked at all, so immutable row-shaped
 *      data never enters the collector. Everything else stays conservatively
 *      tracked: mutable containers (their contents change through unguarded
 *      attach sites, and several builtins stamp placeholder element types on
 *      results), recursive types (in-place container mutation can close a
 *      pure-data cycle), NULL/unknown types, and variants whose payload is
 *      itself tracked (their stamp can lie). The gate asserts the
 *      classification, the tracking decisions, that a lying-stamped variant
 *      stays tracked, and that real cycles — including one through a
 *      placeholder-typed array — are still collected.
 *
 * Run under ASan/LSan (wired into `make leak-check`, which runs these gates
 * in the build-asan tree): a wrongly-untracked value that was part of a
 * cycle surfaces there as a leak.
 */
#include <east/east.h>
#include <east/gc.h>

#include <stdio.h>
#include <stdlib.h>

static int failures = 0;

#define CHECK(cond, msg)                                                                           \
    do {                                                                                           \
        if (!(cond)) {                                                                             \
            fprintf(stderr, "FAIL: %s (%s:%d)\n", msg, __FILE__, __LINE__);                        \
            failures++;                                                                            \
        }                                                                                          \
    } while (0)

/* Struct{a: String, b: Float} — pure data. */
static EastType *pure_row_type(void)
{
    const char *names[2] = {"a", "b"};
    EastType *types[2] = {&east_string_type, &east_float_type};
    return east_struct_type(names, types, 2);
}

/* Recursive pure-data list: List = Recursive(self => Variant{ cons:
 * Struct{head: Integer, tail: self}, nil: Null }). The type graph is
 * genuinely cyclic — classification must terminate, and must answer "can
 * cycle": recursion admits a value cycle through in-place container
 * mutation even with no Ref or Function in the type. */
static EastType *pure_list_type(void)
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

static void test_can_cycle_classification(void)
{
    CHECK(!east_type_can_cycle(&east_integer_type), "Integer cannot cycle");
    CHECK(!east_type_can_cycle(&east_string_type), "String cannot cycle");
    CHECK(east_type_can_cycle(NULL), "NULL type is conservatively cyclic");

    EastType *row = pure_row_type();
    CHECK(!east_type_can_cycle(row), "Struct{String,Float} cannot cycle");
    CHECK(!east_type_can_cycle(east_array_type(row)), "Array<pure struct> cannot cycle");
    CHECK(!east_type_can_cycle(east_dict_type(&east_string_type, east_array_type(row))),
          "Dict<String, Array<pure struct>> cannot cycle");
    CHECK(!east_type_can_cycle(east_vector_type(&east_float_type)), "Vector<Float> cannot cycle");

    /* DAG sharing is not recursion: two fields of the same interned type. */
    {
        const char *names[2] = {"x", "y"};
        EastType *types[2] = {row, row};
        CHECK(!east_type_can_cycle(east_struct_type(names, types, 2)),
              "shared (diamond) subtree is not a back-edge");
    }

    CHECK(east_type_can_cycle(east_ref_type(&east_integer_type)), "Ref<Integer> can cycle");
    CHECK(east_type_can_cycle(east_array_type(east_ref_type(&east_integer_type))),
          "Array<Ref<Integer>> can cycle");
    EastType *fn = east_function_type(NULL, 0, &east_integer_type);
    CHECK(east_type_can_cycle(fn), "Function can cycle");
    {
        const char *names[1] = {"f"};
        EastType *types[1] = {fn};
        CHECK(east_type_can_cycle(east_struct_type(names, types, 1)), "Struct{Function} can cycle");
    }

    /* Recursion — with or without Ref — is conservatively cycle-capable. */
    CHECK(east_type_can_cycle(pure_list_type()), "recursive pure list can cycle (mutation)");
    CHECK(east_type_can_cycle(pure_list_type()), "memoised recursive answer is stable");

    /* A Recursive wrapper whose node never refers back is not a back-edge. */
    {
        EastType *rec = east_recursive_type_new();
        east_recursive_type_set(rec, &east_integer_type);
        CHECK(!east_type_can_cycle(rec), "non-self-referential wrapper stays acyclic");
    }

    /* Mutual recursion through a second wrapper is a back-edge too. */
    {
        EastType *outer = east_recursive_type_new();
        const char *names[1] = {"next"};
        EastType *types[1] = {outer};
        EastType *inner_struct = east_struct_type(names, types, 1);
        EastType *inner = east_recursive_type_new();
        east_recursive_type_set(inner, inner_struct);
        const char *onames[1] = {"child"};
        EastType *otypes[1] = {inner};
        east_recursive_type_set(outer, east_struct_type(onames, otypes, 1));
        CHECK(east_type_can_cycle(outer), "mutually recursive wrappers can cycle");
    }

    /* Querying an unclosed wrapper answers true WITHOUT memoising: after the
     * node is set to a non-referring pure type, the answer must update. */
    {
        EastType *rec = east_recursive_type_new();
        CHECK(east_type_can_cycle(rec), "unclosed wrapper is conservatively cyclic");
        east_recursive_type_set(rec, &east_float_type);
        CHECK(!east_type_can_cycle(rec), "the conservative pre-set answer was not memoised");
    }
}

static void test_pure_data_is_untracked(void)
{
    east_gc_collect_full();
    size_t base = east_gc_tracked_count();

    /* Pure-typed structs never enter the tracked set. */
    EastType *row = pure_row_type();
    const char *names[2] = {"a", "b"};
    enum { N = 1000 };
    EastValue **rows = malloc(N * sizeof(EastValue *));
    CHECK(rows != NULL, "allocation for the rows");
    if (!rows) return;
    for (int i = 0; i < N; i++) {
        EastValue *a = east_string("x");
        EastValue *b = east_float(1.0);
        EastValue *vals[2] = {a, b};
        rows[i] = east_struct_new(names, vals, 2, row);
        east_value_release(a);
        east_value_release(b);
    }
    CHECK(east_gc_tracked_count() == base, "pure-typed structs never enter the tracked set");
    CHECK(!east_value_is_tracked(rows[0]), "a pure-typed struct is untracked");

    /* A pure-typed variant wrapping an untracked payload is untracked. */
    EastType *opt_names_type;
    {
        const char *cnames[2] = {"none", "some"};
        EastType *ctypes[2] = {&east_null_type, &east_float_type};
        opt_names_type = east_variant_type(cnames, ctypes, 2);
    }
    EastValue *fv = east_float(2.5);
    EastValue *some_v = east_variant_new("some", fv, opt_names_type);
    CHECK(!east_value_is_tracked(some_v), "pure-typed variant with untracked payload is untracked");
    east_value_release(some_v);

    /* A variant whose stamp claims pure but whose payload is tracked keeps
     * its tracking — some builtins stamp a factory-time option type that can
     * belong to another instantiation, so the payload decides. */
    EastValue *iv = east_integer(1);
    EastValue *ref = east_ref_new(iv);
    east_value_release(iv);
    EastValue *lying = east_variant_new("some", ref, opt_names_type);
    CHECK(east_value_is_tracked(lying), "variant with tracked payload stays tracked");
    east_value_release(lying);
    east_value_release(ref);

    /* Conservative cases stay tracked. */
    {
        EastValue *a = east_string("x");
        EastValue *vals[2] = {a, a};
        EastValue *untyped = east_struct_new(names, vals, 2, NULL);
        CHECK(east_value_is_tracked(untyped), "untyped struct stays tracked");
        east_value_release(untyped);
        east_value_release(a);
    }
    {
        const char *rnames[1] = {"r"};
        EastType *rtypes[1] = {east_ref_type(&east_integer_type)};
        EastType *ref_struct_t = east_struct_type(rnames, rtypes, 1);
        EastValue *rv = east_ref_new(NULL);
        EastValue *vals[1] = {rv};
        EastValue *s = east_struct_new(rnames, vals, 1, ref_struct_t);
        CHECK(east_value_is_tracked(s), "ref-bearing struct stays tracked");
        east_value_release(s);
        east_value_release(rv);
    }

    /* Mutable containers stay tracked even when their type is pure: their
     * attach sites are unguarded and several builtins stamp placeholder
     * element types on results. */
    EastValue *arr = east_array_new(row);
    CHECK(east_value_is_tracked(arr), "Array<pure struct> stays tracked");
    east_value_release(arr);
    EastValue *d = east_dict_new(&east_string_type, &east_float_type);
    CHECK(east_value_is_tracked(d), "Dict stays tracked");
    east_value_release(d);
    EastValue *st = east_set_new(&east_integer_type);
    CHECK(east_value_is_tracked(st), "Set stays tracked");
    east_value_release(st);

    for (int i = 0; i < N; i++)
        east_value_release(rows[i]);
    free(rows);
    east_gc_collect_full();
    CHECK(east_gc_tracked_count() == base, "everything released cleanly");
}

/* An actual reference cycle must still be found and freed: cell = Struct{r:
 * Ref} where the ref points back at the struct. Both nodes carry
 * cycle-capable types, so both stay tracked. */
static void test_cycle_still_collected(void)
{
    east_gc_collect_full();
    size_t base = east_gc_tracked_count();

    EastValue *ref = east_ref_new(NULL);
    const char *names[1] = {"r"};
    EastType *types[1] = {east_ref_type(&east_null_type)};
    EastType *cell_t = east_struct_type(names, types, 1);
    EastValue *vals[1] = {ref};
    EastValue *cell = east_struct_new(names, vals, 1, cell_t);
    east_ref_set(ref, cell); /* close the cycle: cell -> ref -> cell */
    CHECK(east_value_is_tracked(cell), "cycle-capable struct is tracked");
    CHECK(east_value_is_tracked(ref), "ref is tracked");

    east_value_release(ref);
    east_value_release(cell); /* externally unreachable, kept alive by the cycle */
    east_gc_collect_full();
    CHECK(east_gc_tracked_count() == base, "the cycle was collected");
}

/* A cycle through a PLACEHOLDER-TYPED array must also be collected. Several
 * higher-order builtins construct results with a placeholder element type
 * (e.g. ArrayGenerate uses Null) and fill them with callback-produced
 * values — the array's stamp lies about its contents, which is exactly why
 * mutable containers are never untracked. */
static void test_lying_typed_array_cycle_collected(void)
{
    east_gc_collect_full();
    size_t base = east_gc_tracked_count();

    EastValue *arr = east_array_new(&east_null_type); /* the ArrayGenerate pattern */
    CHECK(east_value_is_tracked(arr), "placeholder-typed array stays tracked");
    EastValue *ref = east_ref_new(NULL);
    east_array_push(arr, ref); /* arr -> ref, despite the Null stamp */
    east_ref_set(ref, arr);    /* ref -> arr: the cycle is closed */

    east_value_release(ref);
    east_value_release(arr);
    east_gc_collect_full();
    CHECK(east_gc_tracked_count() == base, "the lying-typed cycle was collected");
}

/* Build a large LIVE set of tracked values through the scheduled-collection
 * path, mimicking the compiler's safe point (east_gc_collect after every
 * GC_YOUNG_THRESHOLD net allocations). The number of full passes must follow
 * the geometric growth schedule, not the old fixed interval — for 1M live
 * allocations the fixed interval ran 1,000,000 / (500 × 20) = 100 fulls,
 * each walking the whole (growing) live set. */
static void test_full_collections_paced_on_growth(void)
{
    east_gc_collect_full();

    enum { BATCH = 500, BATCHES = 2000 }; /* 1,000,000 live tracked values */
    EastValue **held = malloc((size_t)BATCH * BATCHES * sizeof(EastValue *));
    CHECK(held != NULL, "allocation for the held set");
    if (!held) return;

    size_t fulls_before = east_gc_full_count();
    size_t n = 0;
    for (int b = 0; b < BATCHES; b++) {
        for (int i = 0; i < BATCH; i++) {
            EastValue *iv = east_integer(i);
            held[n++] = east_ref_new(iv); /* Ref: always tracked */
            east_value_release(iv);
        }
        east_gc_collect(); /* the compiler safe point's scheduled collection */
    }
    size_t fulls = east_gc_full_count() - fulls_before;

    /* Geometric schedule: floor-paced fulls while old <= 4×GC_FULL_MIN_PENDING,
     * then old×1.25 per full — ~14 for 1M (measured). Give slack; the old
     * fixed interval produced 100. */
    CHECK(fulls <= 40, "full collections follow the growth schedule");
    if (fulls > 40) fprintf(stderr, "  fulls = %zu (expected <= 40)\n", fulls);

    for (size_t i = 0; i < n; i++)
        east_value_release(held[i]);
    free(held);
    east_gc_collect_full();
}

int main(void)
{
    test_can_cycle_classification();
    test_pure_data_is_untracked();
    test_cycle_still_collected();
    test_lying_typed_array_cycle_collected();
    test_full_collections_paced_on_growth();

    east_gc_collect_full();
    east_type_registry_clear();

    if (failures) {
        fprintf(stderr, "%d failure(s)\n", failures);
        return 1;
    }
    printf("gc_pacing: all cases passed\n");
    return 0;
}
