/*
 * Gate for issue #1616, D3: a key range of a Set and of a Dict.
 *
 * A range is the run of a collection between two tests of its keys, each
 * false, then true, over the keys in order (east/values.h). Asserted here:
 *
 *   1. what a range holds — against a walk of the whole collection, for
 *      collections under, at and over the size a tree takes over at, and for
 *      bounds before the first key, between keys, on a key, past the last,
 *      left out and inverted: the same entries, in order, and the source's own
 *      keys and values, not copies of them;
 *   2. what a range is — a new collection, never frozen whatever its source
 *      is, small while it holds few entries and a tree past that, changed
 *      without its source changing;
 *   3. how a range is found — a tree whose cache is in step is searched
 *      through the cache, and one changed since is searched down the tree,
 *      which a range leaves as it found it: either way in a number of tests
 *      that follows the tree's height and the range's length, counted here
 *      over 100,000 keys, and never the collection's size;
 *   4. the builtins — `DictRange`, `DictPrefix`, `SetRange` and `SetPrefix`
 *      read a bound as its type cuts the key short, and refuse a bound's type
 *      that is no leading part of the key, `from` before `to`, in the words
 *      TypeScript refuses it in.
 *
 * It counts tests of a key, not time, so it is the same on every machine. Run
 * under ASan/LSan too (scripts/run_leak_check.sh): a range holds a reference
 * to each entry, so a missed release or a double one is a leak or a
 * use-after-free there.
 */
#include <east/east.h>

#include <stdint.h>
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

/* ---- a bound of an Integer key, counting how often it is asked ----------- */

typedef struct {
    int64_t bound;
    size_t asked;
} IntBound;

static bool at_or_past(EastValue *key, void *ctx)
{
    IntBound *bound = (IntBound *)ctx;
    bound->asked++;
    return key->data.integer >= bound->bound;
}

/* ---- the collections: keys 0, 3, 6, …, each Dict value its own object ---- */

static EastValue *dict_of(size_t n)
{
    EastValue *dict = east_dict_new(&east_integer_type, &east_integer_type);
    for (size_t i = 0; i < n; i++) {
        EastValue *key = east_integer((int64_t)(3 * i));
        EastValue *val = east_integer((int64_t)(10 * i));
        east_dict_set(dict, key, val);
        east_value_release(key);
        east_value_release(val);
    }
    return dict;
}

static EastValue *set_of(size_t n)
{
    EastValue *set = east_set_new(&east_integer_type);
    for (size_t i = 0; i < n; i++) {
        EastValue *key = east_integer((int64_t)(3 * i));
        east_set_insert(set, key);
        east_value_release(key);
    }
    return set;
}

/* Changes a collection and changes it back: a tree's cache is then out of
 * step, and what the collection holds is as it was. */
static void touch(EastValue *collection)
{
    EastValue *extra = east_integer(-1);
    if (collection->kind == EAST_VAL_DICT) {
        east_dict_set(collection, extra, extra);
        east_dict_delete(collection, extra);
    } else {
        east_set_insert(collection, extra);
        east_set_delete(collection, extra);
    }
    east_value_release(extra);
}

static bool is_tree(EastValue *collection)
{
    return collection->kind == EAST_VAL_DICT ? collection->data.dict.tree != NULL
                                             : collection->data.set.tree != NULL;
}

static bool is_dirty(EastValue *collection)
{
    return collection->kind == EAST_VAL_DICT ? collection->data.dict.dirty
                                             : collection->data.set.dirty;
}

static size_t length(EastValue *collection)
{
    return collection->kind == EAST_VAL_DICT ? east_dict_len(collection) : east_set_len(collection);
}

static EastValue *key_at(EastValue *collection, size_t i)
{
    return collection->kind == EAST_VAL_DICT ? east_dict_key_at(collection, i)
                                             : east_set_at(collection, i);
}

static EastValue *range_of(EastValue *collection, IntBound *from, IntBound *to)
{
    EastKeyTest from_test = from ? at_or_past : NULL;
    EastKeyTest to_test = to ? at_or_past : NULL;
    return collection->kind == EAST_VAL_DICT
               ? east_dict_range(collection, from_test, from, to_test, to)
               : east_set_range(collection, from_test, from, to_test, to);
}

/* ---- 1 and 2: what a range holds, and what it is -------------------------- */

/* One range of a collection of `n` keys against a walk of the whole. `changed`
 * is whether the collection was changed since it was last read in order. */
static bool range_matches(EastValue *collection, size_t n, bool changed, const int64_t *from,
                          const int64_t *to)
{
    IntBound from_bound = {from ? *from : 0, 0};
    IntBound to_bound = {to ? *to : 0, 0};
    if (changed) touch(collection);
    bool dirty = is_dirty(collection);
    EastValue *range = range_of(collection, from ? &from_bound : NULL, to ? &to_bound : NULL);
    if (!range) return false;
    bool ok = true;
    /* A range leaves its source as it found it: a changed tree is not read in order for it. */
    if (is_dirty(collection) != dirty) ok = false;
    if (length(collection) != n) ok = false;
    if (east_value_frozen(range)) ok = false;

    /* The walk: the first key at or past `from`, up to the first at or past `to`. */
    size_t first = 0;
    while (first < n && from && (int64_t)(3 * first) < *from)
        first++;
    size_t end = first;
    while (end < n && !(to && (int64_t)(3 * end) >= *to))
        end++;
    size_t count = end - first;
    if (length(range) != count) ok = false;
    /* Small while it holds few entries, a tree past that. */
    if (is_tree(range) != (count > EAST_SMALL_COLLECTION_MAX)) ok = false;
    for (size_t i = 0; ok && i < count; i++) {
        /* The source's own key and value, a reference taken for each. */
        if (key_at(range, i) != key_at(collection, first + i)) ok = false;
        if (collection->kind == EAST_VAL_DICT &&
            east_dict_val_at(range, i) != east_dict_val_at(collection, first + i))
            ok = false;
    }
    /* Read by key as any collection is. */
    if (ok && count > 0) {
        EastValue *middle = key_at(collection, first + count / 2);
        if (collection->kind == EAST_VAL_DICT ? !east_dict_has(range, middle)
                                              : !east_set_has(range, middle))
            ok = false;
    }
    east_value_release(range);
    return ok;
}

static void test_ranges(void)
{
    static const size_t sizes[] = {0,
                                   1,
                                   2,
                                   EAST_SMALL_COLLECTION_MAX - 1,
                                   EAST_SMALL_COLLECTION_MAX,
                                   EAST_SMALL_COLLECTION_MAX + 1,
                                   EAST_SMALL_COLLECTION_MAX + 44,
                                   2 * EAST_SMALL_COLLECTION_MAX + 88,
                                   2000};
    bool dict_ok = true;
    bool set_ok = true;
    bool frozen_ok = true;
    for (size_t s = 0; s < sizeof(sizes) / sizeof(sizes[0]); s++) {
        size_t n = sizes[s];
        int64_t last = n ? (int64_t)(3 * (n - 1)) : 0;
        /* Before the first key, on it, between keys, in the middle, on and past the last. */
        const int64_t bounds[] = {
            -5,       0,    1,        3,         (int64_t)(3 * (n / 2)), (int64_t)(3 * (n / 2)) + 1,
            last - 2, last, last + 1, last + 700};
        size_t nbounds = sizeof(bounds) / sizeof(bounds[0]);
        EastValue *dict = dict_of(n);
        EastValue *set = set_of(n);
        for (int changed = 0; changed < 2; changed++) {
            /* Every pair, the inverted ones among them, and each end left out. */
            for (size_t f = 0; f <= nbounds; f++) {
                for (size_t t = 0; t <= nbounds; t++) {
                    const int64_t *from = f < nbounds ? &bounds[f] : NULL;
                    const int64_t *to = t < nbounds ? &bounds[t] : NULL;
                    if (!range_matches(dict, n, changed, from, to)) dict_ok = false;
                    if (!range_matches(set, n, changed, from, to)) set_ok = false;
                }
            }
        }
        /* A frozen source: the range is not frozen, and is changed alone. */
        dict->data.dict.frozen = true;
        set->data.set.frozen = true;
        EastValue *dict_range = range_of(dict, NULL, NULL);
        EastValue *set_range = range_of(set, NULL, NULL);
        EastValue *extra = east_integer(-9);
        if (!dict_range || !set_range || east_value_frozen(dict_range) ||
            east_value_frozen(set_range) || dict_range == dict || set_range == set) {
            frozen_ok = false;
        } else {
            east_dict_set(dict_range, extra, extra);
            east_set_insert(set_range, extra);
            if (east_dict_len(dict_range) != n + 1 || east_dict_len(dict) != n) frozen_ok = false;
            if (east_set_len(set_range) != n + 1 || east_set_len(set) != n) frozen_ok = false;
            if (east_dict_has(dict, extra) || east_set_has(set, extra)) frozen_ok = false;
        }
        east_value_release(extra);
        if (dict_range) east_value_release(dict_range);
        if (set_range) east_value_release(set_range);
        east_value_release(dict);
        east_value_release(set);
    }
    check(dict_ok, "a Dict's range is what a walk of the whole keeps, in order, the source's own "
                   "entries, the source as it was");
    check(set_ok, "a Set's range is what a walk of the whole keeps, in order, the source's own "
                  "elements, the source as it was");
    check(frozen_ok, "a range of a frozen collection is a new one, not frozen, changed alone");

    check(east_dict_range(NULL, NULL, NULL, NULL, NULL) == NULL &&
              east_set_range(NULL, NULL, NULL, NULL, NULL) == NULL,
          "no collection has no range");
    EastValue *set = set_of(3);
    EastValue *dict = dict_of(3);
    check(east_dict_range(set, NULL, NULL, NULL, NULL) == NULL &&
              east_set_range(dict, NULL, NULL, NULL, NULL) == NULL,
          "a Dict's range is of a Dict, and a Set's of a Set");
    east_value_release(set);
    east_value_release(dict);
}

/* ---- 3: how a range is found ---------------------------------------------- */

#define MANY 100000
#define RUN 10

static void test_search_cost(void)
{
    EastValue *collections[] = {dict_of(MANY), set_of(MANY)};
    const char *names[] = {"Dict", "Set"};
    for (size_t c = 0; c < 2; c++) {
        EastValue *collection = collections[c];
        char what[160];
        for (int changed = 0; changed < 2; changed++) {
            if (changed)
                touch(collection);
            else
                (void)key_at(collection, 0); /* read in order: the cache is in step */
            snprintf(what, sizeof(what), "a %s of %d keys, %s", names[c], MANY,
                     changed ? "changed since it was read in order" : "its cache in step");
            check(is_tree(collection) && is_dirty(collection) == (changed != 0), what);

            IntBound from = {3 * (MANY / 2), 0};
            IntBound to = {3 * (MANY / 2 + RUN), 0};
            EastValue *range = range_of(collection, &from, &to);
            check(range != NULL && length(range) == RUN, "the range is the run between the bounds");
            if (changed) {
                /* Down the tree: a node's search at each level, then the run and
                 * the key that ends it — and the cache is left out of step. */
                snprintf(what, sizeof(what),
                         "a changed %s finds `from` in %zu tests, down its tree (at most 64)",
                         names[c], from.asked);
                check(from.asked <= 64, what);
                snprintf(what, sizeof(what),
                         "and asks `to` of the run and the key past it: %zu tests for %d entries",
                         to.asked, RUN);
                check(to.asked == RUN + 1, what);
                check(is_dirty(collection), "and is not read in order for it");
            } else {
                /* Through the cache: two binary searches, 17 tests each at most. */
                snprintf(what, sizeof(what),
                         "a %s in step finds its ends in %zu and %zu tests (at most 17 each)",
                         names[c], from.asked, to.asked);
                check(from.asked <= 17 && to.asked <= 17, what);
            }
            if (range) east_value_release(range);

            /* An end left out is not searched for. */
            IntBound open_to = {3 * RUN, 0};
            EastValue *head = range_of(collection, NULL, &open_to);
            check(head != NULL && length(head) == RUN,
                  "an open start is the collection's first key");
            if (head) east_value_release(head);
            IntBound open_from = {3 * (MANY - RUN), 0};
            EastValue *tail = range_of(collection, &open_from, NULL);
            check(tail != NULL && length(tail) == RUN,
                  "an open end runs to the collection's last key");
            if (tail) east_value_release(tail);
        }
        east_value_release(collection);
    }
}

/* ---- 4: the builtins ------------------------------------------------------- */

/* Sheets printed, keyed by press and job. */
static EastType *sheets_type(size_t fields)
{
    const char *names[] = {"press", "job"};
    EastType *types[] = {&east_string_type, &east_integer_type};
    return east_struct_type(names, types, fields);
}

static EastType *option_of(EastType *inner)
{
    const char *names[] = {"none", "some"};
    EastType *types[] = {&east_null_type, inner};
    return east_variant_type(names, types, 2);
}

static EastValue *sheet_key(const char *press, int64_t job, EastType *type)
{
    EastValue *p = east_string(press);
    EastValue *j = east_integer(job);
    const char *names[] = {"press", "job"};
    EastValue *values[] = {p, j};
    EastValue *key = east_struct_new(names, values, 2, type);
    east_value_release(p);
    east_value_release(j);
    return key;
}

static EastValue *press_bound(const char *press, EastType *type)
{
    EastValue *p = east_string(press);
    const char *names[] = {"press"};
    EastValue *bound = east_struct_new(names, &p, 1, type);
    east_value_release(p);
    return bound;
}

static EastValue *option(EastValue *value, EastType *type)
{
    if (value) return east_variant_new("some", value, type);
    EastValue *null = east_null();
    EastValue *none = east_variant_new("none", null, type);
    east_value_release(null);
    return none;
}

/* Calls a builtin made from its type parameters; NULL is a refusal, whose
 * words are then in *error, the caller's to free. */
static EastValue *call(BuiltinRegistry *reg, const char *name, EastType **tp, size_t ntp,
                       EastValue **args, size_t nargs, char **error)
{
    *error = NULL;
    BuiltinImpl impl = builtin_registry_get(reg, name, tp, ntp);
    if (!impl) return NULL;
    EastValue *result = impl(args, nargs);
    if (!result) *error = east_builtin_get_error();
    return result;
}

static void check_refused(BuiltinRegistry *reg, const char *name, EastType **tp, size_t ntp,
                          EastValue **args, size_t nargs, const char *words, const char *what)
{
    char *error;
    EastValue *result = call(reg, name, tp, ntp, args, nargs, &error);
    bool same = result == NULL && error != NULL && strcmp(error, words) == 0;
    if (!same) printf("  got: %s\n  want: %s\n", error ? error : "(no refusal)", words);
    check(same, what);
    if (result) east_value_release(result);
    free(error);
}

/* The jobs of a range of sheets, in order, as "2,3,…". */
static void jobs_of(EastValue *range, char *out, size_t size)
{
    out[0] = '\0';
    size_t used = 0;
    for (size_t i = 0; i < length(range); i++) {
        EastValue *job = east_struct_get_field_idx(key_at(range, i), 1);
        int wrote =
            snprintf(out + used, size - used, "%s%lld", i ? "," : "", (long long)job->data.integer);
        if (wrote < 0 || (size_t)wrote >= size - used) break;
        used += (size_t)wrote;
    }
}

static void check_jobs(EastValue *range, char *error, const char *jobs, const char *what)
{
    char got[128] = "(refused)";
    if (range) jobs_of(range, got, sizeof(got));
    bool same = range != NULL && strcmp(got, jobs) == 0;
    if (!same)
        printf("  got: %s%s%s\n  want: %s\n", got, error ? " — " : "", error ? error : "", jobs);
    check(same, what);
    if (range) east_value_release(range);
    free(error);
}

static void test_builtins(void)
{
    BuiltinRegistry *reg = builtin_registry_new();
    east_register_all_builtins(reg);

    EastType *sheets = sheets_type(2);
    EastType *press_only = sheets_type(1);
    const char *job_name[] = {"job"};
    EastType *job_types[] = {&east_integer_type};
    EastType *job_only = east_struct_type(job_name, job_types, 1);
    EastType *opt_sheets = option_of(sheets);
    EastType *opt_press = option_of(press_only);

    /* P1: jobs 1, 2 · P2: jobs 3, 4, 5 · P3: job 6 */
    static const struct {
        const char *press;
        int64_t job;
    } rows[] = {{"P1", 1}, {"P1", 2}, {"P2", 3}, {"P2", 4}, {"P2", 5}, {"P3", 6}};
    EastValue *dict = east_dict_new(sheets, &east_integer_type);
    EastValue *set = east_set_new(sheets);
    for (size_t i = 0; i < sizeof(rows) / sizeof(rows[0]); i++) {
        EastValue *key = sheet_key(rows[i].press, rows[i].job, sheets);
        EastValue *val = east_integer(rows[i].job * 100);
        east_dict_set(dict, key, val);
        east_set_insert(set, key);
        east_value_release(key);
        east_value_release(val);
    }

    EastValue *p2 = press_bound("P2", press_only);
    EastValue *p3 = press_bound("P3", press_only);
    EastValue *p2_job4 = sheet_key("P2", 4, sheets);
    EastValue *some_p2 = option(p2, opt_press);
    EastValue *some_p3 = option(p3, opt_press);
    EastValue *some_p2_job4 = option(p2_job4, opt_sheets);
    EastValue *none_sheets = option(NULL, opt_sheets);
    char *error;

    /* A bound read as its type cuts the key short. */
    {
        EastType *tp[] = {sheets, &east_integer_type, press_only, press_only};
        EastValue *args[] = {dict, some_p2, some_p3};
        EastValue *range = call(reg, "DictRange", tp, 4, args, 3, &error);
        check_jobs(range, error, "3,4,5", "DictRange from one press up to the next is that press");
    }
    {
        EastType *tp[] = {sheets, &east_integer_type, sheets, sheets};
        EastValue *args[] = {dict, some_p2_job4, none_sheets};
        EastValue *range = call(reg, "DictRange", tp, 4, args, 3, &error);
        check_jobs(range, error, "4,5,6", "DictRange from a whole key runs to the last");
    }
    {
        EastType *tp[] = {sheets, &east_integer_type, sheets, press_only};
        EastValue *args[] = {dict, none_sheets, some_p2};
        EastValue *range = call(reg, "DictRange", tp, 4, args, 3, &error);
        check_jobs(range, error, "1,2", "DictRange with no `from` starts at the first");
    }
    {
        EastType *tp[] = {sheets, &east_integer_type, press_only};
        EastValue *args[] = {dict, p2};
        EastValue *range = call(reg, "DictPrefix", tp, 3, args, 2, &error);
        check_jobs(range, error, "3,4,5", "DictPrefix is the entries at the prefix");
    }
    {
        EastType *tp[] = {sheets, press_only, sheets};
        EastValue *args[] = {set, some_p2, some_p2_job4};
        EastValue *range = call(reg, "SetRange", tp, 3, args, 3, &error);
        check_jobs(range, error, "3", "SetRange from a press up to a whole key");
    }
    {
        EastType *tp[] = {sheets, press_only};
        EastValue *args[] = {set, p3};
        EastValue *range = call(reg, "SetPrefix", tp, 2, args, 2, &error);
        check_jobs(range, error, "6", "SetPrefix is the elements at the prefix");
    }

    /* A bound's type that is no leading part of the key: refused, in TypeScript's words. */
    const char *from_words = "a range's `from` is no leading part of the key: a bound gives the "
                             "key's first fields in order \xe2\x80\x94 press, job";
    const char *to_words = "a range's `to` is no leading part of the key: a bound gives the key's "
                           "first fields in order \xe2\x80\x94 press, job";
    const char *prefix_words = "a prefix is no leading part of the key: a bound gives the key's "
                               "first fields in order \xe2\x80\x94 press, job";
    {
        EastType *tp[] = {sheets, &east_integer_type, job_only, job_only};
        EastValue *args[] = {dict, none_sheets, none_sheets};
        check_refused(reg, "DictRange", tp, 4, args, 3, from_words,
                      "DictRange refuses a `from` type that is no leading part, before its `to`");
    }
    {
        EastType *tp[] = {sheets, &east_integer_type, sheets, job_only};
        EastValue *args[] = {dict, none_sheets, none_sheets};
        check_refused(reg, "DictRange", tp, 4, args, 3, to_words,
                      "DictRange refuses a `to` type that is no leading part");
    }
    {
        EastType *tp[] = {sheets, job_only, sheets};
        EastValue *args[] = {set, none_sheets, none_sheets};
        check_refused(reg, "SetRange", tp, 3, args, 3, from_words,
                      "SetRange refuses a `from` type that is no leading part");
    }
    {
        EastType *tp[] = {sheets, &east_integer_type, job_only};
        EastValue *args[] = {dict, p2};
        check_refused(reg, "DictPrefix", tp, 3, args, 2, prefix_words,
                      "DictPrefix refuses a prefix type that is no leading part");
    }
    {
        EastType *tp[] = {sheets, job_only};
        EastValue *args[] = {set, p2};
        check_refused(reg, "SetPrefix", tp, 2, args, 2, prefix_words,
                      "SetPrefix refuses a prefix type that is no leading part");
    }
    {
        /* A prefix is the first fields of a struct key: refused on any other key. */
        EastValue *words = set_of(3);
        EastValue *bound = east_integer(3);
        EastType *tp[] = {&east_integer_type, &east_integer_type};
        EastValue *args[] = {words, bound};
        check_refused(reg, "SetPrefix", tp, 2, args, 2,
                      "a prefix gives the first fields of a struct key, and this key is a "
                      "Integer: read one key with `get`, or the keys between two with `range`",
                      "SetPrefix refuses a key that is not a struct");
        east_value_release(bound);
        east_value_release(words);
    }
    {
        /* Type parameters left out: refused, never read. */
        EastValue *args[] = {dict, none_sheets, none_sheets};
        EastValue *result = call(reg, "DictRange", NULL, 0, args, 3, &error);
        check(result == NULL && error != NULL, "a range made without its types is refused");
        if (result) east_value_release(result);
        free(error);
    }

    east_value_release(none_sheets);
    east_value_release(some_p2_job4);
    east_value_release(some_p3);
    east_value_release(some_p2);
    east_value_release(p2_job4);
    east_value_release(p3);
    east_value_release(p2);
    east_value_release(set);
    east_value_release(dict);
    east_type_release(opt_press);
    east_type_release(opt_sheets);
    east_type_release(job_only);
    east_type_release(press_only);
    east_type_release(sheets);
    builtin_registry_free(reg);
}

int main(void)
{
    east_type_of_type_init();

    printf("key range gate (issue #1616)\n");
    test_ranges();
    test_search_cost();
    test_builtins();

    if (failures == 0) {
        printf("GATE PASS: a range is the run between its bounds, a new collection of the "
               "source's own entries, found by a search of the cache or of the tree, and the "
               "builtins refuse a bound that is no leading part in TypeScript's words (issue "
               "#1616)\n");
        return 0;
    }
    printf("GATE FAIL: %d check(s) failed\n", failures);
    return 1;
}
