/*
 * east-c CLI — Run compiled East IR programs from the command line.
 *
 * Usage:
 *   east-c run <ir_file> [-p PACKAGE...] [-i FILE...] [-o FILE] [-v]
 *   east-c version [-p PACKAGE...]
 */

#include <east/east.h>
#include <east/emit_sink.h>
#include <east/eval_result.h>
#include <east/file_map.h>
#include <east/type_of_type.h>
#include <east/ir_normalize.h>
#include <east_std/east_std.h>

#include "snapshot.h"

#include <errno.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
#include <sys/stat.h>
#include <east/hashmap.h>
#include <east/compat.h>

static double elapsed_ms(struct timespec *start, struct timespec *end)
{
    return (double)(end->tv_sec - start->tv_sec) * 1000.0 +
           (double)(end->tv_nsec - start->tv_nsec) / 1e6;
}

/* Format an EastType as east-text (matches TS printType / Python print_type).
 * Caller must free the returned string. Returns NULL on allocation failure. */
static char *format_type(EastType *t)
{
    EastValue *tv = east_type_to_value(t);
    if (!tv) return NULL;
    char *s = east_print_value(tv, east_type_type);
    east_value_release(tv);
    return s;
}

/* Write a file-size string into buf. Uses B / KB / MB depending on size. */
static void format_size(off_t bytes, char *buf, size_t buflen)
{
    if (bytes < 1024) {
        snprintf(buf, buflen, "%lld B", (long long)bytes);
    } else if (bytes < 1024L * 1024L) {
        snprintf(buf, buflen, "%.1f KB", (double)bytes / 1024.0);
    } else {
        snprintf(buf, buflen, "%.1f MB", (double)bytes / (1024.0 * 1024.0));
    }
}

/* Stat a file and format its size; returns "?" on failure. */
static void format_file_size(const char *path, char *buf, size_t buflen)
{
    struct stat st;
    if (stat(path, &st) == 0) {
        format_size(st.st_size, buf, buflen);
    } else {
        snprintf(buf, buflen, "?");
    }
}

/* Version is set by CMake from the VERSION file */
#ifndef EAST_CLI_VERSION
#define EAST_CLI_VERSION "0.0.0-dev"
#endif
#ifndef EAST_RUNTIME_VERSION
#define EAST_RUNTIME_VERSION "0.0.0-dev"
#endif
#define MAX_PACKAGES 16
#define MAX_INPUTS 64

/* ------------------------------------------------------------------ */
/*  Format detection                                                   */
/* ------------------------------------------------------------------ */

typedef enum {
    FMT_JSON,
    FMT_BEAST2,
    FMT_BEAST,
    FMT_EAST,
    FMT_UNKNOWN,
} FileFormat;

static const char *format_name(FileFormat fmt)
{
    switch (fmt) {
    case FMT_JSON:
        return "json";
    case FMT_BEAST2:
        return "beast2";
    case FMT_BEAST:
        return "beast";
    case FMT_EAST:
        return "east";
    default:
        return "unknown";
    }
}

static FileFormat detect_format(const char *path)
{
    const char *dot = strrchr(path, '.');
    if (!dot) return FMT_UNKNOWN;
    if (strcmp(dot, ".json") == 0) return FMT_JSON;
    if (strcmp(dot, ".beast2") == 0) return FMT_BEAST2;
    if (strcmp(dot, ".beast") == 0) return FMT_BEAST;
    if (strcmp(dot, ".east") == 0) return FMT_EAST;
    return FMT_UNKNOWN;
}

/* ------------------------------------------------------------------ */
/*  File I/O helpers                                                   */
/* ------------------------------------------------------------------ */

static char *read_file_text(const char *path, size_t *out_len)
{
    FILE *f = fopen(path, "rb");
    if (!f) {
        fprintf(stderr, "Error: Cannot open file: %s\n", path);
        return NULL;
    }
    fseek(f, 0, SEEK_END);
    long len = ftell(f);
    fseek(f, 0, SEEK_SET);
    char *buf = malloc((size_t)len + 1);
    if (!buf) {
        fclose(f);
        return NULL;
    }
    size_t rd = fread(buf, 1, (size_t)len, f);
    buf[rd] = '\0';
    fclose(f);
    if (out_len) *out_len = rd;
    return buf;
}

static uint8_t *read_file_binary(const char *path, size_t *out_len)
{
    FILE *f = fopen(path, "rb");
    if (!f) {
        fprintf(stderr, "Error: Cannot open file: %s\n", path);
        return NULL;
    }
    fseek(f, 0, SEEK_END);
    long len = ftell(f);
    fseek(f, 0, SEEK_SET);
    uint8_t *buf = malloc((size_t)len);
    if (!buf) {
        fclose(f);
        return NULL;
    }
    size_t rd = fread(buf, 1, (size_t)len, f);
    fclose(f);
    if (out_len) *out_len = rd;
    return buf;
}

static int write_file_text(const char *path, const char *text)
{
    FILE *f = fopen(path, "w");
    if (!f) {
        fprintf(stderr, "Error: Cannot write file: %s\n", path);
        return -1;
    }
    fputs(text, f);
    fclose(f);
    return 0;
}

static int write_file_binary(const char *path, const uint8_t *data, size_t len)
{
    FILE *f = fopen(path, "wb");
    if (!f) {
        fprintf(stderr, "Error: Cannot write file: %s\n", path);
        return -1;
    }
    fwrite(data, 1, len, f);
    fclose(f);
    return 0;
}

/* ------------------------------------------------------------------ */
/*  IR / value loading and saving                                      */
/* ------------------------------------------------------------------ */

static EastValue *load_ir(const char *path, bool verbose)
{
    FileFormat fmt = detect_format(path);
    if (fmt == FMT_UNKNOWN) {
        fprintf(stderr,
                "Error: Unknown file extension for: %s\n"
                "Supported: .beast2, .beast, .east, .json\n",
                path);
        return NULL;
    }

    if (verbose) fprintf(stderr, "Loading IR from %s (format: %s)\n", path, format_name(fmt));

    if (fmt == FMT_JSON) {
        size_t len = 0;
        char *text = read_file_text(path, &len);
        if (!text) return NULL;
        EastValue *val = east_json_decode(text, east_ir_type);
        free(text);
        if (!val) fprintf(stderr, "Error: Failed to decode JSON IR from %s\n", path);
        return val;
    }
    if (fmt == FMT_BEAST2) {
        size_t len = 0;
        uint8_t *data = read_file_binary(path, &len);
        if (!data) return NULL;
        EastValue *val = east_beast2_decode_full(data, len, east_ir_type);
        free(data);
        if (!val) fprintf(stderr, "Error: Failed to decode Beast2 IR from %s\n", path);
        return val;
    }
    if (fmt == FMT_BEAST) {
        size_t len = 0;
        uint8_t *data = read_file_binary(path, &len);
        if (!data) return NULL;
        EastValue *val = east_beast_decode(data, len, east_ir_type);
        free(data);
        if (!val) fprintf(stderr, "Error: Failed to decode Beast IR from %s\n", path);
        return val;
    }
    if (fmt == FMT_EAST) {
        size_t len = 0;
        char *text = read_file_text(path, &len);
        if (!text) return NULL;
        EastValue *val = east_parse_value(text, east_ir_type);
        free(text);
        if (!val) fprintf(stderr, "Error: Failed to parse East IR from %s\n", path);
        return val;
    }
    return NULL;
}

static EastValue *load_value(const char *path, EastType *type)
{
    FileFormat fmt = detect_format(path);
    if (fmt == FMT_UNKNOWN) {
        fprintf(stderr, "Error: Unknown file extension for: %s\n", path);
        return NULL;
    }

    if (fmt == FMT_JSON) {
        size_t len = 0;
        char *text = read_file_text(path, &len);
        if (!text) return NULL;
        EastValue *val = east_json_decode(text, type);
        free(text);
        if (!val) fprintf(stderr, "Error: Failed to decode JSON from %s\n", path);
        return val;
    }
    if (fmt == FMT_BEAST2) {
        size_t len = 0;
        uint8_t *data = read_file_binary(path, &len);
        if (!data) return NULL;
        EastValue *val = east_beast2_decode_full(data, len, type);
        free(data);
        if (!val) fprintf(stderr, "Error: Failed to decode Beast2 from %s\n", path);
        return val;
    }
    if (fmt == FMT_BEAST) {
        size_t len = 0;
        uint8_t *data = read_file_binary(path, &len);
        if (!data) return NULL;
        EastValue *val = east_beast_decode(data, len, type);
        free(data);
        if (!val) fprintf(stderr, "Error: Failed to decode Beast from %s\n", path);
        return val;
    }
    if (fmt == FMT_EAST) {
        size_t len = 0;
        char *text = read_file_text(path, &len);
        if (!text) return NULL;
        EastValue *val = east_parse_value(text, type);
        free(text);
        if (!val) fprintf(stderr, "Error: Failed to parse East from %s\n", path);
        return val;
    }
    return NULL;
}

/* east-node parity: the size threshold at or above which indexed beast2
 * collection inputs open lazily. EAST_LAZY_INPUT_BYTES overrides (0
 * disables); default 64 MiB. Digits only, no overflow: strtoull silently
 * wraps negatives ("-5" parses as a huge value) and saturates past
 * ULLONG_MAX — both must fall back to the default, like the sibling
 * runners, rather than enabling a bogus threshold. */
static size_t lazy_input_threshold(void)
{
    const char *env = getenv("EAST_LAZY_INPUT_BYTES");
    if (env && *env) {
        bool digits = true;
        for (const char *p = env; *p; p++) {
            if (*p < '0' || *p > '9') {
                digits = false;
                break;
            }
        }
        if (digits) {
            errno = 0;
            char *end = NULL;
            unsigned long long v = strtoull(env, &end, 10);
            if (errno == 0 && end && *end == '\0' && v <= (unsigned long long)SIZE_MAX)
                return (size_t)v;
        }
    }
    return (size_t)64 * 1024 * 1024;
}

/* Loads input value `path`, always FROZEN — task inputs are immutable
 * (mutating builtins raise the uniform copy-first error, and frozen
 * collections compare by value). When `want_lazy`, an indexed beast2
 * collection blob opens as a lazy paged value over a mapping of the file
 * (map_input_file: the input's residency is the page cache and the heap holds
 * one decoded segment at a time — issue #505; the value releases the mapping
 * through input_release_mapping; *mapped_out reports it); anything
 * not pageable (other formats, index-less or aliased blobs, Ref- or
 * function-bearing element shapes) silently decodes whole, exactly like
 * east-node's runner. Non-beast2 formats have no frozen decoder, so the
 * decoded value round-trips through a canonical beast2 encode + frozen
 * decode, like east-py's runner. */
static EastValue *load_input_value(const char *path, EastType *type, bool want_lazy,
                                   bool *mapped_out)
{
    if (mapped_out) *mapped_out = false;
    if (!want_lazy || detect_format(path) != FMT_BEAST2 ||
        (type->kind != EAST_TYPE_ARRAY && type->kind != EAST_TYPE_SET &&
         type->kind != EAST_TYPE_DICT)) {
        if (detect_format(path) == FMT_BEAST2) {
            size_t len = 0;
            uint8_t *data = read_file_binary(path, &len);
            if (!data) return NULL;
            EastValue *val = east_beast2_decode_full_frozen(data, len, type);
            free(data);
            if (!val) fprintf(stderr, "Error: Failed to decode Beast2 from %s\n", path);
            return val;
        }
        EastValue *plain = load_value(path, type);
        if (!plain) return NULL;
        ByteBuffer *buf = east_beast2_encode_full(plain, type);
        east_value_release(plain);
        if (!buf) {
            fprintf(stderr, "Error: Failed to freeze input %s\n", path);
            return NULL;
        }
        EastValue *val = east_beast2_decode_full_frozen(buf->data, buf->len, type);
        byte_buffer_free(buf);
        if (!val) fprintf(stderr, "Error: Failed to freeze input %s\n", path);
        return val;
    }
    size_t len = 0;
    void *map_ctx = NULL;
    uint8_t *data = map_input_file(path, &len, &map_ctx);
    if (!data) return load_input_value(path, type, false, mapped_out);
    EastValue *paged =
        east_beast2_open_paged_external(data, len, type, true, input_release_mapping, map_ctx);
    if (paged) {
        if (mapped_out) *mapped_out = true;
        return paged; /* the value releases the mapping */
    }
    free(east_builtin_get_error());
    /* Not pageable: decode whole from the mapping, then drop it at once. */
    EastValue *val = east_beast2_decode_full_frozen(data, len, type);
    input_release_mapping(map_ctx, data, len);
    if (!val) fprintf(stderr, "Error: Failed to decode Beast2 from %s\n", path);
    return val;
}

static int save_value(const char *path, EastValue *value, EastType *type)
{
    FileFormat fmt = detect_format(path);
    if (fmt == FMT_UNKNOWN) {
        fprintf(stderr, "Error: Unknown file extension for output: %s\n", path);
        return -1;
    }

    if (fmt == FMT_JSON) {
        char *text = east_json_encode(value, type);
        if (!text) {
            fprintf(stderr, "Error: JSON encode failed\n");
            return -1;
        }
        int rc = write_file_text(path, text);
        free(text);
        return rc;
    }
    if (fmt == FMT_BEAST2) {
        /* Collection-rooted outputs are ALWAYS written segmented + indexed,
         * cut by the content-defined rule, so e3's paged dataset reads can
         * seek — one encoding per logical value, at every size. */
        bool collection = type->kind == EAST_TYPE_ARRAY || type->kind == EAST_TYPE_SET ||
                          type->kind == EAST_TYPE_DICT;
        ByteBuffer *buf = collection
                              ? east_beast2_encode_paged(value, type, EAST_BEAST2_CODEC_DEFLATE)
                              : east_beast2_encode_full(value, type);
        if (!buf) {
            fprintf(stderr, "Error: Beast2 encode failed\n");
            return -1;
        }
        int rc = write_file_binary(path, buf->data, buf->len);
        byte_buffer_free(buf);
        return rc;
    }
    if (fmt == FMT_BEAST) {
        ByteBuffer *buf = east_beast_encode(value, type);
        if (!buf) {
            fprintf(stderr, "Error: Beast encode failed\n");
            return -1;
        }
        int rc = write_file_binary(path, buf->data, buf->len);
        byte_buffer_free(buf);
        return rc;
    }
    if (fmt == FMT_EAST) {
        char *text = east_print_value(value, type);
        if (!text) {
            fprintf(stderr, "Error: East print failed\n");
            return -1;
        }
        int rc = write_file_text(path, text);
        free(text);
        return rc;
    }
    return -1;
}

/* ------------------------------------------------------------------ */
/*  Package resolution                                                 */
/* ------------------------------------------------------------------ */

static bool is_std_package(const char *name)
{
    return strcmp(name, "east-c-std") == 0 || strcmp(name, "std") == 0;
}

/* Registers the -p packages' platform functions. Returns false with a
 * message on stderr for a package this runner does not know. */
static bool register_platform_packages(PlatformRegistry *platform, const char **packages,
                                       int num_packages)
{
    for (int i = 0; i < num_packages; i++) {
        if (is_std_package(packages[i])) {
            east_std_register_all(platform);
        } else {
            fprintf(stderr,
                    "Error: Unknown platform package: %s\n"
                    "Available: east-c-std (or shorthand: std)\n",
                    packages[i]);
            return false;
        }
    }
    return true;
}

/* ------------------------------------------------------------------ */
/*  Streaming emit sink (--emit)                                       */
/* ------------------------------------------------------------------ */

/* The sink itself lives in the core library (east/emit_sink.h), shared with
 * east-py; the CLI parses the flags, builds the configuration from the emit
 * parameter's type, and prints the -v epilogue. */
typedef enum {
    EMIT_NONE = -1,
    EMIT_ARRAY = EAST_EMIT_ARRAY,
    EMIT_SET = EAST_EMIT_SET,
    EMIT_DICT = EAST_EMIT_DICT,
} EmitKind;

/* The kind as the flag spells it — the sibling runners name it in their
 * arity message, so this one does too. */
static const char *emit_kind_name(EmitKind kind)
{
    return kind == EMIT_DICT ? "dict" : kind == EMIT_SET ? "set" : "array";
}

static EastValue *load_ir_with_map(const char *path, EastSourceMap **map_out);

/* The compiled --merge function and the IR it was compiled from, freed after
 * the sink that borrows it. */
typedef struct {
    IRNode *ir;
    EastCompiledFn *fn;
} EmitMerge;

static void emit_merge_free(EmitMerge *merge)
{
    if (merge->fn) east_compiled_fn_free(merge->fn);
    if (merge->ir) ir_node_release(merge->ir);
    merge->fn = NULL;
    merge->ir = NULL;
}

/* Compiles a loaded --merge function with the run's platforms. Takes over
 * `ir` and `map` on success (the map resolves the function's own loc_ids:
 * current while it compiles, owned by the compiled function after) and
 * releases them on failure, with a message on stderr. */
static bool merge_fn_compile(IRNode *ir, EastSourceMap *map, PlatformRegistry *platform,
                             BuiltinRegistry *builtins, EmitMerge *out)
{
    const EastSourceMap *saved_map = east_get_source_map();
    if (map) east_set_source_map(map);
    char *err = NULL;
    EastCompiledFn *fn = east_compile_fn(ir, platform, builtins, &err);
    east_set_source_map(saved_map);
    if (!fn) {
        fprintf(stderr, "Error: --merge: %s\n", err ? err : "failed to compile the function");
        free(err);
        ir_node_release(ir);
        east_source_map_release(map);
        return false;
    }
    if (map) fn->source_map = map;
    out->ir = ir;
    out->fn = fn;
    return true;
}

/* Loads a --merge IR file (any format the IR positional accepts) as a
 * function node. NULL with a message on stderr; *map_out is the file's
 * source map (or NULL), the caller's to release or hand on. */
static IRNode *merge_fn_load(const char *path, EastSourceMap **map_out)
{
    *map_out = NULL;
    EastValue *ir_val = load_ir_with_map(path, map_out);
    if (!ir_val) {
        east_source_map_release(*map_out);
        *map_out = NULL;
        return NULL;
    }
    IRNode *ir = east_ir_from_value(ir_val);
    east_value_release(ir_val);
    if (!ir || ir->kind != IR_FUNCTION) {
        fprintf(stderr, "Error: --merge: %s does not hold a function\n", path);
        if (ir) ir_node_release(ir);
        east_source_map_release(*map_out);
        *map_out = NULL;
        return NULL;
    }
    return ir;
}

/* Loads the --merge IR for `run --emit dict`, checks it is a function
 * (K, V, V) -> V over the emit parameter's key and value types, and compiles
 * it with the run's platforms. Returns false with a message on stderr. */
static bool emit_merge_load(const char *path, EastType *key_type, EastType *value_type,
                            PlatformRegistry *platform, BuiltinRegistry *builtins, EmitMerge *out)
{
    out->ir = NULL;
    out->fn = NULL;
    EastSourceMap *map = NULL;
    IRNode *ir = merge_fn_load(path, &map);
    if (!ir) return false;
    EastType *t = ir->type;
    bool shape = t && t->kind == EAST_TYPE_FUNCTION && t->data.function.num_inputs == 3 &&
                 east_type_equal(t->data.function.inputs[0], key_type) &&
                 east_type_equal(t->data.function.inputs[1], value_type) &&
                 east_type_equal(t->data.function.inputs[2], value_type) &&
                 east_type_equal(t->data.function.output, value_type);
    if (!shape) {
        char *ks = format_type(key_type);
        char *vs = format_type(value_type);
        char *ts = t ? format_type(t) : NULL;
        fprintf(stderr,
                "Error: --merge: expected a function (K, V, V) -> V matching the emit parameter "
                "(K = %s, V = %s), got %s\n",
                ks ? ks : "?", vs ? vs : "?", ts ? ts : "?");
        free(ks);
        free(vs);
        free(ts);
        ir_node_release(ir);
        east_source_map_release(map);
        return false;
    }
    return merge_fn_compile(ir, map, platform, builtins, out);
}

/* Builds the sink + its output collection type from the emit parameter's
 * function type. Returns NULL with a message on stderr when the shape or
 * output destination is unusable; *out_type_out receives the output type and
 * *merge_out the --merge function, both of which the caller frees after the
 * sink. */
static EastEmitSink *emit_sink_open(EmitKind kind, EastType *emit_param_type,
                                    const char *output_file, const char *merge_path,
                                    bool union_mode, PlatformRegistry *platform,
                                    BuiltinRegistry *builtins, EastType **out_type_out,
                                    EmitMerge *merge_out)
{
    *out_type_out = NULL;
    merge_out->ir = NULL;
    merge_out->fn = NULL;
    if (!output_file || detect_format(output_file) != FMT_BEAST2) {
        fprintf(stderr, "Error: --emit requires a .beast2 output file (-o)\n");
        return NULL;
    }
    if (!emit_param_type || emit_param_type->kind != EAST_TYPE_FUNCTION) {
        fprintf(stderr, "Error: --emit requires the function's trailing parameter to be the emit "
                        "capability (a function type)\n");
        return NULL;
    }
    size_t arity = emit_param_type->data.function.num_inputs;
    size_t expected = kind == EMIT_DICT ? 2 : 1;
    if (arity != expected) {
        fprintf(stderr,
                "Error: --emit %s expects an emit parameter taking %zu argument(s), got %zu\n",
                emit_kind_name(kind), expected, arity);
        return NULL;
    }
    EastType **ins = emit_param_type->data.function.inputs;
    EastType *out_type = kind == EMIT_DICT  ? east_dict_type(ins[0], ins[1])
                         : kind == EMIT_SET ? east_set_type(ins[0])
                                            : east_array_type(ins[0]);
    if (!out_type) return NULL;

    if (merge_path && !emit_merge_load(merge_path, ins[0], ins[1], platform, builtins, merge_out)) {
        east_type_release(out_type);
        return NULL;
    }

    EastEmitSinkConfig cfg = {
        .kind = (EastEmitKind)kind,
        .out_type = out_type,
        .output_path = output_file,
        .merge_fn = merge_out->fn,
        .union_mode = union_mode,
    };
    EastEmitSink *sink = east_emit_sink_new(&cfg);
    if (!sink) {
        char *err = east_builtin_get_error();
        if (err) fprintf(stderr, "Error: %s\n", err);
        free(err);
        emit_merge_free(merge_out);
        east_type_release(out_type);
        return NULL;
    }
    *out_type_out = out_type;
    return sink;
}

/* Frees the sink (NULL-safe), then the --merge function and the output type
 * emit_sink_open built for it. */
static void emit_sink_close(EastEmitSink *sink, EastType *out_type, EmitMerge *merge)
{
    east_emit_sink_free(sink);
    emit_merge_free(merge);
    if (out_type) east_type_release(out_type);
}

/* ------------------------------------------------------------------ */
/*  Commands                                                           */
/* ------------------------------------------------------------------ */

/* "file:line:column" for a loc_id, or "-" when the map cannot place it. */
static const char *profile_site(const EastSourceMap *sm, int64_t loc_id, char *buf, size_t cap)
{
    size_t count = 0;
    const EastLocation *locs = loc_id > 0 ? east_source_map_resolve(sm, loc_id, &count) : NULL;
    if (locs && count > 0 && locs[0].filename)
        snprintf(buf, cap, "%s:%lld:%lld", locs[0].filename, (long long)locs[0].line,
                 (long long)locs[0].column);
    else
        snprintf(buf, cap, "-");
    return buf;
}

/* The --profile epilogue: every East function called, by self time. A
 * function is named after the Let it was bound to when the IR has one, and
 * placed by its Function node's site plus, when it differs, the site of the
 * first call that reached it — the builder stamps a helper it inlines at a
 * call site with the caller's location, so the call site is what tells the
 * helpers apart. */
static void print_profile(const EastSourceMap *sm)
{
    size_t n = 0;
    EastProfileEntry *entries = east_profile_report(&n);
    fprintf(stderr, "\nProfile (self time, %s%zu function%s):\n", n > 20 ? "top 20 of " : "", n,
            n == 1 ? "" : "s");
    size_t shown = n > 20 ? 20 : n;
    for (size_t i = 0; i < shown; i++) {
        const EastProfileEntry *e = &entries[i];
        char defined[512], called[512], where[1100];
        profile_site(sm, e->loc_id, defined, sizeof(defined));
        profile_site(sm, e->call_loc_id, called, sizeof(called));
        if (e->call_loc_id > 0 && strcmp(defined, called) != 0)
            snprintf(where, sizeof(where), "%s  called at %s", defined, called);
        else
            snprintf(where, sizeof(where), "%s", defined);
        fprintf(stderr, "  %-16s %10llu calls %9.3f s self %9.3f s total  %s\n",
                e->name ? e->name : "<anon>", (unsigned long long)e->calls,
                (double)e->self_ns / 1e9, (double)e->total_ns / 1e9, where);
    }
    free(entries);
}

static int cmd_run(const char *ir_path, const char **packages, int num_packages,
                   const char **input_files, int num_inputs, const char *output_file, bool verbose,
                   const char *snapshot_out_path, EmitKind emit_kind, const char *merge_path,
                   bool union_mode, const int *stream_inputs, int num_streams, bool profile)
{
    /* Init type system */
    east_type_of_type_init();

    /* Write snapshot BEFORE execution so crashes still leave the bundle. */
    if (snapshot_out_path) {
        char cli_ver[128];
        snprintf(cli_ver, sizeof(cli_ver), "east-c-cli %s", EAST_CLI_VERSION);
        if (snapshot_write(snapshot_out_path, ir_path, input_files, (size_t)num_inputs, packages,
                           (size_t)num_packages, cli_ver) != 0) {
            fprintf(stderr, "Error: failed to write snapshot to %s\n", snapshot_out_path);
            return 1;
        }
        if (verbose) fprintf(stderr, "Snapshot: %s\n", snapshot_out_path);
    }

    /* Create registries */
    BuiltinRegistry *builtins = builtin_registry_new();
    east_register_all_builtins(builtins);

    PlatformRegistry *platform = platform_registry_new();

    /* Register platform packages */
    if (!register_platform_packages(platform, packages, num_packages)) {
        platform_registry_free(platform);
        builtin_registry_free(builtins);
        return 1;
    }

    /* Verbose header: Running + Platform sections */
    if (verbose) {
        char sz[32];
        format_file_size(ir_path, sz, sizeof(sz));
        fprintf(stderr, "Running: %s  (%s)\n", ir_path, sz);
        if (num_packages > 0) {
            size_t total_fns =
                hashmap_count(platform->functions) + hashmap_count(platform->generic_functions);
            fprintf(stderr, "Platform: %d package(s), %zu function(s)\n", num_packages, total_fns);
            for (int i = 0; i < num_packages; i++) {
                fprintf(stderr, "  - %s\n", packages[i]);
            }
        }
    }

    struct timespec t0, t1, t2, t3, t4, t5;

    /* Load IR */
    struct timespec t_decode, t_convert;
    clock_gettime(CLOCK_MONOTONIC, &t0);

    IRNode *ir = NULL;
    EastValue *ir_val = NULL;
    EastSourceMap *decoded_source_map = NULL;
    FileFormat ir_fmt = detect_format(ir_path);

    if (ir_fmt == FMT_BEAST2) {
        /* Beast2: use combined decode+convert for O(1) type resolution */
        size_t flen = 0;
        uint8_t *fdata = read_file_binary(ir_path, &flen);
        if (!fdata) {
            platform_registry_free(platform);
            builtin_registry_free(builtins);
            return 1;
        }
        clock_gettime(CLOCK_MONOTONIC, &t_decode);
        ir = east_beast2_decode_ir(fdata, flen, &ir_val, &decoded_source_map);
        free(fdata);
        clock_gettime(CLOCK_MONOTONIC, &t_convert);
    } else if (ir_fmt == FMT_JSON) {
        /* JSON: decode wrapper {ir, source_map} with source map extraction */
        size_t flen = 0;
        char *text = read_file_text(ir_path, &flen);
        if (!text) {
            platform_registry_free(platform);
            builtin_registry_free(builtins);
            return 1;
        }
        clock_gettime(CLOCK_MONOTONIC, &t_decode);
        ir = east_json_decode_ir(text, &ir_val, &decoded_source_map);
        free(text);
        clock_gettime(CLOCK_MONOTONIC, &t_convert);
    } else {
        /* Beast v1/East text: decode IR value, then convert */
        ir_val = load_ir(ir_path, verbose);
        if (!ir_val) {
            platform_registry_free(platform);
            builtin_registry_free(builtins);
            return 1;
        }
        clock_gettime(CLOCK_MONOTONIC, &t_decode);
        ir = east_ir_from_value(ir_val);
        clock_gettime(CLOCK_MONOTONIC, &t_convert);
    }

    /* ir_val is retained by the decode functions;
     * the IRNode's source_ir holds its own ref if needed for re-serialization. */
    if (ir_val) east_value_release(ir_val);

    if (!ir) {
        fprintf(stderr, "Error: Failed to convert IR value to IR node\n");
        platform_registry_free(platform);
        builtin_registry_free(builtins);
        return 1;
    }

    /* Validate IR is a function */
    if (ir->kind != IR_FUNCTION && ir->kind != IR_ASYNC_FUNCTION) {
        fprintf(stderr,
                "Error: IR must be a Function or AsyncFunction node, got kind %d\n"
                "The IR file should contain compiled function IR.\n",
                ir->kind);
        ir_node_release(ir);
        east_source_map_release(decoded_source_map);
        platform_registry_free(platform);
        builtin_registry_free(builtins);
        return 1;
    }

    /* Extract function signature */
    EastType *fn_type = ir->type;
    if (!fn_type ||
        (fn_type->kind != EAST_TYPE_FUNCTION && fn_type->kind != EAST_TYPE_ASYNC_FUNCTION)) {
        fprintf(stderr, "Error: IR function node has invalid type\n");
        ir_node_release(ir);
        east_source_map_release(decoded_source_map);
        platform_registry_free(platform);
        builtin_registry_free(builtins);
        return 1;
    }

    size_t num_params = fn_type->data.function.num_inputs;
    EastType **param_types = fn_type->data.function.inputs;
    EastType *return_type = fn_type->data.function.output;

    /* With --emit the body takes one trailing runner-provided parameter (the
     * emit capability) beyond the input files; the output file is written
     * incrementally by the sink instead of from the return value. */
    size_t file_params = emit_kind != EMIT_NONE && num_params > 0 ? num_params - 1 : num_params;
    for (int s = 0; s < num_streams; s++) {
        if ((size_t)stream_inputs[s] >= file_params) {
            fprintf(stderr, "Error: --stream index %d out of range (%zu inputs)\n",
                    stream_inputs[s], file_params);
            ir_node_release(ir);
            east_source_map_release(decoded_source_map);
            platform_registry_free(platform);
            builtin_registry_free(builtins);
            return 1;
        }
    }

    if (verbose) {
        fprintf(stderr, "Function: %zu inputs, %s\n", num_params,
                ir->kind == IR_ASYNC_FUNCTION ? "async" : "sync");
        for (size_t i = 0; i < num_params; i++) {
            char *ts = format_type(param_types[i]);
            if (i < (size_t)num_inputs && input_files[i]) {
                char sz[32];
                format_file_size(input_files[i], sz, sizeof(sz));
                fprintf(stderr, "  input %zu: %s  (%s)\n", i, input_files[i], sz);
                fprintf(stderr, "    %s\n", ts ? ts : "?");
            } else {
                fprintf(stderr, "  input %zu:\n    %s\n", i, ts ? ts : "?");
            }
            free(ts);
        }
        char *rs = format_type(return_type);
        fprintf(stderr, "  return:\n    %s\n", rs ? rs : "?");
        free(rs);
    }

    /* Validate input count */
    if ((size_t)num_inputs != file_params) {
        char sig_buf[1024];
        int off = snprintf(sig_buf, sizeof(sig_buf), "(");
        for (size_t i = 0; i < num_params; i++) {
            if (i > 0) off += snprintf(sig_buf + off, sizeof(sig_buf) - (size_t)off, ", ");
            char *ts = format_type(param_types[i]);
            off += snprintf(sig_buf + off, sizeof(sig_buf) - (size_t)off, "%s", ts ? ts : "?");
            free(ts);
        }
        off += snprintf(sig_buf + off, sizeof(sig_buf) - (size_t)off, ") -> ");
        char *rs = format_type(return_type);
        snprintf(sig_buf + off, sizeof(sig_buf) - (size_t)off, "%s", rs ? rs : "?");
        free(rs);

        fprintf(stderr, "Error: Function expects %zu inputs, got %d\nSignature: %s\n", file_params,
                num_inputs, sig_buf);
        ir_node_release(ir);
        east_source_map_release(decoded_source_map);
        platform_registry_free(platform);
        builtin_registry_free(builtins);
        return 1;
    }

    /* The emit sink writes the output; built before the inputs so a bad
     * emit shape fails fast. */
    EastEmitSink *emit_sink = NULL;
    EastType *emit_out_type = NULL;
    EmitMerge emit_merge = {NULL, NULL};
    if (emit_kind != EMIT_NONE) {
        emit_sink = emit_sink_open(emit_kind, num_params > 0 ? param_types[num_params - 1] : NULL,
                                   output_file, merge_path, union_mode, platform, builtins,
                                   &emit_out_type, &emit_merge);
        if (!emit_sink) {
            ir_node_release(ir);
            east_source_map_release(decoded_source_map);
            platform_registry_free(platform);
            builtin_registry_free(builtins);
            return 1;
        }
    }

    /* Load inputs with type-directed parsing (paths already listed in the
     * Function section above). The emit capability, when present, is the
     * trailing argument. */
    size_t num_args = (size_t)num_inputs + (emit_sink ? 1u : 0u);
    size_t threshold = lazy_input_threshold();
    EastValue **args = NULL;
    bool *lazy_inputs = num_inputs > 0 ? calloc((size_t)num_inputs, sizeof(bool)) : NULL;
    if (num_args > 0) {
        args = calloc(num_args, sizeof(EastValue *));
        for (int i = 0; i < num_inputs; i++) {
            /* Streamed inputs always open lazily; other collection inputs
             * open lazily at or above the size threshold. */
            bool want_lazy = false;
            for (int s = 0; s < num_streams; s++)
                want_lazy = want_lazy || stream_inputs[s] == i;
            if (!want_lazy && threshold > 0) {
                struct stat st;
                want_lazy = stat(input_files[i], &st) == 0 && (size_t)st.st_size >= threshold;
            }
            bool mapped = false;
            args[i] = load_input_value(input_files[i], param_types[i], want_lazy, &mapped);
            if (lazy_inputs) lazy_inputs[i] = mapped;
            if (verbose && mapped) {
                fprintf(stderr, "  input %d: opened lazily — mapped from the file\n", i);
            }
            if (!args[i]) {
                char *ts = format_type(param_types[i]);
                fprintf(stderr, "Error: Failed to parse input %d (%s) as %s\n", i, input_files[i],
                        ts ? ts : "?");
                free(ts);
                for (int j = 0; j < i; j++)
                    east_value_release(args[j]);
                free(args);
                free(lazy_inputs);
                emit_sink_close(emit_sink, emit_out_type, &emit_merge);
                ir_node_release(ir);
                east_source_map_release(decoded_source_map);
                platform_registry_free(platform);
                builtin_registry_free(builtins);
                return 1;
            }
        }
        if (emit_sink) {
            args[num_inputs] = east_emit_sink_function(emit_sink, param_types[num_params - 1]);
            if (!args[num_inputs]) {
                fprintf(stderr, "Error: failed to construct the emit capability\n");
                for (int j = 0; j < num_inputs; j++)
                    east_value_release(args[j]);
                free(args);
                free(lazy_inputs);
                emit_sink_close(emit_sink, emit_out_type, &emit_merge);
                ir_node_release(ir);
                east_source_map_release(decoded_source_map);
                platform_registry_free(platform);
                builtin_registry_free(builtins);
                return 1;
            }
        }
    }

    /* Compile */
    clock_gettime(CLOCK_MONOTONIC, &t1);

    /* Install the decoded map before compiling: a compile error names the
     * offending node by source location, which only resolves while its map is
     * the current one. */
    if (decoded_source_map) east_set_source_map(decoded_source_map);

    char *compile_err = NULL;
    EastCompiledFn *fn = east_compile_fn(ir, platform, builtins, &compile_err);
    if (!fn) {
        fprintf(stderr, "Error: %s\n", compile_err ? compile_err : "Failed to compile IR");
        free(compile_err);
        for (size_t i = 0; i < num_args; i++)
            east_value_release(args[i]);
        free(args);
        free(lazy_inputs);
        emit_sink_close(emit_sink, emit_out_type, &emit_merge);
        /* The map never reached a compiled function: stop it being the
         * current one, then drop it. */
        east_set_source_map(NULL);
        east_source_map_release(decoded_source_map);
        ir_node_release(ir);
        platform_registry_free(platform);
        builtin_registry_free(builtins);
        return 1;
    }

    /* Hand the map to the compiled function, which owns it from here (it is
     * already installed as the current map, from before the compile). */
    if (decoded_source_map) {
        fn->source_map = decoded_source_map;
    }

    /* Execute */
    clock_gettime(CLOCK_MONOTONIC, &t2);

    east_profile_enable(profile);
    EvalResult result = east_call(fn, args, num_args);
    east_profile_enable(false);
    clock_gettime(CLOCK_MONOTONIC, &t3);

    int exit_code = 0;

    if (result.status == EVAL_ERROR) {
        fprintf(stderr, "Error: %s\n",
                result.error_message ? result.error_message : "unknown error");
        for (size_t i = 0; i < result.num_locations; i++) {
            fprintf(stderr, "  at %s:%ld:%ld\n",
                    result.locations[i].filename ? result.locations[i].filename : "?",
                    (long)result.locations[i].line, (long)result.locations[i].column);
        }
        exit_code = 1;
    } else if (emit_sink) {
        /* The sink wrote the output incrementally; the (Null) return value
         * is unused. Finish appends the terminator + index. */
        if (!east_emit_sink_finish(emit_sink)) {
            char *err = east_builtin_get_error();
            if (err) fprintf(stderr, "Error: %s\n", err);
            free(err);
            fprintf(stderr, "Error: failed to finalize the emitted output\n");
            exit_code = 1;
        } else if (verbose) {
            char *ts = format_type(emit_out_type);
            char sz[32];
            format_file_size(output_file, sz, sizeof(sz));
            fprintf(stderr, "Output: %s  (%s)\n  %s\n", output_file, sz, ts ? ts : "?");
            free(ts);
        }
    } else {
        /* Save or print result. A paged input returned as the output
         * hydrates here — the encoders and printer walk eager values. */
        EastValue *out_val = east_paged_hydrated(result.value);
        if (!out_val) {
            char *err = east_builtin_get_error();
            fprintf(stderr, "Error: %s\n", err ? err : "failed to hydrate the paged output");
            free(err);
            exit_code = 1;
        } else if (output_file) {
            if (save_value(output_file, out_val, return_type) != 0) {
                exit_code = 1;
            } else if (verbose) {
                char *ts = format_type(return_type);
                char sz[32];
                format_file_size(output_file, sz, sizeof(sz));
                fprintf(stderr, "Output: %s  (%s)\n  %s\n", output_file, sz, ts ? ts : "?");
                free(ts);
            }
        } else {
            /* Print as .east format to stdout */
            char *text = east_print_value(out_val, return_type);
            if (text) {
                printf("%s\n", text);
                free(text);
            }
        }
    }

    clock_gettime(CLOCK_MONOTONIC, &t4);

    /* What each lazy input's reads came to — the account residency cannot
     * give on a mapping, where the kernel decides how much of a touched
     * file is resident. */
    if (verbose && lazy_inputs) {
        for (int i = 0; i < num_inputs; i++) {
            size_t segments = 0, decoded = 0, fences = 0;
            bool hydrated = false;
            if (!lazy_inputs[i] ||
                !east_paged_stats(args[i], &segments, &decoded, &fences, &hydrated))
                continue;
            if (hydrated) {
                fprintf(stderr, "  input %d: decoded whole (an operation the pager cannot serve)\n",
                        i);
            } else {
                fprintf(stderr, "  input %d: %zu of %zu segments decoded, %zu fences probed\n", i,
                        decoded, segments, fences);
            }
        }
    }

    /* The profile resolves its sites through the map the compiled function
     * owns, so it prints before the cleanup below. */
    if (profile) {
        print_profile(fn->source_map);
        east_profile_reset();
    }

    /* Cleanup */
    if (result.value) east_value_release(result.value);
    eval_result_free(&result);
    east_compiled_fn_free(fn);
    for (size_t i = 0; i < num_args; i++)
        east_value_release(args[i]);
    free(args);
    free(lazy_inputs);
    emit_sink_close(emit_sink, emit_out_type, &emit_merge);
    ir_node_release(ir);
    platform_registry_free(platform);
    builtin_registry_free(builtins);

    clock_gettime(CLOCK_MONOTONIC, &t5);

    if (verbose) {
        long peak_kb = east_peak_rss_kb();

        fprintf(stderr, "\nTiming:\n");
        fprintf(stderr, "  Load:     %8.1f ms\n", elapsed_ms(&t0, &t1));
        fprintf(stderr, "  Compile:  %8.1f ms\n", elapsed_ms(&t1, &t2));
        fprintf(stderr, "  Execute:  %8.1f ms\n", elapsed_ms(&t2, &t3));
        fprintf(stderr, "  Output:   %8.1f ms\n", elapsed_ms(&t3, &t4));
        fprintf(stderr, "  Total:    %8.1f ms\n", elapsed_ms(&t0, &t5));
        fprintf(stderr, "\nMemory:\n");
        if (peak_kb >= 1024)
            fprintf(stderr, "  Peak RSS: %8.1f MB\n", (double)peak_kb / 1024.0);
        else
            fprintf(stderr, "  Peak RSS: %8ld KB\n", peak_kb);
    }

    return exit_code;
}

/* ------------------------------------------------------------------ */
/*  Merge: k sorted Set/Dict blobs of one type into one (issue #770)   */
/* ------------------------------------------------------------------ */

static int cmd_merge(const char **packages, int num_packages, const char **input_files,
                     int num_inputs, const char *output_file, bool verbose, const char *merge_path,
                     bool union_mode, const char *range_path)
{
    east_type_of_type_init();
    BuiltinRegistry *builtins = builtin_registry_new();
    east_register_all_builtins(builtins);
    PlatformRegistry *platform = platform_registry_new();
    if (!register_platform_packages(platform, packages, num_packages)) {
        platform_registry_free(platform);
        builtin_registry_free(builtins);
        return 1;
    }

    /* The fold compiles with the run's platforms, exactly like a program;
     * the library checks its signature against the inputs' key and value
     * types once it has read them. */
    EmitMerge merge = {NULL, NULL};
    if (merge_path) {
        EastSourceMap *map = NULL;
        IRNode *ir = merge_fn_load(merge_path, &map);
        if (!ir || !merge_fn_compile(ir, map, platform, builtins, &merge)) {
            platform_registry_free(platform);
            builtin_registry_free(builtins);
            return 1;
        }
    }

    struct timespec t0, t1;
    clock_gettime(CLOCK_MONOTONIC, &t0);
    EastMergeConfig cfg = {
        .input_paths = input_files,
        .num_inputs = (size_t)num_inputs,
        .output_path = output_file,
        .merge_fn = merge.fn,
        .union_mode = union_mode,
        .range_path = range_path,
    };
    EastMergeStats stats;
    bool ok = east_merge_blobs(&cfg, &stats);
    clock_gettime(CLOCK_MONOTONIC, &t1);
    if (!ok) {
        char *err = east_builtin_get_error();
        fprintf(stderr, "Error: %s\n", err ? err : "merge failed");
        free(err);
    } else if (verbose) {
        fprintf(stderr, "merge: %zu input(s), %zu entries, %zu fold(s)\n", stats.inputs,
                stats.entries, stats.folds);
        char sz[32];
        format_file_size(output_file, sz, sizeof(sz));
        fprintf(stderr, "Output: %s  (%s)\n", output_file, sz);
        fprintf(stderr, "\nTiming:\n  Total:    %8.1f ms\n", elapsed_ms(&t0, &t1));
    }
    emit_merge_free(&merge);
    platform_registry_free(platform);
    builtin_registry_free(builtins);
    return ok ? 0 : 1;
}

/* ------------------------------------------------------------------ */
/*  Convert: decode a value file and re-encode in another format       */
/* ------------------------------------------------------------------ */

static int cmd_convert(const char *in_path, const char *out_path, const char *type_text,
                       bool verbose)
{
    east_type_of_type_init();

    FileFormat in_fmt = detect_format(in_path);
    if (in_fmt == FMT_UNKNOWN) {
        fprintf(stderr,
                "Error: Unknown input file extension: %s\n"
                "Supported: .beast2, .beast, .east, .json\n",
                in_path);
        return 1;
    }

    /* Determine the value type: either from user's --type (east-text form),
     * or extracted from beast2-full's embedded type table. Other formats
     * (.beast v1, .east, .json) don't self-describe, so --type is required. */
    EastType *type = NULL;
    EastValue *value = NULL;

    if (type_text) {
        type = east_parse_type(type_text);
        if (!type) {
            fprintf(stderr, "Error: Failed to parse --type: %s\n", type_text);
            return 1;
        }
        value = load_value(in_path, type);
    } else if (in_fmt == FMT_BEAST2) {
        size_t len = 0;
        uint8_t *data = read_file_binary(in_path, &len);
        if (!data) return 1;
        /* Auto-decode: reads type from embedded header. */
        value = east_beast2_decode_auto(data, len);
        if (!value) {
            fprintf(stderr, "Error: Failed to auto-decode beast2: %s\n", in_path);
            free(data);
            return 1;
        }
        type = east_beast2_extract_type(data, len);
        free(data);
    } else {
        fprintf(stderr, "Error: --type is required for .%s input (only .beast2 self-describes)\n",
                format_name(in_fmt));
        return 1;
    }

    if (!value || !type) {
        fprintf(stderr, "Error: Failed to load value\n");
        if (type) east_type_release(type);
        if (value) east_value_release(value);
        return 1;
    }

    int rc;
    if (out_path) {
        rc = save_value(out_path, value, type);
        if (verbose && rc == 0) {
            char sz[32];
            format_file_size(out_path, sz, sizeof(sz));
            fprintf(stderr, "Wrote %s  (%s)\n", out_path, sz);
        }
    } else {
        /* Default: print east-text to stdout. */
        char *text = east_print_value(value, type);
        if (!text) {
            fprintf(stderr, "Error: east-text print failed\n");
            rc = 1;
        } else {
            fputs(text, stdout);
            fputc('\n', stdout);
            free(text);
            rc = 0;
        }
    }

    east_value_release(value);
    east_type_release(type);
    return rc;
}

/* ------------------------------------------------------------------ */
/*  ir: the IR toolbox (normalize / diff / convert), issue #627           */
/* ------------------------------------------------------------------ */

/* Load an IR file with its source map: the JSON wrapper {ir, source_map}
 * (or raw IR JSON), or a beast2 blob whose header carries the map. */
static EastValue *load_ir_with_map(const char *path, EastSourceMap **map_out)
{
    *map_out = NULL;
    FileFormat fmt = detect_format(path);
    if (fmt == FMT_JSON) {
        size_t len = 0;
        char *text = read_file_text(path, &len);
        if (!text) return NULL;
        EastValue *ir_val = NULL;
        IRNode *node = east_json_decode_ir(text, &ir_val, map_out);
        free(text);
        if (node) ir_node_release(node);
        if (!ir_val) fprintf(stderr, "Error: Failed to decode JSON IR from %s\n", path);
        return ir_val;
    }
    if (fmt == FMT_BEAST2) {
        size_t len = 0;
        uint8_t *data = read_file_binary(path, &len);
        if (!data) return NULL;
        EastValue *ir_val = NULL;
        IRNode *node = east_beast2_decode_ir(data, len, &ir_val, map_out);
        free(data);
        if (node) ir_node_release(node);
        if (!ir_val) fprintf(stderr, "Error: Failed to decode Beast2 IR from %s\n", path);
        return ir_val;
    }
    EastValue *v = load_ir(path, false);
    return v;
}

/* Write an IR value with its map: .json (the wrapper) or .beast2 (header map). */
static int save_ir_with_map(const char *path, EastValue *ir, EastSourceMap *map)
{
    FileFormat fmt = path ? detect_format(path) : FMT_JSON;
    if (fmt == FMT_BEAST2) {
        ByteBuffer *buf = east_beast2_encode_ir(ir, map);
        if (!buf) {
            fprintf(stderr, "Error: beast2 encode failed\n");
            return 1;
        }
        int rc = write_file_binary(path, buf->data, buf->len);
        byte_buffer_free(buf);
        return rc;
    }
    if (fmt != FMT_JSON) {
        fprintf(stderr, "Error: ir writes .json or .beast2, got %s\n", path);
        return 1;
    }
    EastValue *sm_val = east_source_map_to_value(map);
    EastValue *fields[2] = {ir, sm_val};
    EastValue *wrapper =
        east_struct_new((const char *[]){"ir", "source_map"}, fields, 2, east_ir_wrapper_type());
    east_value_release(sm_val);
    char *text = east_json_encode(wrapper, east_ir_wrapper_type());
    east_value_release(wrapper);
    if (!text) {
        fprintf(stderr, "Error: JSON encode failed\n");
        return 1;
    }
    int rc = 0;
    if (path) {
        rc = write_file_text(path, text);
    } else {
        fputs(text, stdout);
        fputc('\n', stdout);
    }
    free(text);
    return rc;
}

static int cmd_ir_normalize(const char *in_path, const char *out_path)
{
    east_type_of_type_init();
    EastSourceMap *map = NULL;
    EastValue *ir = load_ir_with_map(in_path, &map);
    if (!ir) return 1;
    EastValue *norm = east_ir_normalize(ir);
    east_value_release(ir);
    east_source_map_release(map);
    if (!norm) {
        fprintf(stderr, "Error: IR normalization failed (unknown node kind?)\n");
        return 1;
    }
    int rc = save_ir_with_map(out_path, norm, NULL);
    east_value_release(norm);
    return rc;
}

static int cmd_ir_diff(const char *a_path, const char *b_path, bool raw)
{
    east_type_of_type_init();
    EastSourceMap *ma = NULL, *mb = NULL;
    EastValue *a = load_ir_with_map(a_path, &ma);
    EastValue *b = a ? load_ir_with_map(b_path, &mb) : NULL;
    east_source_map_release(ma);
    east_source_map_release(mb);
    if (!a || !b) {
        if (a) east_value_release(a);
        return 2;
    }
    EastValue *na = a, *nb = b;
    if (!raw) {
        na = east_ir_normalize(a);
        nb = east_ir_normalize(b);
        east_value_release(a);
        east_value_release(b);
        if (!na || !nb) {
            fprintf(stderr, "Error: IR normalization failed\n");
            if (na) east_value_release(na);
            if (nb) east_value_release(nb);
            return 2;
        }
    }
    char *path = east_value_diff_path(na, nb);
    east_value_release(na);
    east_value_release(nb);
    if (path) {
        printf("differ at %s\n", path);
        free(path);
        return 1;
    }
    printf("identical\n");
    return 0;
}

static int cmd_ir_convert(const char *in_path, const char *out_path)
{
    east_type_of_type_init();
    if (!out_path) {
        fprintf(stderr, "Error: ir convert requires -o <out.json|out.beast2>\n");
        return 1;
    }
    EastSourceMap *map = NULL;
    EastValue *ir = load_ir_with_map(in_path, &map);
    if (!ir) return 1;
    int rc = save_ir_with_map(out_path, ir, map);
    east_value_release(ir);
    east_source_map_release(map);
    return rc;
}

static int cmd_ir(int argc, char **argv)
{
    if (argc < 3) {
        fprintf(stderr, "Error: ir requires a subcommand: normalize | diff | convert\n");
        return 1;
    }
    const char *sub = argv[2];
    const char *positional[2] = {NULL, NULL};
    int n_pos = 0;
    const char *out_path = NULL;
    bool raw = false;
    for (int i = 3; i < argc; i++) {
        if ((strcmp(argv[i], "-o") == 0 || strcmp(argv[i], "--output") == 0) && i + 1 < argc) {
            out_path = argv[++i];
        } else if (strcmp(argv[i], "--raw") == 0) {
            raw = true;
        } else if (argv[i][0] != '-' && n_pos < 2) {
            positional[n_pos++] = argv[i];
        } else {
            fprintf(stderr, "Error: Unknown option: %s\n", argv[i]);
            return 1;
        }
    }
    if (strcmp(sub, "normalize") == 0) {
        if (n_pos != 1) {
            fprintf(stderr, "Error: ir normalize <ir_file> [-o FILE]\n");
            return 1;
        }
        return cmd_ir_normalize(positional[0], out_path);
    }
    if (strcmp(sub, "diff") == 0) {
        if (n_pos != 2) {
            fprintf(stderr, "Error: ir diff <ir_file_a> <ir_file_b> [--raw]\n");
            return 1;
        }
        return cmd_ir_diff(positional[0], positional[1], raw);
    }
    if (strcmp(sub, "convert") == 0) {
        if (n_pos != 1) {
            fprintf(stderr, "Error: ir convert <ir_file> -o FILE\n");
            return 1;
        }
        return cmd_ir_convert(positional[0], out_path);
    }
    fprintf(stderr, "Error: Unknown ir subcommand: %s (normalize | diff | convert)\n", sub);
    return 1;
}

static int cmd_version(const char **packages, int num_packages)
{
    printf("east-c-cli %s\n", EAST_CLI_VERSION);
    printf("east-c %s\n", EAST_RUNTIME_VERSION);

    if (num_packages > 0) {
        printf("\nPlatforms:\n");
        for (int i = 0; i < num_packages; i++) {
            if (is_std_package(packages[i])) {
                /* Count functions by registering into a temp registry */
                PlatformRegistry *tmp = platform_registry_new();
                east_std_register_all(tmp);
                size_t fn_count =
                    hashmap_count(tmp->functions) + hashmap_count(tmp->generic_functions);
                printf("  east-c-std %s (%zu platform functions)\n", EAST_RUNTIME_VERSION,
                       fn_count);
                platform_registry_free(tmp);
            } else {
                printf("  %s: not available\n", packages[i]);
            }
        }
    }

    return 0;
}

/* ------------------------------------------------------------------ */
/*  Usage / help                                                       */
/* ------------------------------------------------------------------ */

static void print_usage(const char *prog)
{
    fprintf(stderr,
            "Usage:\n"
            "  %s run <ir_file> [-p PACKAGE...] [-i FILE...] [-o FILE] [-v] [--profile]\n"
            "         [--snapshot PATH]\n"
            "  %s run --from-snapshot PATH [-o FILE] [-v]\n"
            "  %s merge [-p PACKAGE...] [--merge FILE | --union] [--range FILE] -i FILE...\n"
            "         -o FILE [-v]\n"
            "  %s convert <in_file> [-o FILE] [--type TYPE] [-v]\n"
            "  %s ir normalize <ir_file> [-o FILE]\n"
            "  %s ir diff <ir_file_a> <ir_file_b> [--raw]\n"
            "  %s ir convert <ir_file> -o FILE\n"
            "  %s version [-p PACKAGE...]\n"
            "\n"
            "Commands:\n"
            "  run      Run an East IR program\n"
            "  merge    Merge sorted Set or Dict blobs of one type into one, in a single\n"
            "           pass: equal keys fold with the East function (K, V, V) -> V in\n"
            "           --merge FILE (Dict), or collapse under --union (Set); without a\n"
            "           fold an equal key is an error. With --range FILE — a beast2 blob\n"
            "           of Struct{from: Option<K>, to: Option<K>} over the inputs' key\n"
            "           type, an absent bound open — only the keys in [from, to) merge.\n"
            "           The output is what `run --emit` writes for the same entries\n"
            "           emitted ascending.\n"
            "  convert  Decode a value file and re-encode in another format.\n"
            "           Output format is determined by -o's extension; omit -o to\n"
            "           print east-text to stdout. Auto-extracts the type from\n"
            "           .beast2 input; --type (east-text) required for other formats.\n"
            "  ir       The IR toolbox. normalize: the canonical form of an IR file\n"
            "           (loc_ids stripped, variables/labels renamed in lowering order,\n"
            "           captures recomputed, recursive type ids renumbered) — the\n"
            "           round-trip equality contract. diff: normalize two IR files and\n"
            "           report the first structural difference (exit 1) or 'identical'\n"
            "           (--raw compares as-is). convert: json <-> beast2 with the\n"
            "           source map intact.\n"
            "  version  Show version information\n"
            "\n"
            "Options:\n"
            "  -p, --package PACKAGE   Platform package (e.g., std or east-c-std)\n"
            "  -i, --input FILE        Input data file (repeatable, order matches params)\n"
            "  -o, --output FILE       Output file for result\n"
            "  -v, --verbose           Enable verbose output\n"
            "      --exit-with-parent  Exit with status 1 once stdin reaches end of file —\n"
            "                          for a parent that holds a stdin pipe it never writes\n"
            "                          to, and takes the runner down with it (any command)\n"
            "      --emit KIND         Write the output incrementally from the function's\n"
            "                          trailing emit parameter (array|set|dict)\n"
            "      --merge FILE        With --emit dict: fold equal keys with the East\n"
            "                          function (K, V, V) -> V in FILE, in emission order\n"
            "      --union             With --emit set: collapse equal elements\n"
            "      --stream N          Feed the given -i input lazily (0-based index,\n"
            "                          repeatable; segment-fed iteration, O(segment)\n"
            "                          decoded memory)\n"
            "      --profile           Print every East function called, by self time,\n"
            "                          with its call count and source location\n"
            "      --snapshot PATH     Write a .east-snapshot bundle (IR + inputs + manifest)\n"
            "      --from-snapshot PATH  Replay from a .east-snapshot bundle (exclusive\n"
            "                            with <ir_file>, -i, -p)\n"
            "\n"
            "Supported formats: .json, .beast2, .beast, .east\n",
            prog, prog, prog, prog, prog, prog, prog, prog);
}

/* ------------------------------------------------------------------ */
/*  Main                                                               */
/* ------------------------------------------------------------------ */

typedef struct {
    int argc;
    char **argv;
} cli_args;

/* Runs on a large-stack worker thread (see east_run_on_large_stack) so deeply
 * recursive East programs don't overflow the main thread's fixed stack. */
static int cli_main(void *arg)
{
    int argc = ((cli_args *)arg)->argc;
    char **argv = ((cli_args *)arg)->argv;

    if (argc < 2) {
        print_usage(argv[0]);
        return 1;
    }

    const char *command = argv[1];

    /* Collect options */
    const char *packages[MAX_PACKAGES];
    int num_packages = 0;
    const char *input_files[MAX_INPUTS];
    int num_inputs = 0;
    const char *output_file = NULL;
    bool verbose = false;
    const char *ir_path = NULL;
    const char *snapshot_out_path = NULL;
    const char *from_snapshot_path = NULL;
    EmitKind emit_kind = EMIT_NONE;
    const char *merge_path = NULL;
    bool union_mode = false;
    const char *range_path = NULL;
    int stream_inputs[MAX_INPUTS];
    int num_streams = 0;
    bool profile = false;

    if (strcmp(command, "run") == 0) {
        /* Single-pass parse — --from-snapshot makes <ir_file> optional, so we
         * can't treat the first non-flag arg as positional until we know. */
        int i = 2;
        while (i < argc) {
            const char *a = argv[i];
            if ((strcmp(a, "-p") == 0 || strcmp(a, "--package") == 0) && i + 1 < argc) {
                if (num_packages >= MAX_PACKAGES) {
                    fprintf(stderr, "Error: Too many packages (max %d)\n", MAX_PACKAGES);
                    return 1;
                }
                packages[num_packages++] = argv[i + 1];
                i += 2;
            } else if ((strcmp(a, "-i") == 0 || strcmp(a, "--input") == 0) && i + 1 < argc) {
                if (num_inputs >= MAX_INPUTS) {
                    fprintf(stderr, "Error: Too many inputs (max %d)\n", MAX_INPUTS);
                    return 1;
                }
                input_files[num_inputs++] = argv[i + 1];
                i += 2;
            } else if ((strcmp(a, "-o") == 0 || strcmp(a, "--output") == 0) && i + 1 < argc) {
                output_file = argv[i + 1];
                i += 2;
            } else if (strcmp(a, "-v") == 0 || strcmp(a, "--verbose") == 0) {
                verbose = true;
                i++;
            } else if (strcmp(a, "--profile") == 0) {
                profile = true;
                i++;
            } else if (strcmp(a, "--snapshot") == 0 && i + 1 < argc) {
                snapshot_out_path = argv[i + 1];
                i += 2;
            } else if (strcmp(a, "--from-snapshot") == 0 && i + 1 < argc) {
                from_snapshot_path = argv[i + 1];
                i += 2;
            } else if (strcmp(a, "--emit") == 0 && i + 1 < argc) {
                const char *k = argv[i + 1];
                if (strcmp(k, "array") == 0)
                    emit_kind = EMIT_ARRAY;
                else if (strcmp(k, "set") == 0)
                    emit_kind = EMIT_SET;
                else if (strcmp(k, "dict") == 0)
                    emit_kind = EMIT_DICT;
                else {
                    fprintf(stderr, "Error: --emit must be one of array, set or dict, got '%s'\n",
                            k);
                    return 1;
                }
                i += 2;
            } else if (strcmp(a, "--merge") == 0 && i + 1 < argc) {
                merge_path = argv[i + 1];
                i += 2;
            } else if (strcmp(a, "--union") == 0) {
                union_mode = true;
                i++;
            } else if (strcmp(a, "--stream") == 0 && i + 1 < argc) {
                char *end = NULL;
                long v = strtol(argv[i + 1], &end, 10);
                if (!end || *end != '\0' || v < 0 || v > 1000000) {
                    fprintf(stderr,
                            "Error: --stream must be a non-negative input index, got '%s'\n",
                            argv[i + 1]);
                    return 1;
                }
                if (num_streams >= MAX_INPUTS) {
                    fprintf(stderr, "Error: Too many --stream flags (max %d)\n", MAX_INPUTS);
                    return 1;
                }
                stream_inputs[num_streams++] = (int)v;
                i += 2;
            } else if (a[0] != '-' && !ir_path) {
                ir_path = a;
                i++;
            } else {
                fprintf(stderr, "Error: Unknown option: %s\n", a);
                print_usage(argv[0]);
                return 1;
            }
        }

        if (merge_path && emit_kind != EMIT_DICT) {
            fprintf(stderr, "Error: --merge applies to --emit dict only\n");
            return 1;
        }
        if (union_mode && emit_kind != EMIT_SET) {
            fprintf(stderr, "Error: --union applies to --emit set only\n");
            return 1;
        }

        if (from_snapshot_path) {
            if (ir_path || num_inputs > 0 || num_packages > 0) {
                fprintf(stderr,
                        "Error: --from-snapshot cannot be combined with <ir_file>, -i, or -p\n");
                return 1;
            }
            SnapshotExtract ex;
            if (snapshot_read(from_snapshot_path, &ex) != 0) return 1;
            /* The manifest carries no streaming flags (format v1), so an emit
             * task's flags must be passed explicitly on replay — forward them. */
            int rc = cmd_run(ex.ir_path, (const char **)ex.packages, (int)ex.num_packages,
                             (const char **)ex.input_paths, (int)ex.num_inputs, output_file,
                             verbose, NULL, emit_kind, merge_path, union_mode, stream_inputs,
                             num_streams, profile);
            snapshot_extract_free(&ex);
            return rc;
        }

        if (snapshot_out_path && (emit_kind != EMIT_NONE || num_streams > 0)) {
            fprintf(stderr, "Error: --snapshot does not capture --emit/--stream (snapshot format "
                            "v1 has no streaming flags); replay with --from-snapshot passing "
                            "--emit/--stream explicitly\n");
            return 1;
        }

        if (!ir_path) {
            fprintf(stderr, "Error: Missing IR file argument\n");
            print_usage(argv[0]);
            return 1;
        }

        return cmd_run(ir_path, packages, num_packages, input_files, num_inputs, output_file,
                       verbose, snapshot_out_path, emit_kind, merge_path, union_mode, stream_inputs,
                       num_streams, profile);

    } else if (strcmp(command, "merge") == 0) {
        int i = 2;
        while (i < argc) {
            const char *a = argv[i];
            if ((strcmp(a, "-p") == 0 || strcmp(a, "--package") == 0) && i + 1 < argc) {
                if (num_packages >= MAX_PACKAGES) {
                    fprintf(stderr, "Error: Too many packages (max %d)\n", MAX_PACKAGES);
                    return 1;
                }
                packages[num_packages++] = argv[i + 1];
                i += 2;
            } else if ((strcmp(a, "-i") == 0 || strcmp(a, "--input") == 0) && i + 1 < argc) {
                if (num_inputs >= MAX_INPUTS) {
                    fprintf(stderr, "Error: Too many inputs (max %d)\n", MAX_INPUTS);
                    return 1;
                }
                input_files[num_inputs++] = argv[i + 1];
                i += 2;
            } else if ((strcmp(a, "-o") == 0 || strcmp(a, "--output") == 0) && i + 1 < argc) {
                output_file = argv[i + 1];
                i += 2;
            } else if (strcmp(a, "-v") == 0 || strcmp(a, "--verbose") == 0) {
                verbose = true;
                i++;
            } else if (strcmp(a, "--merge") == 0 && i + 1 < argc) {
                merge_path = argv[i + 1];
                i += 2;
            } else if (strcmp(a, "--union") == 0) {
                union_mode = true;
                i++;
            } else if (strcmp(a, "--range") == 0 && i + 1 < argc) {
                range_path = argv[i + 1];
                i += 2;
            } else {
                fprintf(stderr, "Error: Unknown option: %s\n", a);
                print_usage(argv[0]);
                return 1;
            }
        }
        if (num_inputs == 0) {
            fprintf(stderr, "Error: merge requires at least one -i input\n");
            return 1;
        }
        if (!output_file) {
            fprintf(stderr, "Error: merge requires -o FILE\n");
            return 1;
        }
        /* The merged blob is a beast2 stream, exactly as `run --emit` writes
         * one — so the same rule, in the same words, on every runner. */
        if (detect_format(output_file) != FMT_BEAST2) {
            fprintf(stderr, "Error: merge requires a .beast2 output file (-o)\n");
            return 1;
        }
        if (merge_path && union_mode) {
            fprintf(stderr, "Error: --merge and --union are two folds — give one\n");
            return 1;
        }
        return cmd_merge(packages, num_packages, input_files, num_inputs, output_file, verbose,
                         merge_path, union_mode, range_path);

    } else if (strcmp(command, "convert") == 0) {
        const char *in_path = NULL;
        const char *type_text = NULL;
        int i = 2;
        while (i < argc) {
            if ((strcmp(argv[i], "-o") == 0 || strcmp(argv[i], "--output") == 0) && i + 1 < argc) {
                output_file = argv[i + 1];
                i += 2;
            } else if (strcmp(argv[i], "--type") == 0 && i + 1 < argc) {
                type_text = argv[i + 1];
                i += 2;
            } else if (strcmp(argv[i], "-v") == 0 || strcmp(argv[i], "--verbose") == 0) {
                verbose = true;
                i++;
            } else if (argv[i][0] != '-' && !in_path) {
                in_path = argv[i];
                i++;
            } else {
                fprintf(stderr, "Error: Unknown option: %s\n", argv[i]);
                print_usage(argv[0]);
                return 1;
            }
        }
        if (!in_path) {
            fprintf(stderr, "Error: convert requires <in_file>\n");
            print_usage(argv[0]);
            return 1;
        }
        return cmd_convert(in_path, output_file, type_text, verbose);

    } else if (strcmp(command, "ir") == 0) {
        return cmd_ir(argc, argv);

    } else if (strcmp(command, "version") == 0) {
        /* Parse version arguments */
        for (int i = 2; i < argc; i++) {
            if ((strcmp(argv[i], "-p") == 0 || strcmp(argv[i], "--package") == 0) && i + 1 < argc) {
                if (num_packages >= MAX_PACKAGES) {
                    fprintf(stderr, "Error: Too many packages (max %d)\n", MAX_PACKAGES);
                    return 1;
                }
                packages[num_packages++] = argv[i + 1];
                i++;
            } else {
                fprintf(stderr, "Error: Unknown option: %s\n", argv[i]);
                print_usage(argv[0]);
                return 1;
            }
        }

        return cmd_version(packages, num_packages);

    } else if (strcmp(command, "-h") == 0 || strcmp(command, "--help") == 0) {
        print_usage(argv[0]);
        return 0;
    } else {
        fprintf(stderr, "Error: Unknown command: %s\n", command);
        print_usage(argv[0]);
        return 1;
    }
}

int main(int argc, char **argv)
{
    east_init_crash_handling();
    /* A parent that gave the runner a stdin lifeline takes it down with it:
     * the flag is taken off the command line here, before any work starts,
     * so every command accepts it wherever the parent splices it. */
    int kept = 0;
    bool lifeline = false;
    for (int i = 0; i < argc; i++) {
        if (i > 0 && strcmp(argv[i], "--exit-with-parent") == 0) {
            lifeline = true;
            continue;
        }
        argv[kept++] = argv[i];
    }
    argv[kept] = NULL;
    if (lifeline) east_exit_with_parent();
    cli_args args = {kept, argv};
    return east_run_on_large_stack(cli_main, &args);
}
