/*
 * Gate for issue #1616, D4 and D5: a key range of a lazily opened Set or Dict
 * is a view the pager serves.
 *
 * What a range read costs is asserted in segments decoded — a count, never a
 * clock — on the source's pager, which every view reads through:
 *
 *   1. making a view reads nothing, and its size places its two ends: the
 *      fences bisected, then the one segment that can hold each end, through
 *      the cache — none where the end is before the first key, or is a whole
 *      key that is a segment's first: one that gives every leaf of the key, an
 *      empty struct's none among them, as TypeScript counts them;
 *   2. a walk of a view reads its first and last segments through the cache,
 *      where placing left them, and the segments between them fresh, each
 *      once, the cache left holding the ends alone;
 *   3. a keyed read tests the key against the bounds — once the view is
 *      placed, against its first row's key and the first key past its rows —
 *      which reads nothing, and inside them is the source's keyed read;
 *   4. a range of a range is a narrower view of the same source: it reads
 *      nothing to be made, and is placed among the rows of the range it
 *      narrows, so it reads no segment outside that one's;
 *   5. a view's own rows decode into a collection of its own — never frozen,
 *      whatever the source is — and no row beyond them; the source stays
 *      lazy, its cache as it was, and a source decoded whole or changed
 *      afterwards changes no range taken before;
 *   6. exactness: for bounds made from a seed, over whole keys and leading
 *      parts of a struct key, a view's size, its walk, its decode and the
 *      host's row range are what a walk of the whole collection keeps;
 *   7. the refusals: an Array root, a bound that is no leading part of the
 *      key, segments that are not self-contained;
 *   8. a range narrowed a hundred thousand times — as a body's loop narrows
 *      one — is placed by a loop, holds nothing of the ranges it narrows once
 *      placed, and is let go by a loop when never read: on a 1 MiB stack,
 *      where a recursion that deep does not fit;
 *   9. what a view's account says — the segments its source is stored in —
 *      places nothing, and posts nothing where its ends cannot be placed; a
 *      range with both ends open reads its source's fences first, as a keyed
 *      read does; a loop is told which of a view's segments decode to its
 *      projection;
 *  10. a range's rows read from a pager that keeps no view — a file under a
 *      projection — are read as a view reads them, each segment once, its end
 *      segments through the cache, into a collection frozen at every depth.
 *
 * Run under ASan/LSan too (scripts/run_leak_check.sh): a view holds its
 * source, and its end segments are the cache's.
 *
 * EAST_C_RANGE_BENCH=1 also times range reads over a million rows against a
 * walk of the whole — a short run held and not held, runs in key order, a
 * long range. Printed, and never asserted: no clock decides this gate.
 */
#include <east/compat.h>
#include <east/east.h>

#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>

#ifndef _WIN32
#include <pthread.h>
#endif

static int failures = 0;

static void check(bool ok, const char *what)
{
    if (!ok) {
        char *error = east_builtin_get_error();
        printf("FAIL: %s%s%s\n", what, error ? " — " : "", error ? error : "");
        free(error);
        failures++;
    }
}

static void check_count(size_t got, size_t want, const char *what)
{
    if (got != want) {
        printf("FAIL: %s: %zu, expected %zu\n", what, got, want);
        failures++;
    }
}

/* A fixed-seed LCG: the same bounds on every run and platform. */
static uint64_t rng_state = 0x1616D4D5D4D51616ull;
static uint32_t rng(void)
{
    rng_state = rng_state * 6364136223846793005ull + 1442695040888963407ull;
    return (uint32_t)(rng_state >> 33);
}

/* ---- fixtures ------------------------------------------------------------ */

#define PER_SEGMENT 8
#define SEGMENTS 12
#define ROWS (PER_SEGMENT * SEGMENTS)

/* A self-contained, indexed blob of a Set or Dict in segments of `per`. */
static ByteBuffer *encode_in_segments(EastValue *value, EastType *type, size_t per,
                                      bool self_contained)
{
    Beast2StreamWriter *w =
        east_beast2_writer_new(type, EAST_BEAST2_CODEC_DEFLATE, self_contained, true);
    if (!w) return NULL;
    bool is_dict = type->kind == EAST_TYPE_DICT;
    size_t n = is_dict ? east_dict_len(value) : east_set_len(value);
    bool ok = true;
    for (size_t i = 0; ok && i < n; i += per) {
        size_t end = i + per < n ? i + per : n;
        EastValue *batch = is_dict ? east_dict_new(type->data.dict.key, type->data.dict.value)
                                   : east_set_new(type->data.element);
        for (size_t k = i; k < end; k++) {
            if (is_dict)
                east_dict_set(batch, east_dict_key_at(value, k), east_dict_val_at(value, k));
            else
                east_set_insert(batch, east_set_at(value, k));
        }
        ok = east_beast2_writer_write(w, batch);
        east_value_release(batch);
    }
    ok = ok && east_beast2_writer_finish(w);
    ByteBuffer *buf = ok ? east_beast2_writer_take(w) : NULL;
    east_beast2_writer_free(w);
    return buf;
}

/* Dict<Integer, Integer>: 3·i -> 10·i, so a bound can fall between keys. */
static EastValue *int_dict(size_t n)
{
    EastValue *dict = east_dict_new(&east_integer_type, &east_integer_type);
    for (size_t i = 0; i < n; i++) {
        EastValue *k = east_integer((int64_t)(3 * i));
        EastValue *v = east_integer((int64_t)(10 * i));
        east_dict_set(dict, k, v);
        east_value_release(k);
        east_value_release(v);
    }
    return dict;
}

/* Sheets printed, keyed { press, job }: PER_SEGMENT jobs a press, so a segment
 * is one press. */
static EastType *sheet_key_type(size_t fields)
{
    const char *names[] = {"press", "job"};
    EastType *types[] = {&east_string_type, &east_integer_type};
    return east_struct_type(names, types, fields);
}

static EastValue *sheet_key(size_t press, int64_t job, EastType *type)
{
    char name[16];
    snprintf(name, sizeof(name), "P%02zu", press);
    EastValue *p = east_string(name);
    EastValue *j = east_integer(job);
    const char *names[] = {"press", "job"};
    EastValue *values[] = {p, j};
    EastValue *key = east_struct_new(names, values, type->data.struct_.num_fields, type);
    east_value_release(p);
    east_value_release(j);
    return key;
}

static EastValue *sheet_dict(EastType *key_type)
{
    EastValue *dict = east_dict_new(key_type, &east_integer_type);
    for (size_t i = 0; i < ROWS; i++) {
        EastValue *k = sheet_key(i / PER_SEGMENT, (int64_t)(i % PER_SEGMENT), key_type);
        EastValue *v = east_integer((int64_t)i);
        east_dict_set(dict, k, v);
        east_value_release(k);
        east_value_release(v);
    }
    return dict;
}

/* A lazily opened value over a copy of `blob`, which the value owns. */
static EastValue *open_lazy(ByteBuffer *blob, EastType *type, bool frozen)
{
    uint8_t *data = malloc(blob->len);
    if (!data) return NULL;
    memcpy(data, blob->data, blob->len);
    EastValue *v = frozen ? east_beast2_open_paged_frozen(data, blob->len, type)
                          : east_beast2_open_paged(data, blob->len, type);
    if (!v) free(data);
    return v;
}

static size_t decoded(EastValue *paged)
{
    size_t n = 0;
    east_beast2_pages_stats(paged->data.paged.pages, &n, NULL);
    return n;
}

static size_t cached(EastValue *paged)
{
    Beast2PagesCacheStats s;
    east_beast2_pages_cache_stats(paged->data.paged.pages, &s);
    return s.segments;
}

/* A view of `source` between two Integer keys; a negative bound leaves that end open. */
static EastValue *int_view(EastValue *source, int64_t from, int64_t to)
{
    EastValue *f = from >= 0 ? east_integer(from) : NULL;
    EastValue *t = to >= 0 ? east_integer(to) : NULL;
    EastValue *view = east_beast2_open_paged_range(source, f, &east_integer_type, false, t,
                                                   &east_integer_type, false);
    if (f) east_value_release(f);
    if (t) east_value_release(t);
    return view;
}

/* Every row of a view, by the entries a loop walks it by: its segments in
 * turn. Returns the keys' sum and the row count — enough to tell two runs
 * apart — or false when a segment cannot be read. */
static bool walk(EastValue *view, size_t *rows, int64_t *sum)
{
    Beast2Pages *p = view->data.paged.pages;
    *rows = 0;
    *sum = 0;
    if (!east_beast2_pages_prepare(p)) return false;
    size_t n = east_beast2_pages_segment_count(p);
    for (size_t k = 0; k < n; k++) {
        EastValue *seg = east_beast2_pages_segment_disjoint(p, k);
        if (!seg) return false;
        size_t len = east_dict_len(seg);
        for (size_t i = 0; i < len; i++)
            *sum += east_dict_key_at(seg, i)->data.integer;
        *rows += len;
        east_value_release(seg);
    }
    return true;
}

/* ---- 1 and 2: what a range read costs ------------------------------------ */

typedef struct {
    int64_t from; /* a key, or -1 for an open end */
    int64_t to;
    size_t rows;         /* the range's rows */
    size_t after_size;   /* segments decoded once its size is asked */
    size_t after_walk;   /* and once it is walked */
    size_t cached_after; /* segments the cache holds then */
    const char *what;
} CostCase;

static void test_costs(void)
{
    EastType *type = east_dict_type(&east_integer_type, &east_integer_type);
    EastValue *whole = int_dict(ROWS);
    ByteBuffer *blob = encode_in_segments(whole, type, PER_SEGMENT, true);
    check(blob != NULL, "the fixture encodes");
    /* Row r has key 3r; segment s holds rows 8s to 8s + 7, its first key 24s. */
    static const CostCase cases[] = {
        {30, 39, 3, 1, 1, 1, "inside one segment"},
        {30, 60, 10, 2, 2, 2, "across two segments"},
        {30, 108, 26, 2, 4, 2, "across four segments: the two between read fresh"},
        {24, 48, 8, 0, 1, 1, "from one segment's first key to the next's, as whole keys"},
        {-1, 15, 5, 1, 1, 1, "no `from`: the start of the collection"},
        {-1, -1, ROWS, 0, SEGMENTS, 2, "both ends open: every row"},
        {0, 15, 5, 1, 1, 1, "`from` the first key"},
        {31, 31, 0, 1, 1, 1, "an empty range between two keys"},
        {60, 30, 0, 2, 2, 2, "an inverted range"},
        {3000, -1, 0, 1, 1, 1, "`from` past the last key: the last segment is read"},
        {270, -1, 6, 1, 1, 1, "to the end of the collection"},
    };
    for (size_t c = 0; c < sizeof(cases) / sizeof(cases[0]); c++) {
        const CostCase *cc = &cases[c];
        EastValue *source = blob ? open_lazy(blob, type, true) : NULL;
        EastValue *view = source ? int_view(source, cc->from, cc->to) : NULL;
        char what[200];
        snprintf(what, sizeof(what), "%s: a view opens", cc->what);
        check(view != NULL, what);
        if (!view) {
            if (source) east_value_release(source);
            continue;
        }
        snprintf(what, sizeof(what), "%s: making the view decodes nothing", cc->what);
        check_count(decoded(source), 0, what);
        check(!east_value_frozen(view), "a view of a frozen source is not frozen");

        snprintf(what, sizeof(what), "%s: its size", cc->what);
        check_count(east_dict_len(view), cc->rows, what);
        snprintf(what, sizeof(what), "%s: segments decoded for its size", cc->what);
        check_count(decoded(source), cc->after_size, what);

        size_t rows;
        int64_t sum;
        snprintf(what, sizeof(what), "%s: it is walked", cc->what);
        check(walk(view, &rows, &sum), what);
        snprintf(what, sizeof(what), "%s: rows walked", cc->what);
        check_count(rows, cc->rows, what);
        snprintf(what, sizeof(what), "%s: segments decoded once walked", cc->what);
        check_count(decoded(source), cc->after_walk, what);
        snprintf(what, sizeof(what), "%s: segments the cache holds", cc->what);
        check_count(cached(source), cc->cached_after, what);

        /* A second walk decodes the segments between the ends again, and no end. */
        size_t middle = cc->after_walk - cc->cached_after > 0 && cc->rows > 0
                            ? east_beast2_pages_segment_count(view->data.paged.pages) - 2
                            : 0;
        if (east_beast2_pages_segment_count(view->data.paged.pages) < 2) middle = 0;
        check(walk(view, &rows, &sum), "a view is walked again");
        snprintf(what, sizeof(what), "%s: a second walk decodes the middle segments alone",
                 cc->what);
        check_count(decoded(source), cc->after_walk + middle, what);

        east_value_release(view);
        east_value_release(source);
    }
    if (blob) byte_buffer_free(blob);
    east_value_release(whole);

    /* An empty collection and one of a single segment. */
    EastValue *none = int_dict(0);
    ByteBuffer *empty_blob = encode_in_segments(none, type, PER_SEGMENT, true);
    EastValue *empty = empty_blob ? open_lazy(empty_blob, type, true) : NULL;
    EastValue *empty_view = empty ? int_view(empty, 3, 30) : NULL;
    check(empty_view != NULL && east_dict_len(empty_view) == 0 && decoded(empty) == 0,
          "a range of an empty collection is empty and reads nothing");
    if (empty_view) east_value_release(empty_view);
    if (empty) east_value_release(empty);
    if (empty_blob) byte_buffer_free(empty_blob);
    east_value_release(none);

    EastValue *few = int_dict(5);
    ByteBuffer *few_blob = encode_in_segments(few, type, PER_SEGMENT, true);
    EastValue *single = few_blob ? open_lazy(few_blob, type, true) : NULL;
    EastValue *single_view = single ? int_view(single, 4, 13) : NULL;
    check(single_view != NULL && east_dict_len(single_view) == 3 && decoded(single) == 1,
          "a range of a single segment reads that segment once");
    if (single_view) east_value_release(single_view);
    if (single) east_value_release(single);
    if (few_blob) byte_buffer_free(few_blob);
    east_value_release(few);
    east_type_release(type);
}

/* Dict<{ a: Integer, b: {} }, Integer>: { a: 3·i, b: {} } -> 10·i. Its last
 * field is an empty struct, which holds no leaf, so a bound of `{ a }` gives
 * every leaf of the key: a whole key, which names one key, as TypeScript counts
 * leaves (view.spec.ts) — so the two runtimes read the same segments for it. */
static void test_whole_key_by_leaves(void)
{
    const char *names[] = {"a", "b"};
    EastType *empty = east_struct_type(NULL, NULL, 0);
    EastType *key_fields[] = {&east_integer_type, empty};
    EastType *key_type = east_struct_type(names, key_fields, 2);
    EastType *a_fields[] = {&east_integer_type};
    EastType *a_type = east_struct_type(names, a_fields, 1);
    EastType *type = east_dict_type(key_type, &east_integer_type);
    EastValue *nothing = east_struct_new(NULL, NULL, 0, empty);
    EastValue *whole = east_dict_new(key_type, &east_integer_type);
    for (size_t i = 0; i < ROWS; i++) {
        EastValue *a = east_integer((int64_t)(3 * i));
        EastValue *fields[] = {a, nothing};
        EastValue *k = east_struct_new(names, fields, 2, key_type);
        EastValue *v = east_integer((int64_t)(10 * i));
        east_dict_set(whole, k, v);
        east_value_release(v);
        east_value_release(k);
        east_value_release(a);
    }
    ByteBuffer *blob = encode_in_segments(whole, type, PER_SEGMENT, true);
    EastValue *source = blob ? open_lazy(blob, type, true) : NULL;
    check(source != NULL, "the fixture keyed { a, b: {} } opens");
    if (source) {
        EastValue *a24 = east_integer(24), *a48 = east_integer(48);
        EastValue *from = east_struct_new(names, &a24, 1, a_type);
        EastValue *to = east_struct_new(names, &a48, 1, a_type);
        EastValue *view =
            east_beast2_open_paged_range(source, from, a_type, false, to, a_type, false);
        check_count(view ? east_dict_len(view) : 0, PER_SEGMENT,
                    "from { a: 24 } to { a: 48 }: segment 1's rows");
        check_count(decoded(source), 0,
                    "each end a whole key that is a segment's first key: its size reads no "
                    "segment");
        size_t lo = 0, hi = 0;
        check(east_beast2_pages_range(source->data.paged.pages, from, a_type, false, to, a_type,
                                      false, &lo, &hi) &&
                  lo == PER_SEGMENT && hi == 2 * PER_SEGMENT,
              "the host's row range of it is rows 8 to 16");
        size_t rows = 0;
        bool exact = view && east_beast2_pages_prepare(view->data.paged.pages);
        size_t n = exact ? east_beast2_pages_segment_count(view->data.paged.pages) : 0;
        for (size_t k = 0; exact && k < n; k++) {
            EastValue *seg = east_beast2_pages_segment_disjoint(view->data.paged.pages, k);
            if (!seg) {
                exact = false;
                break;
            }
            for (size_t i = 0; i < east_dict_len(seg) && rows < PER_SEGMENT; i++, rows++)
                if (!east_value_equal(east_dict_key_at(seg, i),
                                      east_dict_key_at(whole, PER_SEGMENT + rows)))
                    exact = false;
            east_value_release(seg);
        }
        check(exact && rows == PER_SEGMENT, "a walk of it reads those rows, in order");
        check_count(decoded(source), 1, "segments decoded once walked: segment 1, once");
        if (view) east_value_release(view);
        east_value_release(to);
        east_value_release(from);
        east_value_release(a48);
        east_value_release(a24);
        east_value_release(source);
    }
    if (blob) byte_buffer_free(blob);
    east_value_release(whole);
    east_value_release(nothing);
    east_type_release(type);
    east_type_release(a_type);
    east_type_release(key_type);
    east_type_release(empty);
}

/* ---- 3, 4 and 5: keyed reads, a range of a range, a view's own rows ------- */

static void test_view_rule(void)
{
    EastType *type = east_dict_type(&east_integer_type, &east_integer_type);
    EastValue *whole = int_dict(ROWS);
    ByteBuffer *blob = encode_in_segments(whole, type, PER_SEGMENT, true);
    EastValue *inside = east_integer(33);
    EastValue *outside = east_integer(3);
    EastValue *between = east_integer(34);

    /* Keyed reads. */
    EastValue *source = open_lazy(blob, type, true);
    EastValue *view = int_view(source, 30, 60);
    check(!east_dict_has(view, outside) && decoded(source) == 0,
          "a key outside the bounds is absent, and nothing is read to say so");
    check(east_dict_has(view, inside) && decoded(source) == 1,
          "a key inside the bounds is the source's keyed read");
    check(!east_dict_has(view, between), "a key inside the bounds that is not there is absent");
    EastValue *value = NULL;
    check(east_beast2_pages_get_key(view->data.paged.pages, inside, &value) == 1 && value &&
              value->data.integer == 110,
          "a keyed read of a view gives the source's value");
    if (value) east_value_release(value);

    /* A range of a range. */
    size_t before = decoded(source);
    EastValue *narrower = int_view(view, 36, 600);
    check(narrower != NULL && decoded(source) == before, "a range of a range reads nothing");
    check_count(narrower ? east_dict_len(narrower) : 0, 8, "a range of a range holds both bounds");
    /* Its size placed the range it narrows — whose last segment was not yet
     * read — and then itself among that range's rows: a `to` past every key
     * of the collection reads no segment past the range. */
    check_count(decoded(source), before + 1,
                "a range of a range reads no segment outside the range it narrows");
    check(narrower && !east_dict_has(narrower, inside) && east_dict_has(view, inside),
          "a key the narrower range leaves out is absent from it alone");
    EastValue *wider = int_view(view, 0, 600);
    check_count(wider ? east_dict_len(wider) : 0, 10,
                "a range of a range is never wider than the range it is taken of");
    if (wider) east_value_release(wider);

    /* A view's own rows: a new collection, not frozen, and the source left lazy. */
    size_t cached_before = cached(source);
    EastValue *rows = east_paged_hydrated(view);
    check(rows != NULL && rows->kind == EAST_VAL_DICT && east_dict_len(rows) == 10,
          "a view decodes its own rows");
    check(rows && !east_value_frozen(rows), "a view's rows are a collection that is not frozen");
    check(source->data.paged.hydrated == NULL && cached(source) == cached_before,
          "its source stays lazy, the cache as it was");
    if (rows) {
        EastValue *extra = east_integer(31);
        east_dict_set(rows, extra, extra);
        check(east_dict_len(view) == 11 && east_dict_has(view, extra),
              "a view changed is its own rows changed");
        check(narrower && east_dict_len(narrower) == 8 && !east_dict_has(narrower, extra),
              "and no other view of the source sees it");
        east_value_release(extra);
    }
    EastValue *of_decoded = int_view(view, 30, 39);
    char *refused = east_builtin_get_error();
    check(of_decoded == NULL && refused != NULL,
          "a view is taken of a collection that still reads from its pager");
    free(refused);
    if (of_decoded) east_value_release(of_decoded);
    if (narrower) east_value_release(narrower);
    east_value_release(view);
    east_value_release(source);

    /* A source decoded whole, and changed, after a range is taken of it. */
    EastValue *plain = open_lazy(blob, type, false);
    EastValue *taken = int_view(plain, 30, 60);
    EastValue *all = east_paged_hydrated(plain);
    check(all != NULL && !east_value_frozen(all), "a source opened plain decodes whole");
    if (all) {
        east_dict_delete(all, inside);
        check(!east_dict_has(plain, inside), "the source is changed");
    }
    check(east_dict_len(taken) == 10 && east_dict_has(taken, inside),
          "a range taken before its source was decoded and changed holds what it held");
    east_value_release(taken);
    east_value_release(plain);

    /* A view a host brands frozen as it makes it: read-only, its rows frozen too. */
    EastValue *kept = open_lazy(blob, type, true);
    EastValue *read_only = int_view(kept, 30, 60);
    east_value_set_frozen(read_only);
    EastValue *frozen_rows = east_paged_hydrated(read_only);
    check(east_value_frozen(read_only) && frozen_rows && east_value_frozen(frozen_rows) &&
              east_dict_len(frozen_rows) == 10,
          "a view branded frozen decodes its rows into a frozen collection");
    check(kept->data.paged.hydrated == NULL, "and leaves its source lazy");
    east_value_release(read_only);
    east_value_release(kept);

    /* The source outlives a view that is all that holds it. */
    EastValue *held = open_lazy(blob, type, true);
    EastValue *only = int_view(held, 30, 60);
    east_value_release(held);
    check(east_dict_len(only) == 10 && east_dict_has(only, inside),
          "a view holds its source: it reads on once nothing else does");
    east_value_release(only);

    east_value_release(between);
    east_value_release(outside);
    east_value_release(inside);
    byte_buffer_free(blob);
    east_value_release(whole);
    east_type_release(type);
}

/* ---- 6: exactness ---------------------------------------------------------- */

/* The rows [lo, hi) a walk of `whole` keeps between two ends, each a bound
 * with its type and whether it is the first key past it. */
static void oracle(EastValue *whole, EastValue *from, EastType *from_type, bool from_past,
                   EastValue *to, EastType *to_type, bool to_past, size_t *lo, size_t *hi)
{
    size_t n = east_dict_len(whole);
    *lo = 0;
    *hi = n;
    if (from) {
        while (*lo < n) {
            int c = east_key_bound_compare(east_dict_key_at(whole, *lo), from, from_type);
            if (from_past ? c > 0 : c >= 0) break;
            (*lo)++;
        }
    }
    if (to) {
        *hi = 0;
        while (*hi < n) {
            int c = east_key_bound_compare(east_dict_key_at(whole, *hi), to, to_type);
            if (to_past ? c > 0 : c >= 0) break;
            (*hi)++;
        }
    }
    if (*hi < *lo) *hi = *lo;
}

static void test_exactness(void)
{
    EastType *key_type = sheet_key_type(2);
    EastType *press_type = sheet_key_type(1);
    EastType *type = east_dict_type(key_type, &east_integer_type);
    EastValue *whole = sheet_dict(key_type);
    ByteBuffer *blob = encode_in_segments(whole, type, PER_SEGMENT, true);
    EastValue *source = open_lazy(blob, type, true);
    check(source != NULL, "the struct-keyed fixture opens");

    bool sizes = true, walks = true, decodes = true, hosts = true, keyed = true, narrowed = true;
    for (int trial = 0; source && trial < 400; trial++) {
        /* Each end: left out, a whole key, or the key's first field; a prefix now and then. */
        EastValue *ends[2] = {NULL, NULL};
        EastType *types[2] = {key_type, key_type};
        bool past[2] = {false, false};
        bool prefix = rng() % 5 == 0;
        for (int e = 0; e < 2; e++) {
            uint32_t pick = prefix ? 2 : rng() % 3;
            size_t press = rng() % (SEGMENTS + 2); /* two presses past the last */
            if (pick == 1) {
                ends[e] = sheet_key(press, (int64_t)(rng() % (PER_SEGMENT + 2)), key_type);
            } else if (pick == 2) {
                ends[e] = sheet_key(press, 0, press_type);
                types[e] = press_type;
            }
        }
        if (prefix) {
            /* The entries at a prefix: from the first key at it up to the first past it. */
            east_value_release(ends[1]);
            ends[1] = ends[0];
            east_value_retain(ends[1]);
            past[1] = true;
        }
        size_t lo, hi;
        oracle(whole, ends[0], types[0], past[0], ends[1], types[1], past[1], &lo, &hi);

        EastValue *view = east_beast2_open_paged_range(source, ends[0], types[0], past[0], ends[1],
                                                       types[1], past[1]);
        if (!view) {
            sizes = false;
        } else {
            if (east_dict_len(view) != hi - lo) sizes = false;
            /* Its walk: the keys of rows lo to hi, in order. */
            Beast2Pages *p = view->data.paged.pages;
            size_t at = lo;
            size_t n = east_beast2_pages_segment_count(p);
            for (size_t k = 0; k < n; k++) {
                EastValue *seg = east_beast2_pages_segment_disjoint(p, k);
                if (!seg) {
                    walks = false;
                    break;
                }
                for (size_t i = 0; i < east_dict_len(seg); i++, at++) {
                    if (at >= hi ||
                        !east_value_equal(east_dict_key_at(seg, i), east_dict_key_at(whole, at)))
                        walks = false;
                }
                east_value_release(seg);
            }
            if (at != hi) walks = false;
            /* A keyed read of each of a few rows: inside the range or absent. */
            for (int probe = 0; probe < 4; probe++) {
                size_t row = rng() % ROWS;
                bool has = east_dict_has(view, east_dict_key_at(whole, row));
                if (has != (row >= lo && row < hi)) keyed = false;
            }
            /* A range of it, by two more ends: the rows both ranges hold,
             * and the host's row range of the view, numbered from its first. */
            EastValue *in_ends[2] = {NULL, NULL};
            EastType *in_types[2] = {key_type, key_type};
            for (int e = 0; e < 2; e++) {
                uint32_t pick = rng() % 3;
                size_t press = rng() % (SEGMENTS + 2);
                if (pick == 1) {
                    in_ends[e] = sheet_key(press, (int64_t)(rng() % (PER_SEGMENT + 2)), key_type);
                } else if (pick == 2) {
                    in_ends[e] = sheet_key(press, 0, press_type);
                    in_types[e] = press_type;
                }
            }
            size_t in_lo, in_hi;
            oracle(whole, in_ends[0], in_types[0], false, in_ends[1], in_types[1], false, &in_lo,
                   &in_hi);
            if (in_lo < lo) in_lo = lo;
            if (in_hi > hi) in_hi = hi;
            if (in_hi < in_lo) in_hi = in_lo;
            /* Within an empty range every range is empty, wherever its ends are. */
            size_t both = hi > lo ? in_hi - in_lo : 0;
            EastValue *inner = east_beast2_open_paged_range(view, in_ends[0], in_types[0], false,
                                                            in_ends[1], in_types[1], false);
            if (!inner || east_dict_len(inner) != both) {
                narrowed = false;
            } else if (both > 0) {
                Beast2Pages *ip = inner->data.paged.pages;
                EastValue *seg = east_beast2_pages_segment_disjoint(ip, 0);
                if (!seg ||
                    !east_value_equal(east_dict_key_at(seg, 0), east_dict_key_at(whole, in_lo)))
                    narrowed = false;
                if (seg) east_value_release(seg);
            }
            size_t view_lo = 0, view_hi = 0;
            if (!east_beast2_pages_range(p, in_ends[0], in_types[0], false, in_ends[1], in_types[1],
                                         false, &view_lo, &view_hi) ||
                view_hi - view_lo != both || (both > 0 && view_lo != in_lo - lo))
                narrowed = false;
            if (inner) east_value_release(inner);
            if (in_ends[0]) east_value_release(in_ends[0]);
            if (in_ends[1]) east_value_release(in_ends[1]);
            /* Its own rows, decoded. */
            EastValue *rows = east_paged_hydrated(view);
            if (!rows || east_dict_len(rows) != hi - lo || east_value_frozen(rows)) {
                decodes = false;
            } else {
                for (size_t i = 0; i < hi - lo; i++) {
                    if (!east_value_equal(east_dict_key_at(rows, i),
                                          east_dict_key_at(whole, lo + i)) ||
                        !east_value_equal(east_dict_val_at(rows, i),
                                          east_dict_val_at(whole, lo + i)))
                        decodes = false;
                }
            }
            east_value_release(view);
        }
        /* The host's call, on the pager itself. */
        size_t host_lo = 0, host_hi = 0;
        if (!east_beast2_pages_range(source->data.paged.pages, ends[0], types[0], past[0], ends[1],
                                     types[1], past[1], &host_lo, &host_hi) ||
            host_lo != lo || host_hi != hi)
            hosts = false;
        if (ends[0]) east_value_release(ends[0]);
        if (ends[1]) east_value_release(ends[1]);
    }
    check(sizes, "a view's size is what a walk of the whole keeps");
    check(walks, "a view's walk is those rows, in order");
    check(keyed, "a keyed read of a view finds the rows inside it and no other");
    check(decodes, "a view's own rows, decoded, are those rows and their values, not frozen");
    check(hosts, "the host's row range is those rows");
    check(narrowed, "a range of a range, and the host's row range of one, are the rows both hold");

    /* A prefix that is one segment: the segment before it and its own, each once. */
    if (source) {
        EastValue *fresh = open_lazy(blob, type, true);
        EastValue *p3 = sheet_key(3, 0, press_type);
        EastValue *prefix =
            east_beast2_open_paged_range(fresh, p3, press_type, false, p3, press_type, true);
        check_count(prefix ? east_dict_len(prefix) : 0, PER_SEGMENT, "a prefix holds its press");
        check_count(decoded(fresh), 2,
                    "a prefix that is one segment: segments decoded for its size");
        size_t rows;
        int64_t sum;
        Beast2Pages *pp = prefix->data.paged.pages;
        size_t n = east_beast2_pages_segment_count(pp);
        rows = 0;
        (void)sum;
        for (size_t k = 0; k < n; k++) {
            EastValue *seg = east_beast2_pages_segment_disjoint(pp, k);
            rows += seg ? east_dict_len(seg) : 0;
            if (seg) east_value_release(seg);
        }
        check_count(rows, PER_SEGMENT, "the prefix is walked");
        check_count(decoded(fresh), 2, "and walking it decodes nothing more");
        EastValue *from4 = sheet_key(3, 4, key_type);
        EastValue *tail =
            east_beast2_open_paged_range(prefix, from4, key_type, false, NULL, NULL, false);
        check_count(tail ? east_dict_len(tail) : 0, 4, "a range of the prefix");
        check_count(decoded(fresh), 2, "reads through the segments already held");
        if (tail) east_value_release(tail);
        east_value_release(from4);
        east_value_release(prefix);
        east_value_release(p3);
        east_value_release(fresh);
    }

    if (source) east_value_release(source);
    if (blob) byte_buffer_free(blob);
    east_value_release(whole);
    east_type_release(type);
    east_type_release(press_type);
    east_type_release(key_type);
}

/* ---- 7: the refusals -------------------------------------------------------- */

static void check_refused(bool refused, const char *words, const char *what)
{
    char *error = east_builtin_get_error();
    bool same = refused && error && (!words || strcmp(error, words) == 0);
    if (!same) printf("  got: %s\n  want: %s\n", error ? error : "(none)", words ? words : "(any)");
    free(error);
    check(same, what);
}

static void test_refusals(void)
{
    EastType *key_type = sheet_key_type(2);
    const char *job_name[] = {"job"};
    EastType *job_types[] = {&east_integer_type};
    EastType *job_only = east_struct_type(job_name, job_types, 1);
    EastType *type = east_dict_type(key_type, &east_integer_type);
    EastValue *whole = sheet_dict(key_type);
    ByteBuffer *blob = encode_in_segments(whole, type, PER_SEGMENT, true);
    EastValue *source = open_lazy(blob, type, true);
    EastValue *j = east_integer(1);
    EastValue *bound = east_struct_new(job_name, &j, 1, job_only);
    size_t lo, hi;

    EastValue *view =
        east_beast2_open_paged_range(source, bound, job_only, false, NULL, NULL, false);
    check_refused(view == NULL,
                  "a range's `from` is no leading part of the key: a bound gives the key's first "
                  "fields in order \xe2\x80\x94 press, job",
                  "a view refuses a `from` that is no leading part of the key");
    view = east_beast2_open_paged_range(source, NULL, NULL, false, bound, job_only, false);
    check_refused(view == NULL,
                  "a range's `to` is no leading part of the key: a bound gives the key's first "
                  "fields in order \xe2\x80\x94 press, job",
                  "a view refuses a `to` that is no leading part of the key");
    check_refused(!east_beast2_pages_range(source->data.paged.pages, bound, job_only, false, NULL,
                                           NULL, false, &lo, &hi),
                  "a range's `from` is no leading part of the key: a bound gives the key's first "
                  "fields in order \xe2\x80\x94 press, job",
                  "the host's call refuses it in the same words");
    check_refused(east_beast2_open_paged_range(whole, NULL, NULL, false, NULL, NULL, false) == NULL,
                  NULL, "a view is taken of a paged value, not of a collection held in memory");

    /* An Array root. */
    EastType *array_type = east_array_type(&east_integer_type);
    EastValue *array = east_array_new(&east_integer_type);
    for (int i = 0; i < 20; i++) {
        EastValue *v = east_integer(i);
        east_array_push(array, v);
        east_value_release(v);
    }
    ByteBuffer *array_blob = east_beast2_encode_paged(array, array_type, EAST_BEAST2_CODEC_NONE);
    EastValue *paged_array = array_blob ? open_lazy(array_blob, array_type, true) : NULL;
    check(paged_array != NULL, "an Array opens lazily");
    if (paged_array) {
        EastValue *three = east_integer(3);
        check_refused(east_beast2_open_paged_range(paged_array, three, &east_integer_type, false,
                                                   NULL, NULL, false) == NULL,
                      "beast2 v5: a key range addresses Set and Dict roots",
                      "a view of an Array root is refused");
        check_refused(!east_beast2_pages_range(paged_array->data.paged.pages, three,
                                               &east_integer_type, false, NULL, NULL, false, &lo,
                                               &hi),
                      "beast2 v5: a key range addresses Set and Dict roots",
                      "and so is the host's call on one");
        east_value_release(three);
        east_value_release(paged_array);
    }
    if (array_blob) byte_buffer_free(array_blob);
    east_value_release(array);
    east_type_release(array_type);

    /* Segments that are not self-contained: refused where a keyed read is. */
    ByteBuffer *aliased = encode_in_segments(whole, type, PER_SEGMENT, false);
    Beast2Pages *pages = aliased ? east_beast2_pages_new(aliased->data, aliased->len, type) : NULL;
    if (pages && !east_beast2_pages_self_contained(pages)) {
        EastValue *key = sheet_key(3, 0, key_type);
        check_refused(
            !east_beast2_pages_range(pages, key, key_type, false, NULL, NULL, false, &lo, &hi),
            "beast2 v5: blob has cross-segment aliasing \xe2\x80\x94 random access needs "
            "self-contained segments",
            "a range of a blob whose segments are not self-contained is refused");
        east_value_release(key);
    }
    if (pages) east_beast2_pages_free(pages);
    if (aliased) byte_buffer_free(aliased);

    east_value_release(bound);
    east_value_release(j);
    east_value_release(source);
    byte_buffer_free(blob);
    east_value_release(whole);
    east_type_release(type);
    east_type_release(job_only);
    east_type_release(key_type);
}

/* ---- 8: a range narrowed again and again ------------------------------------ */

/* Runs `fn` on a thread whose stack is 1 MiB — less than a main thread's 8,
 * as a worker's may be — where a recursion as deep as a body may narrow a
 * range does not fit. On Windows, on the main thread: a thread's stack
 * reservation is not honoured reliably there (compat.h). */
static void on_small_stack(void *(*fn)(void *), void *arg)
{
#ifdef _WIN32
    fn(arg);
#else
    pthread_attr_t attr;
    pthread_attr_init(&attr);
    pthread_attr_setstacksize(&attr, (size_t)1024 * 1024);
    pthread_t t;
    if (pthread_create(&t, &attr, fn, arg) != 0) {
        printf("FAIL: a thread with a 1 MiB stack starts\n");
        failures++;
    } else {
        pthread_join(t, NULL);
    }
    pthread_attr_destroy(&attr);
#endif
}

/* Each narrowing starts at a key of the first four segments, the most a later
 * one starts at 89: the range ends as the rows from key 90 on. */
#define DEEP 100000

static int64_t deep_bound(size_t i)
{
    return (int64_t)(i % 90);
}

/* A range of `source` narrowed DEEP times, each from a key, and the ranges
 * between let go as a body's `window = window.range({ from })` lets them go:
 * each is held by the next alone. */
static EastValue *narrowed_deep(EastValue *source)
{
    EastValue *range = source;
    east_value_retain(range);
    for (size_t i = 0; range && i < DEEP; i++) {
        EastValue *next = int_view(range, deep_bound(i), -1);
        east_value_release(range);
        range = next;
    }
    return range;
}

static void *narrow_deep(void *arg)
{
    ByteBuffer *blob = arg;
    EastType *type = east_dict_type(&east_integer_type, &east_integer_type);
    EastValue *source = open_lazy(blob, type, true);
    EastValue *k87 = east_integer(87);
    EastValue *k90 = east_integer(90);
    EastValue *k285 = east_integer(285);

    EastValue *range = narrowed_deep(source);
    check(range != NULL, "a range is narrowed a hundred thousand times");
    if (range) {
        check_count(decoded(source), 0, "a range narrowed a hundred thousand times reads nothing");
        check(!east_dict_has(range, k87),
              "a keyed read before it is placed tests every bound, by a loop");
        check_count(decoded(source), 0, "which reads nothing");
        check(east_dict_has(range, k285), "a key within every bound");
        check_count(decoded(source), 1, "is the source's keyed read");
        check_count(east_dict_len(range), ROWS - 30, "its size: the rows from key 90 on");
        check_count(decoded(source), 5,
                    "its ends placed by a loop, through the cache: each of the four segments the "
                    "bounds land in, once");
        check(!east_dict_has(range, k87) && decoded(source) == 5,
              "placed, it holds its rows by their first key and the first past them");
        check(east_dict_has(range, k90), "its first row's key is within it");
        size_t rows;
        int64_t sum;
        check(walk(range, &rows, &sum) && rows == ROWS - 30 &&
                  sum == 3 * (int64_t)((ROWS - 1) * ROWS / 2 - 29 * 30 / 2),
              "a walk of it reads its rows");
        EastValue *tail = int_view(range, 282, -1);
        check_count(tail ? east_dict_len(tail) : 0, 2,
                    "a range of it reads as a range of one range");
        if (tail) east_value_release(tail);
        east_value_release(range);
    }

    /* A chain never read is let go by a loop. */
    size_t before = decoded(source);
    EastValue *unread = narrowed_deep(source);
    check(unread != NULL, "a range is narrowed a hundred thousand times again");
    if (unread) east_value_release(unread);
    check_count(decoded(source), before, "a range never read is let go, and reads nothing");

    east_value_release(k285);
    east_value_release(k90);
    east_value_release(k87);
    east_value_release(source);
    east_type_release(type);
    return NULL;
}

static void test_narrowed_deep(void)
{
    EastType *type = east_dict_type(&east_integer_type, &east_integer_type);
    EastValue *whole = int_dict(ROWS);
    ByteBuffer *blob = encode_in_segments(whole, type, PER_SEGMENT, true);
    check(blob != NULL, "the fixture encodes");
    if (blob) {
        on_small_stack(narrow_deep, blob);
        byte_buffer_free(blob);
    }
    east_value_release(whole);
    east_type_release(type);
}

/* ---- 9: a placed view's keys, its account, its fences, its projection ------- */

/* `blob` with segments `s` and `s + 1` in each other's place, spliced as a
 * host splices segment frames: every segment whole, the index true to where
 * each now is — and its fences no longer ascending, which no writer writes. */
static ByteBuffer *swap_segments(ByteBuffer *blob, size_t s)
{
    Beast2SpliceExtents *e = east_beast2_splice_extents(blob->data, blob->len);
    if (!e || e->segment_count < s + 3) {
        if (e) east_beast2_splice_extents_free(e);
        return NULL;
    }
    size_t first = e->offsets[s + 1] - e->offsets[s];
    size_t second = e->offsets[s + 2] - e->offsets[s + 1];
    size_t *offsets = malloc(e->segment_count * sizeof(size_t));
    size_t *counts = malloc(e->segment_count * sizeof(size_t));
    ByteBuffer *out = byte_buffer_new(blob->len);
    ByteBuffer *tail = NULL;
    if (offsets && counts && out) {
        memcpy(offsets, e->offsets, e->segment_count * sizeof(size_t));
        memcpy(counts, e->counts, e->segment_count * sizeof(size_t));
        offsets[s + 1] = offsets[s] + second;
        counts[s] = e->counts[s + 1];
        counts[s + 1] = e->counts[s];
        byte_buffer_write_bytes(out, blob->data, e->offsets[s]);
        byte_buffer_write_bytes(out, blob->data + e->offsets[s + 1], second);
        byte_buffer_write_bytes(out, blob->data + e->offsets[s], first);
        byte_buffer_write_bytes(out, blob->data + e->offsets[s + 2],
                                e->segments_end - e->offsets[s + 2]);
        tail = east_beast2_splice_tail(offsets, counts, e->segment_count, e->segments_end);
        if (tail) byte_buffer_write_bytes(out, tail->data, tail->len);
    }
    if (tail) byte_buffer_free(tail);
    free(offsets);
    free(counts);
    east_beast2_splice_extents_free(e);
    if (!tail && out) {
        byte_buffer_free(out);
        out = NULL;
    }
    return out;
}

static void test_placed_view(void)
{
    EastType *type = east_dict_type(&east_integer_type, &east_integer_type);
    EastValue *whole = int_dict(ROWS);
    ByteBuffer *blob = encode_in_segments(whole, type, PER_SEGMENT, true);
    free(east_builtin_get_error());

    /* A placed view holds its rows: a key before its first reads nothing,
     * though it is within its bounds. A cache of one segment: placing the end
     * at 59 lets go the segment placing the end at 22 read. */
    EastValue *source = open_lazy(blob, type, true);
    east_beast2_pages_set_cache_budget(source->data.paged.pages, 1);
    EastValue *view = int_view(source, 22, 59); /* its rows: the keys 24 to 57 */
    check_count(east_dict_len(view), 12, "a view between two keys that are no row's");
    check_count(decoded(source), 2, "segments decoded to place it");
    EastValue *k3 = east_integer(3), *k23 = east_integer(23), *k57 = east_integer(57),
              *k59 = east_integer(59);
    check(!east_dict_has(view, k23), "a key past its `from` and before its first row's is absent");
    check_count(decoded(source), 2, "and nothing is read to say so");
    check(!east_dict_has(view, k59), "its `to` is absent");
    EastValue *value = NULL;
    check(east_beast2_pages_get_key(view->data.paged.pages, k57, &value) == 1 && value &&
              value->data.integer == 190,
          "its last row is the source's keyed read");
    if (value) east_value_release(value);
    check(!east_dict_has(view, k3), "a key before its bounds is absent");
    east_value_release(k59);
    east_value_release(k57);
    east_value_release(k23);
    east_value_release(k3);
    east_value_release(view);
    east_value_release(source);

    /* Its account: the segments its source is stored in, and nothing placed. */
    source = open_lazy(blob, type, true);
    view = int_view(source, 30, 60);
    size_t segments = 0, segments_decoded = 1, fences_probed = 1;
    bool hydrated = true;
    check(east_paged_stats(view, &segments, &segments_decoded, &fences_probed, &hydrated),
          "a view has an account");
    check_count(segments, SEGMENTS, "a view's account names the segments its source is stored in");
    check(segments_decoded == 0 && fences_probed == 0 && !hydrated,
          "and asking for it places nothing: no segment or fence is read");
    east_value_release(view);
    east_value_release(source);

    /* A blob whose segments 1 and 2 are in each other's place. */
    ByteBuffer *swapped = blob ? swap_segments(blob, 1) : NULL;
    check(swapped != NULL, "a blob is spliced with segments 1 and 2 in each other's place");
    if (swapped) {
        source = open_lazy(swapped, type, true);
        view = int_view(source, 30, 60);
        segments = 0;
        check(east_paged_stats(view, &segments, NULL, NULL, NULL) && segments == SEGMENTS,
              "the account of a view whose ends cannot be placed names its source's segments");
        char *posted = east_builtin_get_error();
        check(posted == NULL, "and leaves no refusal posted for a later read to find");
        free(posted);
        east_value_release(view);

        /* Both ends open: its first segment is read as a keyed read reads one,
         * its source's fences verified first — so no row is served before the
         * refusal, as none is from the source's own loop. */
        view = int_view(source, -1, -1);
        EastValue *seg = east_beast2_pages_segment_disjoint(view->data.paged.pages, 0);
        char *refused = east_builtin_get_error();
        check(seg == NULL && refused && strstr(refused, "are not disjoint ascending key ranges"),
              "the first segment of a range with both ends open is refused when its source's "
              "fences do not ascend");
        free(refused);
        if (seg) east_value_release(seg);
        east_value_release(view);
        east_value_release(source);
        byte_buffer_free(swapped);
    }

    /* Which segments a loop's projection decodes: those between the ends. */
    source = open_lazy(blob, type, true);
    view = int_view(source, 30, 108); /* four segments */
    Beast2Pages *vp = view->data.paged.pages;
    check(!east_beast2_pages_segment_projects(vp, 0) && east_beast2_pages_segment_projects(vp, 1) &&
              east_beast2_pages_segment_projects(vp, 2) &&
              !east_beast2_pages_segment_projects(vp, 3) &&
              !east_beast2_pages_segment_projects(vp, 4),
          "a view's segments between its ends decode to a projection, and its end segments do "
          "not: they are read whole, through the cache");
    check(east_beast2_pages_segment_projects(source->data.paged.pages, 0),
          "a Dict's segments decode to a projection");
    east_value_release(view);
    east_value_release(source);
    EastType *set_type = east_set_type(&east_integer_type);
    EastValue *keys = east_set_new(&east_integer_type);
    for (size_t i = 0; i < ROWS; i++) {
        EastValue *k = east_integer((int64_t)(3 * i));
        east_set_insert(keys, k);
        east_value_release(k);
    }
    ByteBuffer *set_blob = encode_in_segments(keys, set_type, PER_SEGMENT, true);
    EastValue *set_source = set_blob ? open_lazy(set_blob, set_type, true) : NULL;
    if (set_source) {
        EastValue *from = east_integer(30), *to = east_integer(108);
        EastValue *set_view = east_beast2_open_paged_range(set_source, from, &east_integer_type,
                                                           false, to, &east_integer_type, false);
        check(!east_beast2_pages_segment_projects(set_source->data.paged.pages, 0) && set_view &&
                  !east_beast2_pages_segment_projects(set_view->data.paged.pages, 1),
              "a Set's segments, its keys, never decode to a projection — nor a range's of one");
        if (set_view) east_value_release(set_view);
        east_value_release(to);
        east_value_release(from);
        east_value_release(set_source);
    }
    if (set_blob) byte_buffer_free(set_blob);
    east_value_release(keys);
    east_type_release(set_type);

    if (blob) byte_buffer_free(blob);
    east_value_release(whole);
    east_type_release(type);
}

/* ---- 10: a range's rows, from a pager that keeps no view -------------------- */

/* Dict<Integer, { amount: Integer, tags: Array<Integer> }>: 3·i -> { 10·i, [i] }. */
static EastValue *tagged_dict(EastType *row_type)
{
    const char *names[] = {"amount", "tags"};
    EastValue *dict = east_dict_new(&east_integer_type, row_type);
    for (size_t i = 0; i < ROWS; i++) {
        EastValue *k = east_integer((int64_t)(3 * i));
        EastValue *amount = east_integer((int64_t)(10 * i));
        EastValue *tags = east_array_new(&east_integer_type);
        EastValue *tag = east_integer((int64_t)i);
        east_array_push(tags, tag);
        EastValue *fields[] = {amount, tags};
        EastValue *row = east_struct_new(names, fields, 2, row_type);
        east_dict_set(dict, k, row);
        east_value_release(row);
        east_value_release(tag);
        east_value_release(tags);
        east_value_release(amount);
        east_value_release(k);
    }
    return dict;
}

/* The tags of the row at `key`, or NULL. Borrowed. */
static EastValue *tags_at(EastValue *rows, int64_t key, size_t field)
{
    EastValue *k = east_integer(key);
    EastValue *row = east_dict_get(rows, k);
    east_value_release(k);
    return row ? east_struct_get_field_idx(row, field) : NULL;
}

static void test_range_rows(void)
{
    const char *names[] = {"amount", "tags"};
    EastType *tags_type = east_array_type(&east_integer_type);
    EastType *field_types[] = {&east_integer_type, tags_type};
    EastType *row_type = east_struct_type(names, field_types, 2);
    EastType *type = east_dict_type(&east_integer_type, row_type);
    EastValue *whole = tagged_dict(row_type);
    ByteBuffer *blob = encode_in_segments(whole, type, PER_SEGMENT, true);
    check(blob != NULL, "the tagged fixture encodes");
    Beast2Pages *pages = blob ? east_beast2_pages_new(blob->data, blob->len, type) : NULL;
    check(pages != NULL, "a pager opens over it, as a file's does");
    if (!pages) goto done;
    EastValue *from = east_integer(30), *to = east_integer(108);

    /* Across four segments: its ends through the cache, the two between fresh. */
    EastValue *rows = east_beast2_pages_range_rows(pages, from, &east_integer_type, false, to,
                                                   &east_integer_type, false);
    check(rows != NULL && east_dict_len(rows) == 26, "a range's rows, read from the pager");
    size_t n = 0;
    east_beast2_pages_stats(pages, &n, NULL);
    check_count(n, 4, "segments decoded for them: the four the range spans, each once");
    Beast2PagesCacheStats cache;
    east_beast2_pages_cache_stats(pages, &cache);
    check_count(cache.segments, 2, "the cache holding its two end segments alone");
    if (rows) {
        bool exact = true;
        for (size_t i = 0; i < 26; i++)
            if (east_dict_key_at(rows, i)->data.integer != (int64_t)(30 + 3 * i)) exact = false;
        check(exact, "its rows are the keys 30 to 105, in order");
        EastValue *end_tags = tags_at(rows, 30, 1);
        EastValue *between_tags = tags_at(rows, 60, 1);
        check(east_value_frozen(rows) && end_tags && east_value_frozen(end_tags) && between_tags &&
                  east_value_frozen(between_tags),
              "they are frozen at every depth: a row's array, from an end segment and from one "
              "between the ends");
        east_value_release(rows);
    }
    rows = east_beast2_pages_range_rows(pages, from, &east_integer_type, false, to,
                                        &east_integer_type, false);
    east_beast2_pages_stats(pages, &n, NULL);
    check(rows != NULL && n == 6,
          "read again: the end segments are the cache's, and the two between decode again");
    if (rows) east_value_release(rows);

    /* Both ends open: every row, the fences verified first. */
    rows = east_beast2_pages_range_rows(pages, NULL, NULL, false, NULL, NULL, false);
    check(rows != NULL && east_dict_len(rows) == ROWS, "a range with both ends open: every row");
    if (rows) east_value_release(rows);

    /* Under a projection set at open: its rows are the projected ones. */
    const char *tags_name[] = {"tags"};
    EastType *tags_only_types[] = {tags_type};
    EastType *tags_only = east_struct_type(tags_name, tags_only_types, 1);
    EastType *projected = east_dict_type(&east_integer_type, tags_only);
    Beast2Projection *pr = east_beast2_projection_new(type, projected);
    Beast2Pages *narrow = pr ? east_beast2_pages_new(blob->data, blob->len, type) : NULL;
    check(narrow != NULL, "a pager opens under a projection");
    if (narrow) {
        east_beast2_pages_set_projection(narrow, pr);
        rows = east_beast2_pages_range_rows(narrow, from, &east_integer_type, false, to,
                                            &east_integer_type, false);
        EastValue *row = NULL;
        if (rows) {
            EastValue *k = east_integer(60);
            row = east_dict_get(rows, k);
            east_value_release(k);
        }
        check(rows != NULL && east_dict_len(rows) == 26 && row &&
                  row->data.struct_.num_fields == 1 &&
                  east_value_frozen(east_struct_get_field_idx(row, 0)),
              "under a projection, the range's rows are the projected ones, frozen");
        if (rows) east_value_release(rows);
        east_beast2_pages_free(narrow);
    }
    if (pr) east_beast2_projection_free(pr);
    east_type_release(projected);
    east_type_release(tags_only);

    /* The refusals: a bound that is no leading part of the key, and a view. */
    EastValue *word = east_string("P03");
    check_refused(east_beast2_pages_range_rows(pages, word, &east_string_type, false, NULL, NULL,
                                               false) == NULL,
                  NULL, "a bound of another type than the key is refused");
    east_value_release(word);
    EastValue *source = open_lazy(blob, type, true);
    EastValue *view = source ? int_view(source, 30, 60) : NULL;
    check_refused(view && east_beast2_pages_range_rows(view->data.paged.pages, NULL, NULL, false,
                                                       NULL, NULL, false) == NULL,
                  "beast2 v5: a range's rows are read from the pager of its source, not of a "
                  "range",
                  "a view's pager is refused: a range of a range is taken of the view");
    if (view) east_value_release(view);
    if (source) east_value_release(source);

    east_value_release(to);
    east_value_release(from);
    east_beast2_pages_free(pages);
done:
    if (blob) byte_buffer_free(blob);
    east_value_release(whole);
    east_type_release(type);
    east_type_release(row_type);
    east_type_release(tags_type);
}

/* ---- timings, when asked for ------------------------------------------------ */

static double now_ms(void)
{
    struct timespec ts;
    clock_gettime(CLOCK_MONOTONIC, &ts);
    return (double)ts.tv_sec * 1e3 + (double)ts.tv_nsec / 1e6;
}

/* The rows of a view, walked as a loop walks them; -1 when a read fails. */
static long walk_rows(EastValue *view)
{
    Beast2Pages *p = view->data.paged.pages;
    if (!east_beast2_pages_prepare(p)) return -1;
    long rows = 0;
    size_t n = east_beast2_pages_segment_count(p);
    for (size_t k = 0; k < n; k++) {
        EastValue *seg = east_beast2_pages_segment_disjoint(p, k);
        if (!seg) return -1;
        rows += (long)east_dict_len(seg);
        east_value_release(seg);
    }
    return rows;
}

/* EAST_C_RANGE_BENCH=1: what a range read costs in time, over sheets keyed
 * { press, job } — 2,000 presses of 500 jobs, cut by the writer's own rule.
 * A count holds the gate; this says what the counts come to on this machine. */
static void report_timings(void)
{
    const char *bench = getenv("EAST_C_RANGE_BENCH");
    if (!bench || strcmp(bench, "1") != 0) return;
    enum { PRESSES = 2000, JOBS = 500 };
    EastType *key_type = sheet_key_type(2);
    EastType *press_type = sheet_key_type(1);
    EastType *type = east_dict_type(key_type, &east_integer_type);
    EastValue *whole = east_dict_new(key_type, &east_integer_type);
    for (size_t i = 0; i < (size_t)PRESSES * JOBS; i++) {
        char name[16];
        snprintf(name, sizeof(name), "P%05zu", i / JOBS);
        EastValue *p = east_string(name);
        EastValue *j = east_integer((int64_t)(i % JOBS));
        const char *names[] = {"press", "job"};
        EastValue *values[] = {p, j};
        EastValue *k = east_struct_new(names, values, 2, key_type);
        EastValue *v = east_integer((int64_t)i);
        east_dict_set(whole, k, v);
        east_value_release(v);
        east_value_release(k);
        east_value_release(j);
        east_value_release(p);
    }
    ByteBuffer *blob = east_beast2_encode_paged(whole, type, EAST_BEAST2_CODEC_DEFLATE);
    east_value_release(whole);
    if (!blob) {
        printf("  range bench: the table does not encode\n");
        return;
    }
    EastValue *bounds[PRESSES];
    for (size_t i = 0; i < PRESSES; i++) {
        char name[16];
        snprintf(name, sizeof(name), "P%05zu", i);
        EastValue *p = east_string(name);
        const char *names[] = {"press"};
        bounds[i] = east_struct_new(names, &p, 1, press_type);
        east_value_release(p);
    }
#define PREFIX_OF(source, i)                                                                       \
    east_beast2_open_paged_range(source, bounds[i], press_type, false, bounds[i], press_type, true)

    EastValue *source = open_lazy(blob, type, true);
    size_t segments = east_beast2_pages_segment_count(source->data.paged.pages);
    printf("  range bench: %d rows in %zu segments, %.1f MB stored\n", PRESSES * JOBS, segments,
           (double)blob->len / 1e6);

    /* The first range read of a pager: the fences are verified, once. */
    double t0 = now_ms();
    EastValue *first = PREFIX_OF(source, PRESSES / 2);
    long rows = first ? (long)east_dict_len(first) : -1;
    double t1 = now_ms();
    printf("  the first range read on a pager, its fences verified: %.2f ms (%ld rows)\n", t1 - t0,
           rows);
    if (first) east_value_release(first);

    /* A short run whose segments the cache does not hold: a cache of one
     * segment, and presses far apart. */
    east_beast2_pages_set_cache_budget(source->data.paged.pages, 1);
    size_t before = decoded(source);
    int cold = 400;
    t0 = now_ms();
    for (int i = 0; i < cold; i++) {
        EastValue *view = PREFIX_OF(source, ((size_t)i * 997) % PRESSES);
        rows = view ? walk_rows(view) : -1;
        if (view) east_value_release(view);
    }
    t1 = now_ms();
    printf("  a run of %d rows, not held: %.3f ms each (%.1f segments decoded each)\n", JOBS,
           (t1 - t0) / cold, (double)(decoded(source) - before) / cold);
    east_value_release(source);

    /* The same run again and again: its segments held. */
    source = open_lazy(blob, type, true);
    EastValue *warm = PREFIX_OF(source, PRESSES / 2);
    rows = warm ? walk_rows(warm) : -1;
    if (warm) east_value_release(warm);
    before = decoded(source);
    int held = 20000;
    t0 = now_ms();
    for (int i = 0; i < held; i++) {
        EastValue *view = PREFIX_OF(source, PRESSES / 2);
        rows = view ? (long)east_dict_len(view) : -1;
        if (view) east_value_release(view);
    }
    t1 = now_ms();
    printf("  the size of a run, its segments held: %.2f us each (%zu segments decoded)\n",
           (t1 - t0) * 1e3 / held, decoded(source) - before);
    east_value_release(source);

    /* Every press in key order, as an index is read. */
    source = open_lazy(blob, type, true);
    t0 = now_ms();
    long total = 0;
    for (size_t i = 0; i < PRESSES; i++) {
        EastValue *view = PREFIX_OF(source, i);
        total += view ? walk_rows(view) : 0;
        if (view) east_value_release(view);
    }
    t1 = now_ms();
    Beast2PagesCacheStats stats;
    east_beast2_pages_cache_stats(source->data.paged.pages, &stats);
    printf("  %d runs in key order: %.1f ms, %.3f ms each (%ld rows, %zu segments decoded, the "
           "cache holding %zu at the end)\n",
           PRESSES, t1 - t0, (t1 - t0) / PRESSES, total, decoded(source), stats.segments);
    east_value_release(source);

    /* A long range — a tenth of the table — and the whole of it. */
    source = open_lazy(blob, type, true);
    t0 = now_ms();
    EastValue *tenth =
        east_beast2_open_paged_range(source, bounds[PRESSES / 2], press_type, false,
                                     bounds[PRESSES / 2 + PRESSES / 10], press_type, false);
    rows = tenth ? walk_rows(tenth) : -1;
    t1 = now_ms();
    printf("  a range of a tenth of the table: %.1f ms (%ld rows, %zu segments decoded)\n", t1 - t0,
           rows, decoded(source));
    if (tenth) east_value_release(tenth);
    east_value_release(source);
    source = open_lazy(blob, type, true);
    t0 = now_ms();
    rows = 0;
    for (size_t k = 0; k < segments; k++) {
        EastValue *seg = east_beast2_pages_segment_disjoint(source->data.paged.pages, k);
        rows += seg ? (long)east_dict_len(seg) : 0;
        if (seg) east_value_release(seg);
    }
    t1 = now_ms();
    printf("  a walk of the whole table: %.1f ms (%ld rows, %zu segments decoded)\n", t1 - t0, rows,
           decoded(source));
    east_value_release(source);
#undef PREFIX_OF

    for (size_t i = 0; i < PRESSES; i++)
        east_value_release(bounds[i]);
    byte_buffer_free(blob);
    east_type_release(type);
    east_type_release(press_type);
    east_type_release(key_type);
}

int main(void)
{
    east_type_of_type_init();

    printf("paged range gate (issue #1616)\n");
    report_timings();
    test_costs();
    test_whole_key_by_leaves();
    test_view_rule();
    test_exactness();
    test_refusals();
    test_narrowed_deep();
    test_placed_view();
    test_range_rows();

    if (failures == 0) {
        printf("GATE PASS: a range of a lazily opened collection is a view the pager serves — "
               "its ends placed by the fences and one segment each, its end segments through the "
               "cache and the rest fresh, its own rows decoded alone, and exact (issue #1616)\n");
        return 0;
    }
    printf("GATE FAIL: %d check(s) failed\n", failures);
    return 1;
}
