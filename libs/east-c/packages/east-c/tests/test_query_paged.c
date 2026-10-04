/*
 * Translated queries over paged datasets (#925, X3).
 *
 * A jq query reaches east-c as ordinary East IR (#923), with nothing
 * query-specific in the runtime. Checked against an e3 root, each root field
 * the program reads is a parameter of its own, so a dataset opened lazily
 * reaches the loops and keyed reads that page it rather than a struct that
 * would hydrate it. This gate runs the translations the query corpus carries
 * (libs/east/test/fixtures/query-corpus.beast2) over the shared fixture's
 * datasets (query-fixture.beast2), written in small segments and opened paged
 * and frozen as e3 opens a task's inputs, and holds each run to the corpus's
 * output and to what east_paged_stats says it read:
 *
 *   - first(.orders[] | select(.total > 1000)) decodes the segment holding
 *     the first large order, and no other;
 *   - limit(10; .orders[]) decodes the segments holding the first ten orders;
 *   - .orders | length decodes none;
 *   - .byId[1017] decodes the one segment holding the key;
 *   - the program over customers and orders (the corpus's pipe-root-reads)
 *     walks every order and looks each customer up;
 *
 * and nothing is ever hydrated. Run under ASan/LSan (`make leak-check` runs
 * the ctest gates in its build-asan tree).
 *
 * Usage: test_query_paged [fixtures-dir]
 *   (default: libs/east/test/fixtures, where CMake says this source lives)
 */
#include <east/east.h>
#include <east/gc.h>
#include <east/type_of_type.h>

#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#ifndef EAST_QUERY_FIXTURES_DIR
#define EAST_QUERY_FIXTURES_DIR "../../../east/test/fixtures"
#endif

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

/* Elements (pairs) per segment: the test's geometry rather than the cut
 * rule's, which would hold the fixture's 40 orders in one segment. With four,
 * the orders and byId are ten segments each and the customers two. */
#define ELEMENTS_PER_SEGMENT 4

/* The most datasets a case reads. */
#define MAX_READS 2

/* A corpus case run over paged datasets. */
typedef struct {
    const char *name;             /* the case, in query-corpus.beast2 */
    const char *reads[MAX_READS]; /* its parameters: the root fields it reads, in the order
                                     it first reads them (the translation's inputs) */
    size_t num_reads;
    size_t decoded[MAX_READS]; /* the segments each must decode */
} PagedCase;

static const PagedCase CASES[] = {
    /* Order 1002, the second, is the first over 1000: segment 0. */
    {"call-first-root-paged", {"orders"}, 1, {1}},
    /* Orders 0–9 are segments 0, 1 and 2. */
    {"call-limit-root-paged", {"orders"}, 1, {3}},
    /* The index counts the elements. */
    {"call-length-root-paged", {"orders"}, 1, {0}},
    /* Key 1017, the seventeenth, is in segment 4; the fences find it. */
    {"index-integer-key-root-paged", {"byId"}, 1, {1}},
    /* Every customer is looked up (each segment once, then cached) and every
     * order read (each segment once, projected to customer_id). */
    {"pipe-root-reads", {"customers", "orders"}, 2, {2, 10}},
};

static PlatformRegistry *g_platform;
static BuiltinRegistry *g_builtins;

static ByteBuffer *read_file(const char *path)
{
    FILE *f = fopen(path, "rb");
    if (!f) return NULL;
    fseek(f, 0, SEEK_END);
    long len = ftell(f);
    fseek(f, 0, SEEK_SET);
    ByteBuffer *buf = byte_buffer_new(len > 0 ? (size_t)len : 1);
    buf->len = fread(buf->data, 1, (size_t)len, f);
    fclose(f);
    return buf;
}

/* The type of a struct type's field, or NULL. */
static EastType *field_type(EastType *type, const char *name)
{
    for (size_t i = 0; i < type->data.struct_.num_fields; i++)
        if (strcmp(type->data.struct_.fields[i].name, name) == 0)
            return type->data.struct_.fields[i].type;
    return NULL;
}

/* A self-contained, indexed blob of `value` (an Array or Dict) in segments of
 * ELEMENTS_PER_SEGMENT, as a malloc'd copy (the paged open takes it). */
static uint8_t *encode_in_segments(EastValue *value, EastType *type, size_t *len_out)
{
    Beast2StreamWriter *w = east_beast2_writer_new(type, EAST_BEAST2_CODEC_DEFLATE, true, true);
    if (!w) return NULL;
    bool array = type->kind == EAST_TYPE_ARRAY;
    size_t n = array ? east_array_len(value) : east_dict_len(value);
    bool ok = true;
    for (size_t i = 0; ok && i < n; i += ELEMENTS_PER_SEGMENT) {
        size_t end = i + ELEMENTS_PER_SEGMENT < n ? i + ELEMENTS_PER_SEGMENT : n;
        EastValue *batch = array ? east_array_new(type->data.element)
                                 : east_dict_new(type->data.dict.key, type->data.dict.value);
        for (size_t k = i; k < end; k++) {
            if (array)
                east_array_push(batch, east_array_get(value, k));
            else
                east_dict_set(batch, east_dict_key_at(value, k), east_dict_val_at(value, k));
        }
        ok = east_beast2_writer_write(w, batch);
        east_value_release(batch);
    }
    ok = ok && east_beast2_writer_finish(w);
    ByteBuffer *buf = ok ? east_beast2_writer_take(w) : NULL;
    east_beast2_writer_free(w);
    if (!buf) return NULL;
    uint8_t *data = malloc(buf->len);
    memcpy(data, buf->data, buf->len);
    *len_out = buf->len;
    byte_buffer_free(buf);
    return data;
}

/* The fixture's dataset `name`, written in small segments and opened paged
 * and frozen. */
static EastValue *open_dataset(EastValue *root, EastType *root_type, const char *name)
{
    EastType *type = field_type(root_type, name);
    EastValue *value = east_struct_get_field(root, name);
    CHECK(type && value, "the fixture has no dataset %s", name);
    if (!type || !value) return NULL;
    size_t len = 0;
    uint8_t *data = encode_in_segments(value, type, &len);
    CHECK(data != NULL, "%s: the paged encode failed: %s", name, east_builtin_get_error());
    if (!data) return NULL;
    EastValue *paged = east_beast2_open_paged_frozen(data, len, type);
    CHECK(paged && paged->kind == EAST_VAL_PAGED, "%s does not open paged: %s", name,
          east_builtin_get_error());
    if (!paged) {
        free(data);
        return NULL;
    }
    /* A keyed read decodes its segment once and caches it: the counts below
     * hold at the default budget of decoded weight, whatever
     * EAST_PAGED_CACHE_BYTES says. */
    east_beast2_pages_set_cache_budget(paged->data.paged.pages, (size_t)256 * 1024 * 1024);
    return paged;
}

/* The corpus entry of the case named `name`, borrowed from `corpus`. */
static EastValue *corpus_entry(EastValue *corpus, const char *name)
{
    EastValue *cases = east_struct_get_field(corpus, "cases");
    for (size_t i = 0; i < east_array_len(cases); i++) {
        EastValue *entry = east_array_get(cases, i);
        EastValue *c = east_struct_get_field(entry, "case");
        if (strcmp(east_struct_get_field(c, "name")->data.string.data, name) == 0) return entry;
    }
    return NULL;
}

/* Compiles a corpus entry's translation, as the corpus writes it: IR and its
 * source map in one blob. */
static EastCompiledFn *compile_translation(const char *name, EastValue *entry, IRNode **ir_out)
{
    EastValue *translated = east_struct_get_field(entry, "translated");
    *ir_out = NULL;
    CHECK(strcmp(east_variant_case_name(translated), "some") == 0,
          "%s: the case has no translation", name);
    if (strcmp(east_variant_case_name(translated), "some") != 0) return NULL;
    EastValue *blob = translated->data.variant.value;
    EastSourceMap *map = NULL;
    IRNode *ir = east_beast2_decode_ir(blob->data.blob.data, blob->data.blob.len, NULL, &map);
    CHECK(ir != NULL, "%s: the translation's IR does not decode", name);
    if (!ir) {
        east_source_map_release(map);
        return NULL;
    }
    const EastSourceMap *saved = east_get_source_map();
    if (map) east_set_source_map(map);
    char *err = NULL;
    EastCompiledFn *fn = east_compile_fn(ir, g_platform, g_builtins, &err);
    east_set_source_map(saved);
    CHECK(fn != NULL, "%s: the translation does not compile: %s", name, err ? err : "?");
    free(err);
    if (!fn) {
        east_source_map_release(map);
        ir_node_release(ir);
        return NULL;
    }
    if (map) fn->source_map = map;
    *ir_out = ir;
    return fn;
}

/* Runs one case over freshly opened datasets: the corpus's output, the
 * segments each dataset decodes, and no hydration. */
static void run_case(const PagedCase *pc, EastValue *corpus, EastValue *root, EastType *root_type)
{
    EastValue *entry = corpus_entry(corpus, pc->name);
    CHECK(entry != NULL, "the corpus has no case %s (run `make query-corpus` in libs/east)",
          pc->name);
    if (!entry) return;
    EastValue *expected = east_struct_get_field(east_struct_get_field(entry, "case"), "output");

    IRNode *ir = NULL;
    EastCompiledFn *fn = compile_translation(pc->name, entry, &ir);
    if (!fn) return;
    CHECK(fn->num_params == pc->num_reads, "%s: the translation takes %zu inputs, not %zu",
          pc->name, fn->num_params, pc->num_reads);

    EastValue *args[MAX_READS] = {NULL};
    bool opened = fn->num_params == pc->num_reads;
    for (size_t i = 0; opened && i < pc->num_reads; i++) {
        args[i] = open_dataset(root, root_type, pc->reads[i]);
        opened = args[i] != NULL;
    }
    if (opened) {
        size_t projected = 0, whole = 0;
        east_beast2_paged_loop_stats(&projected, &whole);
        EvalResult r = east_call(fn, args, pc->num_reads);
        CHECK(r.status == EVAL_OK, "%s: the query failed: %s", pc->name,
              r.error_message ? r.error_message : "?");
        if (r.status == EVAL_OK && r.value) {
            char *printed = east_print_value(r.value, fn->fn_type->data.function.output);
            bool has_output = strcmp(east_variant_case_name(expected), "some") == 0;
            const char *want = has_output ? expected->data.variant.value->data.string.data : "";
            CHECK(has_output && printed && strcmp(printed, want) == 0,
                  "%s: the result differs from the corpus's\n  got:  %s\n  want: %s", pc->name,
                  printed ? printed : "(null)", want);
            free(printed);
        }
        if (r.value) east_value_release(r.value);
        eval_result_free(&r);
        size_t projected_after = 0, whole_after = 0;
        east_beast2_paged_loop_stats(&projected_after, &whole_after);
        printf("    loops: %zu segments decoded projected, %zu whole\n",
               projected_after - projected, whole_after - whole);

        for (size_t i = 0; i < pc->num_reads; i++) {
            size_t segments = 0, decoded = 0, fences = 0;
            bool hydrated = true;
            CHECK(east_paged_stats(args[i], &segments, &decoded, &fences, &hydrated),
                  "%s: %s is not paged", pc->name, pc->reads[i]);
            CHECK(!hydrated, "%s: %s was hydrated", pc->name, pc->reads[i]);
            CHECK(decoded == pc->decoded[i], "%s: %s decoded %zu of its %zu segments, not %zu",
                  pc->name, pc->reads[i], decoded, segments, pc->decoded[i]);
            printf("    %s: %zu of %zu segments decoded, %zu fences probed, not hydrated\n",
                   pc->reads[i], decoded, segments, fences);
        }
    }
    for (size_t i = 0; i < pc->num_reads; i++)
        if (args[i]) east_value_release(args[i]);
    east_compiled_fn_free(fn);
    ir_node_release(ir);
}

int main(int argc, char **argv)
{
    const char *dir = argc > 1 ? argv[1] : EAST_QUERY_FIXTURES_DIR;

    east_type_of_type_init();
    g_builtins = builtin_registry_new();
    east_register_all_builtins(g_builtins);
    g_platform = platform_registry_new();
    /* The fixture's demand model is a function value: decoding it compiles. */
    east_set_thread_context(g_platform, g_builtins);

    char path[1200];
    snprintf(path, sizeof(path), "%s/query-fixture.beast2", dir);
    ByteBuffer *fixture = read_file(path);
    snprintf(path, sizeof(path), "%s/query-corpus.beast2", dir);
    ByteBuffer *corpus_bytes = read_file(path);
    CHECK(fixture && corpus_bytes, "the query fixtures are missing from %s", dir);

    EastType *root_type = fixture ? east_beast2_extract_type(fixture->data, fixture->len) : NULL;
    EastValue *root =
        root_type ? east_beast2_decode_full(fixture->data, fixture->len, root_type) : NULL;
    EastValue *corpus =
        corpus_bytes ? east_beast2_decode_auto(corpus_bytes->data, corpus_bytes->len) : NULL;
    CHECK(!fixture || (root && root_type->kind == EAST_TYPE_STRUCT),
          "query-fixture.beast2 does not decode to the fixture's root: %s",
          east_builtin_get_error());
    CHECK(!corpus_bytes || corpus, "query-corpus.beast2 does not decode: %s",
          east_builtin_get_error());

    if (root && root_type->kind == EAST_TYPE_STRUCT && corpus) {
        for (size_t i = 0; i < sizeof(CASES) / sizeof(CASES[0]); i++) {
            int before = failures;
            printf("[>] %s\n", CASES[i].name);
            run_case(&CASES[i], corpus, root, root_type);
            printf("[%c] %s\n", failures == before ? '+' : 'x', CASES[i].name);
        }
    }

    if (corpus) east_value_release(corpus);
    if (root) east_value_release(root);
    if (root_type) east_type_release(root_type);
    if (corpus_bytes) byte_buffer_free(corpus_bytes);
    if (fixture) byte_buffer_free(fixture);
    east_gc_collect_full();
    platform_registry_free(g_platform);
    builtin_registry_free(g_builtins);

    if (failures > 0) {
        fprintf(stderr, "paged queries: %d check(s) failed\n", failures);
        return 1;
    }
    printf("paged queries: all cases passed\n");
    return 0;
}
