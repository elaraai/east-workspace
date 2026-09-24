/*
 * The beast2 conformance corpus (east/test/beast2_corpus.spec.ts), written
 * again here and held to TypeScript's bytes: every value's whole-value blob,
 * paged blob and manifest directory; every emission sequence's runs and their
 * merge; every merge of sorted inputs, as a blob and as a manifest directory.
 * A fold is compiled from the IR the corpus carries, as `east-c merge --merge`
 * compiles one. Run under ASan/LSan for the sorter's, the merge's and the
 * manifest writer's lifetimes.
 *
 * Usage: test_beast2_corpus [corpus-dir] [scratch-dir]
 *   (defaults: /tmp/east-test-ir/beast2_corpus, and the working directory)
 *
 * Exits 77 (ctest SKIP) when the corpus is absent — `make test-export` in
 * libs/east writes it beside the compliance IR.
 */

#include <east/compat.h>
#include <east/east.h>
#include <east/type_of_type.h>

#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define SKIP_EXIT_CODE 77

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

static char g_dir[1024];
static PlatformRegistry *g_platform;
static BuiltinRegistry *g_builtins;

/* ----- files ------------------------------------------------------------ */

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

static bool write_file(const char *path, const uint8_t *bytes, size_t len)
{
    FILE *f = fopen(path, "wb");
    if (!f) return false;
    bool ok = fwrite(bytes, 1, len, f) == len;
    return fclose(f) == 0 && ok;
}

/* Whether a buffer holds exactly a Blob value's bytes. */
static bool same_bytes(const ByteBuffer *buf, const EastValue *blob)
{
    return buf && buf->len == blob->data.blob.len &&
           (buf->len == 0 || memcmp(buf->data, blob->data.blob.data, buf->len) == 0);
}

/* Removes a manifest directory: every object the manifest names, the objects
 * directory, and the manifest. */
static void remove_dir(const char *path)
{
    ByteBuffer *bytes = read_file(path);
    EastValue *manifest = NULL;
    char object[1400];
    if (bytes && east_beast2_read_manifest(bytes->data, bytes->len, &manifest) == 1) {
        EastValue *header = east_struct_get_field(manifest, "header");
        snprintf(object, sizeof(object), "%s.segments/%.*s.beast2", path,
                 (int)header->data.string.len, header->data.string.data);
        remove(object);
        EastValue *entries = east_struct_get_field(manifest, "entries");
        for (size_t i = 0; i < east_array_len(entries); i++) {
            EastValue *hash = east_struct_get_field(east_array_get(entries, i), "hash");
            snprintf(object, sizeof(object), "%s.segments/%.*s.beast2", path,
                     (int)hash->data.string.len, hash->data.string.data);
            remove(object);
        }
        east_value_release(manifest);
    }
    if (bytes) byte_buffer_free(bytes);
    snprintf(object, sizeof(object), "%s.segments", path);
    rmdir(object);
    remove(path);
}

/* ----- folds -------------------------------------------------------------- */

typedef struct {
    IRNode *ir;
    EastCompiledFn *fn;
} Fold;

/* Compiles a case's `merge` — an Option of the IR of a (K, V, V) -> V
 * function — as east-c-cli compiles `--merge`: with the IR's own source map
 * current, then handed to the function. A `none` compiles nothing. */
static bool fold_compile(const char *name, EastValue *option, Fold *out)
{
    out->ir = NULL;
    out->fn = NULL;
    if (strcmp(east_variant_case_name(option), "some") != 0) return true;
    EastValue *blob = option->data.variant.value;
    EastSourceMap *map = NULL;
    out->ir = east_beast2_decode_ir(blob->data.blob.data, blob->data.blob.len, NULL, &map);
    CHECK(out->ir != NULL, "%s: the fold's IR does not decode", name);
    if (!out->ir) {
        east_source_map_release(map);
        return false;
    }
    const EastSourceMap *saved = east_get_source_map();
    if (map) east_set_source_map(map);
    char *err = NULL;
    out->fn = east_compile_fn(out->ir, g_platform, g_builtins, &err);
    east_set_source_map(saved);
    CHECK(out->fn != NULL, "%s: the fold does not compile: %s", name, err ? err : "?");
    free(err);
    if (!out->fn) {
        east_source_map_release(map);
        ir_node_release(out->ir);
        out->ir = NULL;
        return false;
    }
    if (map) out->fn->source_map = map;
    return true;
}

static void fold_free(Fold *fold)
{
    if (fold->fn) east_compiled_fn_free(fold->fn);
    if (fold->ir) ir_node_release(fold->ir);
}

/* ----- values --------------------------------------------------------------- */

/* A value is written as TypeScript writes it: its whole-value blob, its paged
 * blob, and its manifest directory; the paged blob and the directory read
 * back as the value. */
static void check_value(EastValue *c, size_t index)
{
    const char *name = east_struct_get_field(c, "name")->data.string.data;
    EastValue *whole = east_struct_get_field(c, "value");
    EastValue *paged = east_struct_get_field(c, "paged");
    EastValue *manifest = east_struct_get_field(c, "manifest");

    EastType *type = east_beast2_extract_type(whole->data.blob.data, whole->data.blob.len);
    EastValue *value =
        type ? east_beast2_decode_full(whole->data.blob.data, whole->data.blob.len, type) : NULL;
    CHECK(value != NULL, "%s: the value does not decode: %s", name, east_builtin_get_error());
    if (!value) {
        if (type) east_type_release(type);
        return;
    }

    ByteBuffer *mine = east_beast2_encode_full(value, type);
    CHECK(same_bytes(mine, whole), "%s: the whole-value blob differs from TypeScript's", name);
    if (mine) byte_buffer_free(mine);

    mine = east_beast2_encode_paged(value, type, EAST_BEAST2_CODEC_DEFLATE);
    CHECK(same_bytes(mine, paged), "%s: the paged blob differs from TypeScript's", name);
    if (mine) byte_buffer_free(mine);

    EastValue *back = east_beast2_decode_full(paged->data.blob.data, paged->data.blob.len, type);
    CHECK(back && east_value_equal(back, value), "%s: the paged blob does not decode to the value",
          name);
    if (back) east_value_release(back);

    char path[1200];
    snprintf(path, sizeof(path), "%s/value-%zu.beast2", g_dir, index);
    CHECK(east_beast2_write_manifest_dir(value, type, EAST_BEAST2_CODEC_DEFLATE, path),
          "%s: writing the manifest directory failed: %s", name, east_builtin_get_error());
    ByteBuffer *written = read_file(path);
    CHECK(same_bytes(written, manifest), "%s: the manifest differs from TypeScript's", name);
    EastValue *read = NULL;
    if (written && east_beast2_read_manifest(written->data, written->len, &read) == 1) {
        EastValue *dir = east_beast2_decode_manifest_dir(path, read, type, false);
        CHECK(dir && east_value_equal(dir, value),
              "%s: the directory does not read back as the value", name);
        if (dir) east_value_release(dir);
        east_value_release(read);
    }
    if (written) byte_buffer_free(written);
    remove_dir(path);

    east_value_release(value);
    east_type_release(type);
}

/* ----- runs ------------------------------------------------------------------ */

#define MAX_RUNS 16

typedef struct {
    ByteBuffer *runs[MAX_RUNS];
    size_t n;
} Runs;

static bool runs_open(void *ctx, size_t run)
{
    Runs *r = ctx;
    if (run != r->n || r->n == MAX_RUNS) {
        east_builtin_error("test: runs opened out of order, or too many");
        return false;
    }
    r->runs[r->n++] = byte_buffer_new(1024);
    return true;
}

static bool runs_write(void *ctx, const uint8_t *bytes, size_t len)
{
    Runs *r = ctx;
    byte_buffer_write_bytes(r->runs[r->n - 1], bytes, len);
    return true;
}

static bool runs_close(void *ctx)
{
    (void)ctx;
    return true;
}

/* Merges blob files with a case's fold into `output` and returns its bytes. */
static ByteBuffer *merge_files(const char *name, const char *const *paths, size_t n,
                               const Fold *fold, bool union_mode, const char *range,
                               bool output_manifest, const char *output)
{
    EastMergeConfig cfg = {.input_paths = paths,
                           .num_inputs = n,
                           .output_path = output,
                           .output_manifest = output_manifest,
                           .merge_fn = fold->fn,
                           .union_mode = union_mode,
                           .range_path = range};
    EastMergeStats stats;
    bool ok = east_merge_blobs(&cfg, &stats);
    CHECK(ok, "%s: the merge failed: %s", name, east_builtin_get_error());
    return ok ? read_file(output) : NULL;
}

/* An emission sequence closes TypeScript's runs, and TypeScript's runs merge
 * to its merged blob. */
static void check_runs(EastValue *c, size_t index)
{
    const char *name = east_struct_get_field(c, "name")->data.string.data;
    EastValue *elements_blob = east_struct_get_field(c, "elements");
    bool union_mode = east_struct_get_field(c, "union")->data.boolean;
    EastValue *runs = east_struct_get_field(c, "runs");
    EastValue *merged = east_struct_get_field(c, "merged");

    EastType *type = east_beast2_extract_type(merged->data.blob.data, merged->data.blob.len);
    EastValue *elements =
        east_beast2_decode_auto(elements_blob->data.blob.data, elements_blob->data.blob.len);
    Fold fold;
    bool ready = type && elements && fold_compile(name, east_struct_get_field(c, "merge"), &fold);
    CHECK(type && elements, "%s: the case does not decode", name);
    if (!ready) {
        if (type) east_type_release(type);
        if (elements) east_value_release(elements);
        return;
    }

    Runs r = {0};
    Beast2RunSink sink = {&r, runs_open, runs_write, runs_close};
    Beast2RunSorter *s =
        east_beast2_run_sorter_new(type, EAST_BEAST2_CODEC_DEFLATE, &sink, fold.fn, union_mode);
    CHECK(s != NULL, "%s: the sorter refused the case: %s", name, east_builtin_get_error());
    if (s) {
        east_beast2_run_sorter_set_parallel(s, true);
        bool dict = type->kind == EAST_TYPE_DICT;
        bool ok = true;
        for (size_t i = 0; ok && i < east_array_len(elements); i++) {
            EastValue *e = east_array_get(elements, i);
            ok = dict ? east_beast2_run_sorter_add_pair(s, east_struct_get_field(e, "key"),
                                                        east_struct_get_field(e, "value"))
                      : east_beast2_run_sorter_add(s, e);
        }
        ok = ok && east_beast2_run_sorter_finish(s);
        CHECK(ok, "%s: sorting failed: %s", name, east_builtin_get_error());
        east_beast2_run_sorter_free(s);
        CHECK(r.n == east_array_len(runs), "%s: %zu runs closed, TypeScript closed %zu", name, r.n,
              east_array_len(runs));
        for (size_t i = 0; i < r.n && i < east_array_len(runs); i++)
            CHECK(same_bytes(r.runs[i], east_array_get(runs, i)),
                  "%s: run %zu differs from TypeScript's", name, i);
    }
    for (size_t i = 0; i < r.n; i++)
        byte_buffer_free(r.runs[i]);

    size_t n = east_array_len(runs);
    char(*names)[1200] = calloc(n > 0 ? n : 1, sizeof(*names));
    const char **paths = calloc(n > 0 ? n : 1, sizeof(char *));
    bool written = true;
    for (size_t i = 0; i < n; i++) {
        snprintf(names[i], sizeof(names[i]), "%s/runs-%zu-%zu.beast2", g_dir, index, i);
        paths[i] = names[i];
        EastValue *run = east_array_get(runs, i);
        written = written && write_file(paths[i], run->data.blob.data, run->data.blob.len);
    }
    char output[1200];
    snprintf(output, sizeof(output), "%s/runs-%zu-merged.beast2", g_dir, index);
    ByteBuffer *mine = written && n > 0
                           ? merge_files(name, paths, n, &fold, union_mode, NULL, false, output)
                           : NULL;
    CHECK(n == 0 || same_bytes(mine, merged), "%s: the merged runs differ from TypeScript's", name);
    if (mine) byte_buffer_free(mine);
    remove(output);
    for (size_t i = 0; i < n; i++)
        remove(paths[i]);
    free(paths);
    free(names);

    fold_free(&fold);
    east_value_release(elements);
    east_type_release(type);
}

/* ----- merges ----------------------------------------------------------------- */

/* Sorted inputs merge, over the case's key range, to TypeScript's blob and to
 * TypeScript's manifest. */
static void check_merge(EastValue *c, size_t index)
{
    const char *name = east_struct_get_field(c, "name")->data.string.data;
    EastValue *inputs = east_struct_get_field(c, "inputs");
    bool union_mode = east_struct_get_field(c, "union")->data.boolean;
    EastValue *range = east_struct_get_field(c, "range");
    EastValue *expected = east_struct_get_field(c, "expected");
    EastValue *manifest = east_struct_get_field(c, "manifest");

    Fold fold;
    if (!fold_compile(name, east_struct_get_field(c, "merge"), &fold)) return;

    size_t n = east_array_len(inputs);
    char(*names)[1200] = calloc(n > 0 ? n : 1, sizeof(*names));
    const char **paths = calloc(n > 0 ? n : 1, sizeof(char *));
    bool written = true;
    for (size_t i = 0; i < n; i++) {
        snprintf(names[i], sizeof(names[i]), "%s/merge-%zu-%zu.beast2", g_dir, index, i);
        paths[i] = names[i];
        EastValue *input = east_array_get(inputs, i);
        written = written && write_file(paths[i], input->data.blob.data, input->data.blob.len);
    }
    char range_path[1200];
    const char *range_file = NULL;
    if (strcmp(east_variant_case_name(range), "some") == 0) {
        EastValue *bounds = range->data.variant.value;
        snprintf(range_path, sizeof(range_path), "%s/merge-%zu-range.beast2", g_dir, index);
        written = written && write_file(range_path, bounds->data.blob.data, bounds->data.blob.len);
        range_file = range_path;
    }
    CHECK(written, "%s: writing the inputs failed", name);

    char output[1200];
    snprintf(output, sizeof(output), "%s/merge-%zu-out.beast2", g_dir, index);
    ByteBuffer *mine =
        written ? merge_files(name, paths, n, &fold, union_mode, range_file, false, output) : NULL;
    CHECK(same_bytes(mine, expected), "%s: the merge differs from TypeScript's", name);
    if (mine) byte_buffer_free(mine);
    remove(output);

    snprintf(output, sizeof(output), "%s/merge-%zu-dir.beast2", g_dir, index);
    mine =
        written ? merge_files(name, paths, n, &fold, union_mode, range_file, true, output) : NULL;
    CHECK(same_bytes(mine, manifest), "%s: the merge's manifest differs from TypeScript's", name);
    if (mine) byte_buffer_free(mine);
    remove_dir(output);

    if (range_file) remove(range_file);
    for (size_t i = 0; i < n; i++)
        remove(paths[i]);
    free(paths);
    free(names);
    fold_free(&fold);
}

/* ----- the corpus --------------------------------------------------------------- */

/* Every case of one corpus file, through `check`. */
static void run_file(const char *corpus, const char *file, void (*check)(EastValue *, size_t))
{
    char path[1200];
    snprintf(path, sizeof(path), "%s/%s", corpus, file);
    ByteBuffer *bytes = read_file(path);
    CHECK(bytes != NULL, "%s is missing", path);
    if (!bytes) return;
    EastValue *cases = east_beast2_decode_auto(bytes->data, bytes->len);
    byte_buffer_free(bytes);
    CHECK(cases != NULL, "%s does not decode: %s", path, east_builtin_get_error());
    if (!cases) return;
    size_t n = east_array_len(cases);
    for (size_t i = 0; i < n; i++) {
        int before = failures;
        EastValue *c = east_array_get(cases, i);
        check(c, i);
        printf("[%c] %s: %s\n", failures == before ? '+' : 'x', file,
               east_struct_get_field(c, "name")->data.string.data);
    }
    CHECK(n > 0, "%s holds no cases", path);
    east_value_release(cases);
}

int main(int argc, char **argv)
{
    const char *corpus = argc > 1 ? argv[1] : "/tmp/east-test-ir/beast2_corpus";
    const char *scratch = argc > 2 ? argv[2] : ".";

    char probe[1200];
    snprintf(probe, sizeof(probe), "%s/values.beast2", corpus);
    FILE *f = fopen(probe, "rb");
    if (!f) {
        printf("SKIP: no corpus at %s (run `make test-export` in libs/east)\n", corpus);
        return SKIP_EXIT_CODE;
    }
    fclose(f);

    east_type_of_type_init();
    g_builtins = builtin_registry_new();
    east_register_all_builtins(g_builtins);
    g_platform = platform_registry_new();
    east_set_thread_context(g_platform, g_builtins);

    snprintf(g_dir, sizeof(g_dir), "%s/corpus_gate_XXXXXX", scratch);
    if (!mkdtemp(g_dir)) {
        fprintf(stderr, "cannot create a scratch directory in %s\n", scratch);
        return 1;
    }
    run_file(corpus, "values.beast2", check_value);
    run_file(corpus, "runs.beast2", check_runs);
    run_file(corpus, "merges.beast2", check_merge);
    rmdir(g_dir);

    platform_registry_free(g_platform);
    builtin_registry_free(g_builtins);
    if (failures > 0) {
        fprintf(stderr, "beast2 corpus: %d check(s) failed\n", failures);
        return 1;
    }
    printf("beast2 corpus: all cases passed\n");
    return 0;
}
