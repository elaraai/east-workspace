/*
 * Array diff gate (#1425).
 *
 * An Array's diff trims the common start and end, finds a shortest edit
 * script over the middle by Myers' greedy forward algorithm, and past the
 * search's bound — min(m' + n', 2^24 / (m' + n')) edits — pairs the middle by
 * position. Its work is pinned here by the element comparisons it makes
 * (east_diff_array_compares), never by a clock: each case is held to the bound
 * the issue gives it — the trim's p + s + 2, Myers' (2D + 1) * min(m', n'),
 * and min(m', n') more when the middle is paired by position — where the table
 * the diff used to fill made about 10^10 for a 100,000-element array.
 *
 * Each case's patch is pinned too, operation by operation, and applied: the
 * same patches libs/east/test/patch.spec.ts pins on every runtime, so this
 * gate fails here, with the count, before the compliance run would.
 */
#include <east/east.h>

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static int failures = 0;

#define CHECK(cond, ...)                                                                           \
    do {                                                                                           \
        if (!(cond)) {                                                                             \
            fprintf(stderr, "FAIL %s:%d: ", __FILE__, __LINE__);                                   \
            fprintf(stderr, __VA_ARGS__);                                                          \
            fprintf(stderr, "\n");                                                                 \
            failures++;                                                                            \
        }                                                                                          \
    } while (0)

static BuiltinImpl s_diff;
static BuiltinImpl s_apply;

/* A growable list of Integers, from which the cases' arrays are built. */
typedef struct {
    int64_t *items;
    size_t len;
    size_t cap;
} Ints;

static void ints_push(Ints *xs, int64_t x)
{
    if (xs->len == xs->cap) {
        xs->cap = xs->cap ? 2 * xs->cap : 64;
        xs->items = realloc(xs->items, xs->cap * sizeof(int64_t));
    }
    xs->items[xs->len++] = x;
}

static Ints ints_range(int64_t from, int64_t to)
{
    Ints xs = {0};
    for (int64_t x = from; x < to; x++)
        ints_push(&xs, x);
    return xs;
}

/* xs[from .. to), appended to out. */
static void ints_append(Ints *out, const Ints *xs, size_t from, size_t to)
{
    for (size_t i = from; i < to; i++)
        ints_push(out, xs->items[i]);
}

static EastValue *array_of(const Ints *xs)
{
    EastValue *arr = east_array_new(&east_integer_type);
    for (size_t i = 0; i < xs->len; i++) {
        EastValue *x = east_integer(xs->items[i]);
        east_array_push(arr, x);
        east_value_release(x);
    }
    return arr;
}

/* One expected operation: an update from `a` to `b`, or a delete or an insert
 * of `a`, at `key`. */
typedef struct {
    int64_t key;
    char op; /* 'u', 'd' or 'i' */
    int64_t a;
    int64_t b;
} Op;

typedef struct {
    Op *items;
    size_t len;
    size_t cap;
} Ops;

static void ops_push(Ops *ops, int64_t key, char op, int64_t a, int64_t b)
{
    if (ops->len == ops->cap) {
        ops->cap = ops->cap ? 2 * ops->cap : 16;
        ops->items = realloc(ops->items, ops->cap * sizeof(Op));
    }
    ops->items[ops->len++] = (Op){key, op, a, b};
}

static int64_t int_of(EastValue *v)
{
    return v && v->kind == EAST_VAL_INTEGER ? v->data.integer : INT64_MIN;
}

/* Whether `patch` is exactly `want`: `unchanged` for an empty list. */
static bool patch_is(EastValue *patch, const Ops *want, const char *name)
{
    if (want->len == 0) {
        bool ok = patch && strcmp(east_variant_case_name(patch), "unchanged") == 0;
        CHECK(ok, "%s: expected unchanged, got %s", name, east_variant_case_name(patch));
        return ok;
    }
    if (!patch || strcmp(east_variant_case_name(patch), "patch") != 0) {
        CHECK(false, "%s: expected a patch, got %s", name, east_variant_case_name(patch));
        return false;
    }
    EastValue *ops = patch->data.variant.value;
    size_t n = east_array_len(ops);
    if (n != want->len) {
        CHECK(false, "%s: %zu operations, expected %zu", name, n, want->len);
        return false;
    }
    for (size_t i = 0; i < n; i++) {
        EastValue *entry = east_array_get(ops, i);
        EastValue *op = east_struct_get_field(entry, "operation");
        const char *tag = east_variant_case_name(op);
        const Op *w = &want->items[i];
        int64_t key = int_of(east_struct_get_field(entry, "key"));
        int64_t offset = int_of(east_struct_get_field(entry, "offset"));
        bool ok = key == w->key && offset == 0;
        if (w->op == 'u') {
            EastValue *inner = op->data.variant.value;
            ok = ok && strcmp(tag, "update") == 0 &&
                 strcmp(east_variant_case_name(inner), "replace") == 0 &&
                 int_of(east_struct_get_field(inner->data.variant.value, "before")) == w->a &&
                 int_of(east_struct_get_field(inner->data.variant.value, "after")) == w->b;
        } else {
            ok = ok && strcmp(tag, w->op == 'd' ? "delete" : "insert") == 0 &&
                 int_of(op->data.variant.value) == w->a;
        }
        if (!ok) {
            CHECK(false, "%s: operation %zu is %s at key %lld, expected %c at key %lld", name, i,
                  tag, (long long)key, w->op, (long long)w->key);
            return false;
        }
    }
    return true;
}

/* Diffs before into after, holding the comparisons to `bound` and the patch to
 * `want`, and applies the patch. Consumes the lists. */
static void check_case(const char *name, Ints before_xs, Ints after_xs, bool same, Ops want,
                       size_t bound)
{
    EastValue *before = array_of(&before_xs);
    EastValue *after = same ? before : array_of(&after_xs);
    if (same) east_value_retain(after);

    size_t compares_before = east_diff_array_compares();
    EastValue *args[2] = {before, after};
    EastValue *patch = s_diff(args, 2);
    size_t compares = east_diff_array_compares() - compares_before;
    printf("    %-26s %zu comparisons (bound %zu)\n", name, compares, bound);

    if (!patch) {
        char *err = east_builtin_get_error();
        CHECK(false, "%s: the diff failed: %s", name, err ? err : "(no message)");
        free(err);
    } else {
        CHECK(compares <= bound, "%s: %zu comparisons, past the bound of %zu", name, compares,
              bound);
        if (patch_is(patch, &want, name)) {
            EastValue *apply_args[2] = {before, patch};
            EastValue *applied = s_apply(apply_args, 2);
            CHECK(applied && east_value_equal(applied, after),
                  "%s: applying the patch does not give after", name);
            if (applied) east_value_release(applied);
        }
        east_value_release(patch);
    }

    east_value_release(before);
    east_value_release(after);
    free(before_xs.items);
    free(after_xs.items);
    free(want.items);
}

#define N 100000

static void test_small_edits(void)
{
    Ints r = ints_range(0, N);

    /* One element changed: an update, found by trimming either side of it. */
    {
        Ints a = ints_range(0, N);
        a.items[50000] = -1;
        Ops w = {0};
        ops_push(&w, 50000, 'u', 50000, -1);
        check_case("one change", ints_range(0, N), a, false, w, 100006);
    }
    /* One removed. */
    {
        Ints a = {0};
        ints_append(&a, &r, 0, 50000);
        ints_append(&a, &r, 50001, N);
        Ops w = {0};
        ops_push(&w, 50000, 'd', 50000, 0);
        check_case("one removed", ints_range(0, N), a, false, w, 100001);
    }
    /* One inserted. */
    {
        Ints a = {0};
        ints_append(&a, &r, 0, 50000);
        ints_push(&a, -1);
        ints_append(&a, &r, 50000, N);
        Ops w = {0};
        ops_push(&w, 50000, 'i', -1, 0);
        check_case("one inserted", ints_range(0, N), a, false, w, 100002);
    }
    /* Appended. */
    {
        Ints a = ints_range(0, N + 1);
        Ops w = {0};
        ops_push(&w, N, 'i', N, 0);
        check_case("appended", ints_range(0, N), a, false, w, 100002);
    }
    /* Prepended. */
    {
        Ints a = {0};
        ints_push(&a, -1);
        ints_append(&a, &r, 0, N);
        Ops w = {0};
        ops_push(&w, 0, 'i', -1, 0);
        check_case("prepended", ints_range(0, N), a, false, w, 100002);
    }
    /* Two changes far apart: the middle between them is the whole array but 20
     * elements, and its shortest script is 4 edits long. */
    {
        Ints a = ints_range(0, N);
        a.items[10] = -1;
        a.items[99989] = -2;
        Ops w = {0};
        ops_push(&w, 10, 'u', 10, -1);
        ops_push(&w, 99989, 'u', 99989, -2);
        check_case("changes far apart", ints_range(0, N), a, false, w, 899842);
    }
    /* A moved element: element 10 removed and put back at position 99,990. */
    {
        Ints a = {0};
        ints_append(&a, &r, 0, 10);
        ints_append(&a, &r, 11, 99991);
        ints_push(&a, 10);
        ints_append(&a, &r, 99991, N);
        Ops w = {0};
        ops_push(&w, 10, 'd', 10, 0);
        ops_push(&w, 99990, 'i', 10, 0);
        check_case("a moved element", ints_range(0, N), a, false, w, 499926);
    }
    /* No change: the same array, and an equal copy, which the trim takes whole. */
    {
        Ops w = {0};
        check_case("no change (the same)", ints_range(0, N), (Ints){0}, true, w, 0);
    }
    {
        Ops w = {0};
        check_case("no change (a copy)", ints_range(0, N), ints_range(0, N), false, w, 100002);
    }
    free(r.items);
}

static void test_shift_and_tie(void)
{
    /* A shift: one element inserted at the start, two removed at the end. */
    {
        Ints a = {0};
        ints_push(&a, -1);
        Ints r = ints_range(0, 4094);
        ints_append(&a, &r, 0, r.len);
        free(r.items);
        Ops w = {0};
        ops_push(&w, 0, 'i', -1, 0);
        ops_push(&w, 4095, 'd', 4094, 0);
        ops_push(&w, 4095, 'd', 4095, 0);
        check_case("a shift", ints_range(0, 4096), a, false, w, 28667);
    }
    /* A tie, which the trim settles: the leading 1 is kept. */
    {
        Ints b = {0}, a = {0};
        ints_push(&b, 1);
        ints_push(&b, 1);
        ints_push(&a, 1);
        Ops w = {0};
        ops_push(&w, 1, 'd', 1, 0);
        check_case("a tie", b, a, false, w, 3);
    }
}

/* The element negated where x mod `period` is `phase`. */
static Ints negated(int64_t period, int64_t phase)
{
    Ints xs = ints_range(0, N);
    for (size_t i = 0; i < xs.len; i++)
        if (xs.items[i] % period == phase) xs.items[i] = -xs.items[i];
    return xs;
}

static void test_the_bound(void)
{
    /* At the bound: 41 elements negated (x mod 2,490 = 100, from 100 to
     * 99,700) and element 50,000 moved to position 50,010. The trim leaves a
     * middle of 99,601 a side, whose bound is 2^24 / 199,202 = 84 edits, and
     * its shortest script is 84 long: Myers runs. */
    Ints changed = negated(2490, 100);
    Ints at = {0};
    ints_append(&at, &changed, 0, 50000);
    ints_append(&at, &changed, 50001, 50011);
    ints_push(&at, changed.items[50000]);
    ints_append(&at, &changed, 50011, N);
    {
        Ops w = {0};
        for (int64_t x = 100; x < 50000; x += 2490)
            ops_push(&w, x, 'u', x, -x);
        ops_push(&w, 50000, 'd', 50000, 0);
        ops_push(&w, 50010, 'i', 50000, 0);
        for (int64_t x = 100 + 2490 * 21; x <= 99700; x += 2490)
            ops_push(&w, x, 'u', x, -x);
        Ints copy = {0};
        ints_append(&copy, &at, 0, at.len);
        check_case("at the bound", ints_range(0, N), copy, false, w, 16832970);
    }
    /* Past the bound: the same, and element 99,800 removed. The middle is
     * 99,701 by 99,700, whose bound is still 84, and its shortest script is 85
     * long: the middle is paired by position. */
    {
        Ints past = {0};
        ints_append(&past, &at, 0, 99800);
        ints_append(&past, &at, 99801, at.len);
        Ops w = {0};
        for (int64_t x = 100; x < 50000; x += 2490)
            ops_push(&w, x, 'u', x, -x);
        for (int64_t k = 50000; k < 50010; k++)
            ops_push(&w, k, 'u', k, k + 1);
        ops_push(&w, 50010, 'u', 50010, 50000);
        for (int64_t x = 100 + 2490 * 21; x <= 99700; x += 2490)
            ops_push(&w, x, 'u', x, -x);
        ops_push(&w, 99800, 'd', 99800, 0);
        check_case("past the bound", ints_range(0, N), past, false, w, 16949301);
    }
    free(changed.items);
    free(at.items);

    /* Many scattered changes: 1,000 negated (x mod 100 = 50). The middle is
     * 99,901 a side, bound 83, against a shortest script of 2,000: paired by
     * position. */
    {
        Ops w = {0};
        for (int64_t x = 50; x < N; x += 100)
            ops_push(&w, x, 'u', x, -x);
        check_case("many scattered changes", ints_range(0, N), negated(100, 50), false, w,
                   16783469);
    }
}

int main(void)
{
    BuiltinRegistry *builtins = builtin_registry_new();
    east_register_all_builtins(builtins);
    EastType *tps[1] = {east_array_type(&east_integer_type)};
    s_diff = builtin_registry_get(builtins, "Diff", tps, 1);
    s_apply = builtin_registry_get(builtins, "ApplyPatch", tps, 1);
    if (!s_diff || !s_apply) {
        fprintf(stderr, "FAIL: the Diff and ApplyPatch builtins are not registered\n");
        return 1;
    }

    test_small_edits();
    test_shift_and_tie();
    test_the_bound();

    builtin_registry_free(builtins);
    east_type_registry_clear();

    if (failures > 0) {
        fprintf(stderr, "%d failure(s)\n", failures);
        return 1;
    }
    printf("array diff gate: all checks passed\n");
    return 0;
}
