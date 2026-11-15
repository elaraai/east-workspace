/*
 * Gate for issue #1616, D4: a key range of a lazily opened Set or Dict, read
 * by a function's body.
 *
 * test_paged_range pins the view on the pager's own entries. This gate runs
 * each row of D4's table through the interpreter — a function built of IR,
 * compiled and called over a lazily opened input — and asserts what the read
 * came to in segments decoded on the input's pager, a count and never a clock:
 *
 *   1. `size` places the two ends and reads no segment between them; `has`
 *      and `get` test the key against the bounds, which reads nothing, and
 *      inside them are the input's keyed read; a loop reads the range's
 *      segments, each once, its ends through the cache;
 *   2. a range that is only made, bound, passed to a function and returned by
 *      one reads nothing, and comes back still reading from the pager;
 *   3. any other read — a builtin the pager does not serve, a change, a
 *      container, a platform function that does not serve paged values —
 *      decodes the range's own rows and no others, into a collection that is
 *      not frozen, and leaves the input lazy; a platform function that serves
 *      paged values is handed the range as one; `Is` tells two ranges apart;
 *   4. a range holds what its source held when it was taken: a source changed
 *      afterwards changes no range, a loop over a range locks the range alone,
 *      and a range of a source already decoded whole is a collection;
 *   5. loops: one over a range inside one over another range of the same
 *      input reads each its own rows; one whose segment the cache drops while
 *      it runs reads every row; a loop that reads one field projects the
 *      segments between the ends and reads the ends whole;
 *   6. a Set's range, and a prefix of a struct key;
 *   7. a range whose ends cannot be placed refuses in a keyed read's words,
 *      at the read that needs them — its size never answers zero;
 *   8. a body that narrows a range in a loop, a hundred thousand times, and
 *      reads it after — or never does — on a 1 MiB stack, where placing or
 *      letting go of the ranges by a recursion would not fit.
 *
 * Run under ASan/LSan too (scripts/run_leak_check.sh).
 */
#include <east/east.h>
#include <east/compiler.h>
#include <east/gc.h>
#include <east/ir.h>
#include <east/type_of_type.h>

#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#ifndef _WIN32
#include <pthread.h>
#endif

static int failures = 0;

static void check(bool ok, const char *what)
{
    if (!ok) {
        printf("FAIL: %s\n", what);
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

/* ---- fixtures ------------------------------------------------------------ */

#define PER_SEGMENT 8
#define SEGMENTS 12
#define ROWS (PER_SEGMENT * SEGMENTS)

static BuiltinRegistry *builtins;
static PlatformRegistry *platform;

static EastType *t_int = &east_integer_type;
static EastType *t_null = &east_null_type;
static EastType *t_bool = &east_boolean_type;
static EastType *t_dict;  /* Dict<Integer, Integer> */
static EastType *t_set;   /* Set<Integer> */
static EastType *t_bound; /* Option<Integer>: an end of a range */

static EastType *option_of(EastType *inner)
{
    const char *names[] = {"none", "some"};
    EastType *types[] = {&east_null_type, inner};
    return east_variant_type(names, types, 2);
}

/* A self-contained, indexed blob of a Set or Dict, a segment for each `per` rows. */
static ByteBuffer *encode_in_segments(EastValue *value, EastType *type, size_t per)
{
    Beast2StreamWriter *w = east_beast2_writer_new(type, EAST_BEAST2_CODEC_DEFLATE, true, true);
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

/* `blob` with its first two segments in each other's place, spliced as a host
 * splices segment frames: every segment whole, the index true to where each
 * now is — and its fences no longer ascending, which no writer writes. */
static ByteBuffer *swap_first_two_segments(ByteBuffer *blob)
{
    Beast2SpliceExtents *e = east_beast2_splice_extents(blob->data, blob->len);
    if (!e || e->segment_count < 3) {
        if (e) east_beast2_splice_extents_free(e);
        return NULL;
    }
    size_t first = e->offsets[1] - e->offsets[0];
    size_t second = e->offsets[2] - e->offsets[1];
    size_t *offsets = malloc(e->segment_count * sizeof(size_t));
    size_t *counts = malloc(e->segment_count * sizeof(size_t));
    ByteBuffer *out = byte_buffer_new(blob->len);
    ByteBuffer *tail = NULL;
    if (offsets && counts && out) {
        memcpy(offsets, e->offsets, e->segment_count * sizeof(size_t));
        memcpy(counts, e->counts, e->segment_count * sizeof(size_t));
        offsets[1] = offsets[0] + second;
        counts[0] = e->counts[1];
        counts[1] = e->counts[0];
        byte_buffer_write_bytes(out, blob->data, e->prefix_end);
        byte_buffer_write_bytes(out, blob->data + e->offsets[1], second);
        byte_buffer_write_bytes(out, blob->data + e->offsets[0], first);
        byte_buffer_write_bytes(out, blob->data + e->offsets[2], e->segments_end - e->offsets[2]);
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

/* Dict<Integer, Integer>: row r is 3r -> 10r, so a bound can fall between
 * keys. Segment s holds rows 8s to 8s + 7, its first key 24s. */
static EastValue *int_dict(void)
{
    EastValue *dict = east_dict_new(t_int, t_int);
    for (size_t i = 0; i < ROWS; i++) {
        EastValue *k = east_integer((int64_t)(3 * i));
        EastValue *v = east_integer((int64_t)(10 * i));
        east_dict_set(dict, k, v);
        east_value_release(k);
        east_value_release(v);
    }
    return dict;
}

static EastValue *int_set(void)
{
    EastValue *set = east_set_new(t_int);
    for (size_t i = 0; i < ROWS; i++) {
        EastValue *k = east_integer((int64_t)(3 * i));
        east_set_insert(set, k);
        east_value_release(k);
    }
    return set;
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

static bool lazy(EastValue *paged)
{
    return paged->kind == EAST_VAL_PAGED && paged->data.paged.hydrated == NULL;
}

/* ---- a body's IR ---------------------------------------------------------- */

/* A node holds what it is built of, so a builder here takes its operands'
 * references: each is released once the node is made. */
static IRNode *made_of(IRNode *node, IRNode **parts, size_t n)
{
    for (size_t i = 0; i < n; i++)
        ir_node_release(parts[i]);
    return node;
}

static IRNode *builtin(EastType *out, const char *name, EastType **tp, size_t ntp, IRNode **args,
                       size_t nargs)
{
    return made_of(ir_builtin(out, name, tp, ntp, args, nargs), args, nargs);
}

static IRNode *value_node(EastType *type, EastValue *value)
{
    IRNode *node = ir_value(type, value);
    east_value_release(value);
    return node;
}

static IRNode *integer(int64_t n)
{
    return value_node(t_int, east_integer(n));
}

/* An end of a range: `some(n)`, or `none` for a negative n — that end left out. */
static IRNode *bound(int64_t n)
{
    EastValue *inner = n >= 0 ? east_integer(n) : east_null();
    EastValue *option = east_variant_new(n >= 0 ? "some" : "none", inner, t_bound);
    east_value_release(inner);
    return value_node(t_bound, option);
}

static IRNode *var(EastType *type, const char *name)
{
    return ir_variable(type, name, false, false);
}

/* The function's one parameter: the input. */
static IRNode *d(void)
{
    return var(t_dict, "d");
}

static IRNode *range(IRNode *of, int64_t from, int64_t to)
{
    EastType *tp[] = {t_int, t_int, t_int, t_int};
    IRNode *args[] = {of, bound(from), bound(to)};
    return builtin(t_dict, "DictRange", tp, 4, args, 3);
}

static IRNode *size(IRNode *of)
{
    EastType *tp[] = {t_int, t_int};
    IRNode *args[] = {of};
    return builtin(t_int, "DictSize", tp, 2, args, 1);
}

static IRNode *keyed(const char *name, EastType *out, IRNode *of, int64_t key)
{
    EastType *tp[] = {t_int, t_int};
    IRNode *args[] = {of, integer(key)};
    return builtin(out, name, tp, 2, args, 2);
}

static IRNode *let(const char *name, bool mutable, IRNode *value)
{
    IRNode *parts[] = {value};
    return made_of(ir_let(t_null, name, mutable, false, value), parts, 1);
}

static IRNode *block(EastType *out, IRNode **stmts, size_t n)
{
    return made_of(ir_block(out, stmts, n), stmts, n);
}

/* `name = name + value` */
static IRNode *add_to(const char *name, IRNode *value)
{
    IRNode *args[] = {ir_variable(t_int, name, true, false), value};
    IRNode *parts[] = {builtin(t_int, "IntegerAdd", NULL, 0, args, 2)};
    return made_of(ir_assign(t_null, name, parts[0]), parts, 1);
}

/* `for (k, v) of <of> { <body> }` over a Dict. */
static IRNode *for_dict(IRNode *of, IRNode *body)
{
    IRNode *parts[] = {of, body};
    return made_of(ir_for_dict(t_null, "k", "v", of, body, NULL), parts, 2);
}

/* `sum = 0; <loop>; sum` */
static IRNode *summed(IRNode *loop)
{
    IRNode *stmts[] = {let("sum", true, integer(0)), loop, ir_variable(t_int, "sum", true, false)};
    return block(t_int, stmts, 3);
}

/* Compiles `(d: in) => out` of `body`, which it takes, and calls it. */
static EvalResult run(IRNode *body, EastType *in, EastType *out, EastValue *input)
{
    IRVariable param = {.name = "d", .mutable = false, .captured = false, .loc_id = 0};
    EastType *inputs[1] = {in};
    EastType *fn_type = east_function_type(inputs, 1, out);
    IRNode *fn_node = ir_function(fn_type, NULL, 0, &param, 1, body);
    ir_node_release(body);
    ir_resolve_scopes(fn_node);
    EastCompiledFn *fn = east_compile_fn(fn_node, platform, builtins, NULL);
    EvalResult r = fn ? east_call(fn, &input, 1) : eval_error("the body does not compile");
    if (fn) east_compiled_fn_free(fn);
    ir_node_release(fn_node);
    east_type_release(fn_type);
    return r;
}

static void done(EvalResult *r)
{
    if (r->value) east_value_release(r->value);
    r->value = NULL;
    eval_result_free(r);
}

/* The result is this Integer; the result is then released. */
static void expect_integer(EvalResult r, int64_t want, const char *what)
{
    if (r.status != EVAL_OK || !r.value || r.value->kind != EAST_VAL_INTEGER) {
        printf("FAIL: %s: %s\n", what, r.error_message ? r.error_message : "no Integer came back");
        failures++;
    } else if (r.value->data.integer != want) {
        printf("FAIL: %s: %lld, expected %lld\n", what, (long long)r.value->data.integer,
               (long long)want);
        failures++;
    }
    done(&r);
}

static void expect_boolean(EvalResult r, bool want, const char *what)
{
    if (r.status != EVAL_OK || !r.value || r.value->kind != EAST_VAL_BOOLEAN) {
        printf("FAIL: %s: %s\n", what, r.error_message ? r.error_message : "no Boolean came back");
        failures++;
    } else if (r.value->data.boolean != want) {
        printf("FAIL: %s: %s, expected %s\n", what, r.value->data.boolean ? "true" : "false",
               want ? "true" : "false");
        failures++;
    }
    done(&r);
}

/* The body fails, in words that hold `words`; the result is then released. */
static void expect_error(EvalResult r, const char *words, const char *what)
{
    if (r.status != EVAL_ERROR || !r.error_message || !strstr(r.error_message, words)) {
        printf("FAIL: %s: %s\n  want an error holding: %s\n", what,
               r.status == EVAL_ERROR && r.error_message ? r.error_message : "no error", words);
        failures++;
    }
    done(&r);
}

/* ---- 1: what each read of a range costs ------------------------------------ */

static void test_reads(ByteBuffer *blob)
{
    /* size: the two ends, and no segment between them. */
    EastValue *source = open_lazy(blob, t_dict, true);
    expect_integer(run(size(range(d(), 30, 108)), t_dict, t_int, source), 26,
                   "the size of a range across four segments");
    check_count(decoded(source), 2, "segments decoded for a range's size");
    check(lazy(source), "a range's size leaves its input lazy");
    east_value_release(source);

    /* A whole key that is a segment's first key places its end by the fences alone. */
    source = open_lazy(blob, t_dict, true);
    expect_integer(run(size(range(d(), 24, 48)), t_dict, t_int, source), 8,
                   "the size of a range from one segment's first key to the next's");
    check_count(decoded(source), 0, "segments decoded when both ends are fences");
    east_value_release(source);

    /* has, get: the bounds answer for a key outside them. */
    source = open_lazy(blob, t_dict, true);
    expect_boolean(run(keyed("DictHas", t_bool, range(d(), 30, 60), 3), t_dict, t_bool, source),
                   false, "a key outside a range's bounds");
    check_count(decoded(source), 0, "segments decoded to say a key is outside the bounds");
    expect_boolean(run(keyed("DictHas", t_bool, range(d(), 30, 60), 33), t_dict, t_bool, source),
                   true, "a key inside a range's bounds");
    check_count(decoded(source), 1, "segments decoded for a keyed read inside the bounds");
    expect_integer(run(keyed("DictGet", t_int, range(d(), 30, 60), 33), t_dict, t_int, source), 110,
                   "the value at a key inside a range");
    check_count(decoded(source), 1, "a second keyed read of the same segment decodes nothing");
    expect_error(run(keyed("DictGet", t_int, range(d(), 30, 60), 3), t_dict, t_int, source),
                 "Dict does not contain key 3", "the value at a key outside a range");
    expect_boolean(run(keyed("DictHas", t_bool, range(d(), 30, 60), 34), t_dict, t_bool, source),
                   false, "a key inside the bounds that the input does not hold");
    east_value_release(source);

    /* A loop: the range's segments, each once; the ends through the cache. */
    source = open_lazy(blob, t_dict, true);
    expect_integer(run(summed(for_dict(range(d(), 30, 108), add_to("sum", var(t_int, "v")))),
                       t_dict, t_int, source),
                   5850, "the values a loop over a range across four segments reads");
    check_count(decoded(source), 4, "segments decoded by a loop over a range of four segments");
    check_count(cached(source), 2, "segments the cache holds after it: the range's two ends");
    check(lazy(source), "a loop over a range leaves its input lazy");
    /* The same loop again: the ends are held, the two between decode again. */
    expect_integer(run(summed(for_dict(range(d(), 30, 108), add_to("sum", var(t_int, "v")))),
                       t_dict, t_int, source),
                   5850, "the same loop over the same range, run again");
    check_count(decoded(source), 6, "a second loop decodes the segments between the ends alone");
    east_value_release(source);

    /* A loop over a range inside one segment, and over an empty one. */
    source = open_lazy(blob, t_dict, true);
    expect_integer(run(summed(for_dict(range(d(), 30, 39), add_to("sum", var(t_int, "k")))), t_dict,
                       t_int, source),
                   30 + 33 + 36, "the keys a loop over a range inside one segment reads");
    check_count(decoded(source), 1, "segments decoded by a loop over a range inside one segment");
    expect_integer(run(summed(for_dict(range(d(), 31, 31), add_to("sum", var(t_int, "k")))), t_dict,
                       t_int, source),
                   0, "a loop over an empty range runs no pass");
    east_value_release(source);
}

/* ---- 2: a range handed on reads nothing ------------------------------------ */

static void test_handed_on(ByteBuffer *blob)
{
    /* Made and dropped. */
    EastValue *source = open_lazy(blob, t_dict, true);
    IRNode *made[] = {let("r", false, range(range(d(), 30, 108), 36, 60)), integer(7)};
    expect_integer(run(block(t_int, made, 2), t_dict, t_int, source), 7,
                   "a body that makes a range of a range and reads neither");
    check_count(decoded(source), 0, "segments decoded to make a range of a range");
    east_value_release(source);

    /* Bound, passed to a function, returned by it, and returned by the body. */
    source = open_lazy(blob, t_dict, true);
    IRVariable x = {.name = "x", .mutable = false, .captured = false, .loc_id = 0};
    EastType *inputs[1] = {t_dict};
    EastType *identity_type = east_function_type(inputs, 1, t_dict);
    IRNode *x_read = var(t_dict, "x");
    IRNode *identity = ir_function(identity_type, NULL, 0, &x, 1, x_read);
    ir_node_release(x_read);
    IRNode *call_parts[] = {var(identity_type, "f"), var(t_dict, "r")};
    IRNode *call = made_of(ir_call(t_dict, call_parts[0], &call_parts[1], 1), call_parts, 2);
    IRNode *handed[] = {let("f", false, identity), let("r", false, range(d(), 30, 60)), call};
    EvalResult r = run(block(t_dict, handed, 3), t_dict, t_dict, source);
    check(r.status == EVAL_OK && r.value && lazy(r.value),
          "a range bound, passed to a function and returned is still a range the pager serves");
    check(r.value && !east_value_frozen(r.value), "a range of a frozen input is not frozen");
    check_count(decoded(source), 0, "segments decoded to hand a range on");
    check_count(r.value ? east_dict_len(r.value) : 0, 10, "the size of the range handed back");
    check_count(decoded(source), 2, "segments decoded once its size is asked");
    /* Written as the body's output, it decodes its own rows. */
    EastValue *rows = r.value ? east_paged_hydrated(r.value) : NULL;
    check(rows && rows->kind == EAST_VAL_DICT && east_dict_len(rows) == 10 &&
              !east_value_frozen(rows),
          "a range written as a body's output decodes its own rows, not frozen");
    check_count(decoded(source), 2, "which were its two end segments, already held");
    check(lazy(source), "handing a range on leaves its input lazy");
    done(&r);
    east_type_release(identity_type);
    east_value_release(source);
}

/* ---- 3: any other read decodes the range's own rows ------------------------ */

static EastValueKind probe_kind;
static bool probe_lazy;

static EvalResult probe(EastValue **args, size_t num_args, EastType **input_types,
                        size_t num_input_types, EastType *output_type)
{
    (void)input_types;
    (void)num_input_types;
    (void)output_type;
    probe_kind = num_args > 0 && args[0] ? args[0]->kind : EAST_VAL_NULL;
    probe_lazy = probe_kind == EAST_VAL_PAGED && args[0]->data.paged.hydrated == NULL;
    return eval_ok(east_integer((int64_t)east_dict_len(args[0])));
}

static IRNode *probe_call(IRNode *of)
{
    IRNode *args[] = {of};
    return made_of(ir_platform(t_int, "probe", NULL, 0, args, 1, false, false), args, 1);
}

static void test_own_rows(ByteBuffer *blob)
{
    EastType *tp[] = {t_int, t_int};

    /* A builtin the pager does not serve. */
    EastValue *source = open_lazy(blob, t_dict, true);
    IRNode *keys_args[] = {range(d(), 30, 60)};
    EvalResult r = run(builtin(t_set, "DictKeys", tp, 2, keys_args, 1), t_dict, t_set, source);
    check(r.status == EVAL_OK && r.value && r.value->kind == EAST_VAL_SET &&
              east_set_len(r.value) == 10,
          "the keys of a range are its own rows' keys");
    check_count(decoded(source), 2, "segments decoded for a builtin the pager does not serve");
    check(lazy(source), "which leaves the input lazy");
    done(&r);
    east_value_release(source);

    /* A change: a range of a frozen input is a collection a body may change. */
    source = open_lazy(blob, t_dict, true);
    IRNode *insert_args[] = {var(t_dict, "r"), integer(31), integer(0)};
    IRNode *changed[] = {let("r", false, range(d(), 30, 60)),
                         builtin(t_null, "DictInsert", tp, 2, insert_args, 3),
                         size(var(t_dict, "r"))};
    expect_integer(run(block(t_int, changed, 3), t_dict, t_int, source), 11,
                   "a row put in a range of a frozen input");
    check(lazy(source) && east_dict_len(source) == ROWS,
          "a range changed leaves its input lazy and as it was");
    IRNode *frozen_args[] = {d(), integer(31), integer(0)};
    expect_error(run(builtin(t_null, "DictInsert", tp, 2, frozen_args, 3), t_dict, t_null, source),
                 "frozen", "a row put in the frozen input itself");
    east_value_release(source);

    /* Put in a container. */
    source = open_lazy(blob, t_dict, true);
    EastType *t_array = east_array_type(t_dict);
    IRNode *items[] = {range(d(), 30, 60)};
    r = run(made_of(ir_new_array(t_array, items, 1), items, 1), t_dict, t_array, source);
    EastValue *held = r.status == EVAL_OK && r.value && r.value->kind == EAST_VAL_ARRAY &&
                              east_array_len(r.value) == 1
                          ? east_array_get(r.value, 0)
                          : NULL;
    check(held && held->kind == EAST_VAL_DICT && east_dict_len(held) == 10 &&
              !east_value_frozen(held),
          "a range put in a container is its own rows, a collection that is not frozen");
    check_count(decoded(source), 2, "segments decoded to put a range in a container");
    check(lazy(source), "which leaves the input lazy");
    done(&r);
    east_type_release(t_array);
    east_value_release(source);

    /* A platform function: one that does not serve paged values reads the
     * range's own rows; one that does is handed the range. */
    EastType *probe_inputs[] = {t_dict};
    platform_registry_add_typed(platform, "probe", probe, false, probe_inputs, 1, t_int);
    for (int serves = 0; serves < 2; serves++) {
        source = open_lazy(blob, t_dict, true);
        platform_registry_set_serves_paged(platform, "probe", serves != 0);
        probe_kind = EAST_VAL_NULL;
        probe_lazy = false;
        expect_integer(run(probe_call(range(d(), 30, 60)), t_dict, t_int, source), 10,
                       "the rows a platform function counts in a range");
        if (serves)
            check(probe_kind == EAST_VAL_PAGED && probe_lazy,
                  "a platform function that serves paged values is handed the range as one");
        else
            check(probe_kind == EAST_VAL_DICT,
                  "a platform function that does not is handed the range's own rows");
        check_count(decoded(source), 2, "segments decoded for a platform function's read");
        check(lazy(source), "which leaves the input lazy");
        east_value_release(source);
    }

    /* Is: two ranges are two collections; a range is itself. */
    source = open_lazy(blob, t_dict, true);
    EastType *is_tp[] = {t_dict};
    IRNode *two[] = {range(d(), 30, 60), range(d(), 30, 60)};
    expect_boolean(run(builtin(t_bool, "Is", is_tp, 1, two, 2), t_dict, t_bool, source), false,
                   "two ranges of the same bounds are told apart by Is");
    IRNode *same[] = {var(t_dict, "r"), var(t_dict, "r")};
    IRNode *itself[] = {let("r", false, range(d(), 30, 60)),
                        builtin(t_bool, "Is", is_tp, 1, same, 2)};
    expect_boolean(run(block(t_bool, itself, 2), t_dict, t_bool, source), true,
                   "a range is itself by Is");
    check_count(decoded(source), 2,
                "segments decoded to tell ranges apart: their rows, as any builtin the pager does "
                "not serve reads them — the two end segments, held from the first");
    east_value_release(source);
}

/* ---- 4: what the source held when the range was taken ---------------------- */

static void test_source_moves(ByteBuffer *blob)
{
    EastType *tp[] = {t_int, t_int};

    /* An input opened plain, changed after a range is taken of it. */
    EastValue *source = open_lazy(blob, t_dict, false);
    IRNode *delete_args[] = {d(), integer(33)};
    IRNode *moved[] = {let("r", false, range(d(), 30, 60)),
                       builtin(t_null, "DictDelete", tp, 2, delete_args, 2),
                       keyed("DictHas", t_bool, var(t_dict, "r"), 33)};
    expect_boolean(run(block(t_bool, moved, 3), t_dict, t_bool, source), true,
                   "a range taken before its source lost a row still holds it");
    check(!lazy(source) && east_dict_len(source) == ROWS - 1, "the source was changed");
    /* Once decoded whole, the source is a collection, and so is a range of it. */
    EvalResult r = run(range(d(), 30, 60), t_dict, t_dict, source);
    check(r.status == EVAL_OK && r.value && r.value->kind == EAST_VAL_DICT &&
              east_dict_len(r.value) == 9,
          "a range of a source decoded whole is a collection of what it holds now");
    done(&r);
    east_value_release(source);

    /* A loop over a range locks the range alone: its source may change inside it. */
    source = open_lazy(blob, t_dict, false);
    IRNode *try_args[] = {d(), var(t_int, "k")};
    IRNode *each[] = {builtin(t_bool, "DictTryDelete", tp, 2, try_args, 2),
                      add_to("sum", var(t_int, "v"))};
    expect_integer(
        run(summed(for_dict(range(d(), 30, 60), block(t_null, each, 2))), t_dict, t_int, source),
        100 + 110 + 120 + 130 + 140 + 150 + 160 + 170 + 180 + 190,
        "a loop over a range whose body deletes each row from the source reads every row");
    check_count(east_dict_len(source), ROWS - 10, "and the source lost them");
    east_value_release(source);

    /* The range itself is locked while it is looped over. */
    source = open_lazy(blob, t_dict, true);
    IRNode *own_args[] = {var(t_dict, "r"), var(t_int, "k")};
    IRNode *locked[] = {
        let("r", false, range(d(), 30, 60)),
        for_dict(var(t_dict, "r"), builtin(t_bool, "DictTryDelete", tp, 2, own_args, 2)),
        integer(0)};
    expect_error(run(block(t_int, locked, 3), t_dict, t_int, source),
                 "Cannot modify Dict during iteration",
                 "a loop over a range whose body deletes from the range");
    check(lazy(source), "which leaves the input lazy");
    east_value_release(source);
}

/* ---- 5: loops --------------------------------------------------------------- */

static void test_loops(ByteBuffer *blob)
{
    /* A loop over a range inside a loop over another range of the same input. */
    EastValue *source = open_lazy(blob, t_dict, true);
    IRNode *inner_parts[] = {range(d(), 0, 9), add_to("sum", var(t_int, "v2"))};
    IRNode *inner = made_of(ir_for_dict(t_null, "k2", "v2", inner_parts[0], inner_parts[1], NULL),
                            inner_parts, 2);
    expect_integer(run(summed(for_dict(range(d(), 30, 60), inner)), t_dict, t_int, source),
                   10 * (0 + 10 + 20), "the rows a loop inside a loop reads, each range its own");
    check_count(decoded(source), 3,
                "segments decoded: the outer range's two, and the inner's one, held from then");
    east_value_release(source);

    /* A loop whose segments the cache drops while it runs: a cache of one
     * segment, and a body that reads a key of the last. */
    source = open_lazy(blob, t_dict, true);
    east_beast2_pages_set_cache_budget(source->data.paged.pages, 1);
    IRNode *far_args[] = {var(t_int, "v"), keyed("DictGet", t_int, d(), 285)};
    expect_integer(
        run(summed(for_dict(range(d(), 30, 108),
                            add_to("sum", builtin(t_int, "IntegerAdd", NULL, 0, far_args, 2)))),
            t_dict, t_int, source),
        5850 + 26 * 950, "a loop whose segments the cache drops while it runs reads every row");
    check_count(cached(source), 1, "the cache kept to its budget of one segment");
    east_value_release(source);
}

/* A loop that reads one field of its rows: the segments between a range's
 * ends decode to that field, and its ends are read whole. */
static void test_projection(void)
{
    const char *names[] = {"amount", "note"};
    EastType *types[] = {t_int, &east_string_type};
    EastType *row_type = east_struct_type(names, types, 2);
    EastType *type = east_dict_type(t_int, row_type);
    EastValue *whole = east_dict_new(t_int, row_type);
    for (size_t i = 0; i < ROWS; i++) {
        EastValue *k = east_integer((int64_t)(3 * i));
        EastValue *amount = east_integer((int64_t)(10 * i));
        EastValue *note = east_string("a note no loop here reads");
        EastValue *fields[] = {amount, note};
        EastValue *row = east_struct_new(names, fields, 2, row_type);
        east_dict_set(whole, k, row);
        east_value_release(row);
        east_value_release(note);
        east_value_release(amount);
        east_value_release(k);
    }
    ByteBuffer *blob = encode_in_segments(whole, type, PER_SEGMENT);
    EastType *tp[] = {t_int, row_type, t_int, t_int};

    for (int ranged = 0; ranged < 2; ranged++) {
        EastValue *source = open_lazy(blob, type, true);
        IRNode *of = var(type, "d");
        if (ranged) {
            IRNode *args[] = {of, bound(30), bound(108)};
            of = builtin(type, "DictRange", tp, 4, args, 3);
        }
        IRNode *row = var(row_type, "v");
        IRNode *amount = ir_get_field(t_int, row, "amount");
        ir_node_release(row);
        size_t projected_before, whole_before, projected, read_whole;
        east_beast2_paged_loop_stats(&projected_before, &whole_before);
        expect_integer(run(summed(for_dict(of, add_to("sum", amount))), type, t_int, source),
                       ranged ? 5850 : 10 * (ROWS * (ROWS - 1) / 2),
                       ranged ? "the amounts a loop over a range reads"
                              : "the amounts a loop over the whole input reads");
        east_beast2_paged_loop_stats(&projected, &read_whole);
        if (ranged) {
            check_count(projected - projected_before, 2,
                        "segments between a range's ends, decoded to the field the loop reads");
            check_count(read_whole - whole_before, 2, "a range's end segments, read whole");
            check_count(decoded(source), 4, "segments decoded by a projected loop over a range");
        } else {
            check_count(projected - projected_before, SEGMENTS,
                        "a whole loop projects every segment, as it did");
            check_count(read_whole - whole_before, 0, "and reads none whole");
            check_count(cached(source), 0, "and keeps none in the cache");
        }
        east_value_release(source);
    }
    byte_buffer_free(blob);
    east_value_release(whole);
    east_type_release(type);
    east_type_release(row_type);
}

/* ---- 6: a Set's range, and a prefix of a struct key ------------------------- */

static void test_sets_and_prefixes(void)
{
    /* A Set. */
    EastValue *whole = int_set();
    ByteBuffer *blob = encode_in_segments(whole, t_set, PER_SEGMENT);
    EastType *tp[] = {t_int, t_int, t_int};
    EastType *size_tp[] = {t_int};
    EastValue *source = open_lazy(blob, t_set, true);
    IRNode *args[] = {var(t_set, "d"), bound(30), bound(108)};
    IRNode *size_args[] = {builtin(t_set, "SetRange", tp, 3, args, 3)};
    expect_integer(run(builtin(t_int, "SetSize", size_tp, 1, size_args, 1), t_set, t_int, source),
                   26, "the size of a range of a Set");
    check_count(decoded(source), 2, "segments decoded for a Set's range's size");
    IRNode *loop_args[] = {var(t_set, "d"), bound(30), bound(108)};
    IRNode *loop_parts[] = {builtin(t_set, "SetRange", tp, 3, loop_args, 3),
                            add_to("sum", var(t_int, "k"))};
    IRNode *loop =
        made_of(ir_for_set(t_null, "k", loop_parts[0], loop_parts[1], NULL), loop_parts, 2);
    expect_integer(run(summed(loop), t_set, t_int, source), 3 * 585,
                   "the keys a loop over a range of a Set reads");
    check_count(decoded(source), 4, "segments decoded by it: the two between the ends");
    check(lazy(source), "a Set's range leaves its input lazy");
    east_value_release(source);
    byte_buffer_free(blob);
    east_value_release(whole);

    /* Sheets printed, keyed { press, job }: PER_SEGMENT jobs a press, so a
     * segment is one press, and a prefix of one press is one segment. */
    const char *key_names[] = {"press", "job"};
    EastType *key_types[] = {&east_string_type, t_int};
    EastType *key_type = east_struct_type(key_names, key_types, 2);
    EastType *press_type = east_struct_type(key_names, key_types, 1);
    EastType *type = east_dict_type(key_type, t_int);
    EastValue *sheets = east_dict_new(key_type, t_int);
    for (size_t i = 0; i < ROWS; i++) {
        char name[16];
        snprintf(name, sizeof(name), "P%02zu", i / PER_SEGMENT);
        EastValue *press = east_string(name);
        EastValue *job = east_integer((int64_t)(i % PER_SEGMENT));
        EastValue *fields[] = {press, job};
        EastValue *key = east_struct_new(key_names, fields, 2, key_type);
        EastValue *count = east_integer((int64_t)i);
        east_dict_set(sheets, key, count);
        east_value_release(count);
        east_value_release(key);
        east_value_release(job);
        east_value_release(press);
    }
    blob = encode_in_segments(sheets, type, PER_SEGMENT);
    source = open_lazy(blob, type, true);
    EastValue *p03 = east_string("P03");
    EastValue *prefix = east_struct_new(key_names, &p03, 1, press_type);
    east_value_release(p03);
    EastType *prefix_tp[] = {key_type, t_int, press_type};
    EastType *dict_tp[] = {key_type, t_int};
    IRNode *prefix_args[] = {var(type, "d"), value_node(press_type, prefix)};
    IRNode *of[] = {builtin(type, "DictPrefix", prefix_tp, 3, prefix_args, 2)};
    expect_integer(run(builtin(t_int, "DictSize", dict_tp, 2, of, 1), type, t_int, source),
                   PER_SEGMENT, "the size of a prefix that is one press");
    check_count(decoded(source), 2,
                "segments decoded for it: the one before the press, and the press's own");
    check(lazy(source), "a prefix leaves its input lazy");
    east_value_release(source);
    byte_buffer_free(blob);
    east_value_release(sheets);
    east_type_release(type);
    east_type_release(press_type);
    east_type_release(key_type);
}

/* ---- 7: a range whose ends cannot be placed --------------------------------- */

static void test_refusals(void)
{
    EastValue *whole = int_dict();
    ByteBuffer *ordered = encode_in_segments(whole, t_dict, PER_SEGMENT);
    ByteBuffer *blob = ordered ? swap_first_two_segments(ordered) : NULL;
    if (ordered) byte_buffer_free(ordered);
    check(blob != NULL, "a blob is spliced with its first two segments in each other's place");
    if (!blob) {
        free(east_builtin_get_error());
        east_value_release(whole);
        return;
    }
    /* What a keyed read of it says. */
    EastValue *source = open_lazy(blob, t_dict, true);
    check(source != NULL, "it opens lazily: its fences are read at the first keyed read");
    if (!source) {
        free(east_builtin_get_error());
        byte_buffer_free(blob);
        east_value_release(whole);
        return;
    }
    EvalResult keyed_read = run(keyed("DictHas", t_bool, d(), 33), t_dict, t_bool, source);
    check(keyed_read.status == EVAL_ERROR && keyed_read.error_message != NULL,
          "a keyed read of a blob whose fences do not ascend is refused");
    char *words = keyed_read.error_message ? strdup(keyed_read.error_message) : strdup("?");
    done(&keyed_read);
    east_value_release(source);

    /* A range's size, a loop over it and a keyed read inside it say the same;
     * making the range says nothing. */
    source = open_lazy(blob, t_dict, true);
    expect_error(run(size(range(d(), 30, 60)), t_dict, t_int, source), words,
                 "the size of a range whose ends cannot be placed is refused, not zero");
    expect_error(run(summed(for_dict(range(d(), 30, 60), add_to("sum", var(t_int, "v")))), t_dict,
                     t_int, source),
                 words, "a loop over it is refused in the same words");
    expect_error(run(keyed("DictHas", t_bool, range(d(), 30, 60), 33), t_dict, t_bool, source),
                 words, "and so is a keyed read inside it");
    IRNode *made[] = {let("r", false, range(d(), 30, 60)), integer(7)};
    expect_integer(run(block(t_int, made, 2), t_dict, t_int, source), 7,
                   "a range that is made and never read refuses nothing");
    IRNode *keys_args[] = {range(d(), 30, 60)};
    EastType *tp[] = {t_int, t_int};
    expect_error(run(builtin(t_set, "DictKeys", tp, 2, keys_args, 1), t_dict, t_set, source), words,
                 "a read that decodes its rows is refused in the same words");
    free(words);
    east_value_release(source);
    byte_buffer_free(blob);
    east_value_release(whole);

    /* A Set's range is refused as a Dict's is. */
    EastValue *set = int_set();
    ByteBuffer *set_ordered = encode_in_segments(set, t_set, PER_SEGMENT);
    ByteBuffer *set_blob = set_ordered ? swap_first_two_segments(set_ordered) : NULL;
    if (set_ordered) byte_buffer_free(set_ordered);
    source = set_blob ? open_lazy(set_blob, t_set, true) : NULL;
    check(source != NULL, "a Set whose first two segments are in each other's place opens lazily");
    if (source) {
        EastType *range_tp[] = {t_int, t_int, t_int};
        EastType *size_tp[] = {t_int};
        IRNode *range_args[] = {var(t_set, "d"), bound(30), bound(60)};
        IRNode *size_args[] = {builtin(t_set, "SetRange", range_tp, 3, range_args, 3)};
        expect_error(run(builtin(t_int, "SetSize", size_tp, 1, size_args, 1), t_set, t_int, source),
                     "are not disjoint ascending",
                     "the size of a Set's range whose ends cannot be placed is refused, not zero");
        east_value_release(source);
    } else {
        free(east_builtin_get_error());
    }
    if (set_blob) byte_buffer_free(set_blob);
    east_value_release(set);
}

/* ---- 8: a range narrowed in a loop ------------------------------------------ */

/* Runs `fn` on a thread whose stack is 1 MiB — less than a main thread's 8,
 * as a worker's may be — where a recursion as deep as the loop below narrows
 * a range does not fit. On Windows, on the main thread: a thread's stack
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

/* Days 0, 1, …, 89, 0, 1, … — each a key of the first four segments, the
 * most a later one starts at 89 — so the range ends as the rows from key 90
 * on. */
#define DEEP 100000

/* Compiles `(d, days) => Integer` of `body`, which it takes, and calls it. */
static EvalResult run_days(IRNode *body, EastValue *input, EastValue *days)
{
    IRVariable params[2] = {
        {.name = "d", .mutable = false, .captured = false, .loc_id = 0},
        {.name = "days", .mutable = false, .captured = false, .loc_id = 0},
    };
    EastType *days_type = east_array_type(t_int);
    EastType *inputs[2] = {t_dict, days_type};
    EastType *fn_type = east_function_type(inputs, 2, t_int);
    IRNode *fn_node = ir_function(fn_type, NULL, 0, params, 2, body);
    ir_node_release(body);
    ir_resolve_scopes(fn_node);
    EastCompiledFn *fn = east_compile_fn(fn_node, platform, builtins, NULL);
    EastValue *args[2] = {input, days};
    EvalResult r = fn ? east_call(fn, args, 2) : eval_error("the body does not compile");
    if (fn) east_compiled_fn_free(fn);
    ir_node_release(fn_node);
    east_type_release(fn_type);
    east_type_release(days_type);
    return r;
}

/* `window = d.range(); for (day of days) window = window.range({ from: day }); <then>` */
static IRNode *narrowed_in_a_loop(IRNode *then)
{
    EastType *tp[] = {t_int, t_int, t_int, t_int};
    EastType *days_type = east_array_type(t_int);
    IRNode *day = var(t_int, "day");
    IRNode *from = ir_variant(t_bound, "some", day);
    ir_node_release(day);
    IRNode *args[] = {ir_variable(t_dict, "window", true, false), from, bound(-1)};
    IRNode *narrowed[] = {builtin(t_dict, "DictRange", tp, 4, args, 3)};
    IRNode *each = made_of(ir_assign(t_null, "window", narrowed[0]), narrowed, 1);
    IRNode *loop_parts[] = {var(days_type, "days"), each};
    IRNode *loop = made_of(ir_for_array(t_null, "day", NULL, loop_parts[0], loop_parts[1], NULL),
                           loop_parts, 2);
    east_type_release(days_type);
    IRNode *stmts[] = {let("window", true, range(d(), -1, -1)), loop, then};
    return block(t_int, stmts, 3);
}

static void *narrow_in_a_loop(void *arg)
{
    ByteBuffer *blob = arg;
    EastValue *days = east_array_new(t_int);
    for (size_t i = 0; i < DEEP; i++) {
        EastValue *day = east_integer((int64_t)(i % 90));
        east_array_push(days, day);
        east_value_release(day);
    }

    /* Read after: its size places it, by a loop. */
    EastValue *source = open_lazy(blob, t_dict, true);
    expect_integer(run_days(narrowed_in_a_loop(size(ir_variable(t_dict, "window", true, false))),
                            source, days),
                   ROWS - 30, "the size of a range a body narrowed a hundred thousand times");
    check_count(decoded(source), 4,
                "segments decoded to place it: each of the four segments the days land in, once");
    check(lazy(source), "which leaves its input lazy");
    east_value_release(source);

    /* Never read: let go, by a loop, as the body ends. */
    source = open_lazy(blob, t_dict, true);
    expect_integer(run_days(narrowed_in_a_loop(integer(7)), source, days), 7,
                   "a body that narrows a range a hundred thousand times and never reads it");
    check_count(decoded(source), 0, "segments decoded by a range never read");
    east_value_release(source);

    east_value_release(days);
    east_gc_collect_full();
    return NULL;
}

int main(void)
{
    east_type_of_type_init();
    builtins = builtin_registry_new();
    east_register_all_builtins(builtins);
    platform = platform_registry_new();
    t_dict = east_dict_type(t_int, t_int);
    t_set = east_set_type(t_int);
    t_bound = option_of(t_int);

    printf("paged range, read by a body (issue #1616)\n");
    EastValue *whole = int_dict();
    ByteBuffer *blob = encode_in_segments(whole, t_dict, PER_SEGMENT);
    check(blob != NULL, "the fixture encodes");
    if (blob) {
        test_reads(blob);
        test_handed_on(blob);
        test_own_rows(blob);
        test_source_moves(blob);
        test_loops(blob);
    }
    test_projection();
    test_sets_and_prefixes();
    test_refusals();
    if (blob) {
        on_small_stack(narrow_in_a_loop, blob);
        byte_buffer_free(blob);
    }
    east_value_release(whole);

    east_type_release(t_bound);
    east_type_release(t_set);
    east_type_release(t_dict);
    platform_registry_free(platform);
    builtin_registry_free(builtins);
    east_gc_collect_full();

    if (failures == 0) {
        printf("GATE PASS: a body reads a range of a lazily opened collection at the cost of the "
               "range — its size by its two ends, a keyed read by the bounds, a loop by its "
               "segments each once — and every other read by its own rows alone (issue #1616)\n");
        return 0;
    }
    printf("GATE FAIL: %d check(s) failed\n", failures);
    return 1;
}
