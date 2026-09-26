/*
 * east-c CLI — Run compiled East IR programs from the command line.
 *
 * Usage:
 *   east-c run <ir_file> [-p PACKAGE...] [-i FILE...] [-o FILE] [-v]
 *   east-c exec <unit> [-v]
 *   east-c version [-p PACKAGE...]
 */

#include <east/east.h>
#include <east/eval_result.h>
#include <east/file_map.h>
#include <east/type_of_type.h>
#include <east/ir_normalize.h>
#include <east_std/east_std.h>

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

/* The bytes a manifest's collection comes to: the segments it names. A
 * manifest is a few dozen bytes per segment whatever the collection weighs,
 * so its own file's size would put any input under the lazy threshold. */
static size_t manifest_segment_bytes(EastValue *manifest)
{
    EastValue *entries = east_struct_get_field_idx(manifest, 5);
    size_t total = 0;
    for (size_t i = 0; i < east_array_len(entries); i++) {
        EastValue *bytes = east_struct_get_field_idx(east_array_get(entries, i), 3);
        if (bytes && bytes->kind == EAST_VAL_INTEGER && bytes->data.integer > 0)
            total += (size_t)bytes->data.integer;
    }
    return total;
}

/* Loads a manifest-rooted input: the collection its manifest names, read from
 * the directory beside it (`<path>.segments/`), lazily when asked — only the
 * segments the body touches are ever read — else whole. A shape the pager
 * cannot serve decodes whole, as a blob's does. */
static EastValue *load_manifest_input(const char *path, EastValue *manifest, EastType *type,
                                      bool lazy, bool *mapped_out)
{
    EastValue *val = lazy ? east_beast2_open_manifest_dir(path, manifest, type, true) : NULL;
    if (val) {
        if (mapped_out) *mapped_out = true;
        return val;
    }
    if (lazy) free(east_builtin_get_error());
    val = east_beast2_decode_manifest_dir(path, manifest, type, true);
    if (!val) {
        char *err = east_builtin_get_error();
        fprintf(stderr, "Error: Failed to decode Beast2 from %s: %s\n", path,
                err ? err : "the manifest directory does not decode");
        free(err);
    }
    return val;
}

/* Loads input value `path`, always FROZEN — task inputs are immutable
 * (mutating builtins raise the uniform copy-first error, and frozen
 * collections compare by value). A beast2 collection input opens lazily when
 * it weighs `threshold` bytes or more (0 disables): an indexed blob as a paged
 * value over a mapping of the file
 * (map_input_file: the input's residency is the page cache and the heap holds
 * one decoded segment at a time — issue #505; the value releases the mapping
 * through input_release_mapping; *mapped_out reports it), and a manifest over
 * its directory's segment files. Anything not pageable (other formats,
 * index-less or aliased blobs, Ref- or function-bearing element shapes)
 * silently decodes whole, exactly like east-node's runner. Non-beast2 formats
 * have no frozen decoder, so the decoded value round-trips through a canonical
 * beast2 encode + frozen decode, like east-py's runner. */
static EastValue *load_input_value(const char *path, EastType *type, size_t threshold,
                                   bool *mapped_out)
{
    if (mapped_out) *mapped_out = false;
    if (detect_format(path) != FMT_BEAST2) {
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
    if (!data) {
        /* An empty or unmappable file is read whole, and refused as before. */
        uint8_t *bytes = read_file_binary(path, &len);
        if (!bytes) return NULL;
        EastValue *val = east_beast2_decode_full_frozen(bytes, len, type);
        free(bytes);
        if (!val) fprintf(stderr, "Error: Failed to decode Beast2 from %s\n", path);
        return val;
    }
    bool collection = type->kind == EAST_TYPE_ARRAY || type->kind == EAST_TYPE_SET ||
                      type->kind == EAST_TYPE_DICT;
    EastValue *manifest = NULL;
    int found = collection ? east_beast2_read_manifest(data, len, &manifest) : 0;
    if (found != 0) {
        size_t weight = found == 1 ? len + manifest_segment_bytes(manifest) : 0;
        input_release_mapping(map_ctx, data, len);
        if (found == -1) {
            char *err = east_builtin_get_error();
            fprintf(stderr, "Error: Failed to decode Beast2 from %s: %s\n", path,
                    err ? err : "the manifest does not decode");
            free(err);
            return NULL;
        }
        bool lazy = threshold > 0 && weight >= threshold;
        EastValue *val = load_manifest_input(path, manifest, type, lazy, mapped_out);
        east_value_release(manifest);
        return val;
    }
    if (collection && threshold > 0 && len >= threshold) {
        EastValue *paged =
            east_beast2_open_paged_external(data, len, type, true, input_release_mapping, map_ctx);
        if (paged) {
            if (mapped_out) *mapped_out = true;
            return paged; /* the value releases the mapping */
        }
        free(east_builtin_get_error());
    }
    /* Decoded whole from the mapping, which is dropped at once. */
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
/*  The function a unit's output folds with                           */
/* ------------------------------------------------------------------ */

static EastValue *load_ir_with_map(const char *path, EastSourceMap **map_out);

/* A dict's merge or a fold's combine, compiled, and the IR it was compiled
 * from: freed after the sink that borrows it. */
typedef struct {
    IRNode *ir;
    EastCompiledFn *fn;
} UnitFunction;

static void unit_function_free(UnitFunction *function)
{
    if (function->fn) east_compiled_fn_free(function->fn);
    if (function->ir) ir_node_release(function->ir);
    function->fn = NULL;
    function->ir = NULL;
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

/* Loads a program: the IR file's function node, and in *map_out the source map
 * its locations resolve through (or NULL), the caller's. NULL with a message
 * on stderr when the file does not hold a function. */
static IRNode *load_program(const char *ir_path, bool verbose, EastSourceMap **map_out)
{
    *map_out = NULL;
    IRNode *ir = NULL;
    EastValue *ir_val = NULL;
    FileFormat ir_fmt = detect_format(ir_path);

    if (ir_fmt == FMT_BEAST2) {
        /* Beast2: use combined decode+convert for O(1) type resolution */
        size_t flen = 0;
        uint8_t *fdata = read_file_binary(ir_path, &flen);
        if (!fdata) return NULL;
        ir = east_beast2_decode_ir(fdata, flen, &ir_val, map_out);
        free(fdata);
    } else if (ir_fmt == FMT_JSON) {
        /* JSON: decode wrapper {ir, source_map} with source map extraction */
        size_t flen = 0;
        char *text = read_file_text(ir_path, &flen);
        if (!text) return NULL;
        ir = east_json_decode_ir(text, &ir_val, map_out);
        free(text);
    } else {
        /* Beast v1/East text: decode IR value, then convert */
        ir_val = load_ir(ir_path, verbose);
        if (!ir_val) return NULL;
        ir = east_ir_from_value(ir_val);
    }

    /* ir_val is retained by the decode functions;
     * the IRNode's source_ir holds its own ref if needed for re-serialization. */
    if (ir_val) east_value_release(ir_val);

    if (!ir) {
        fprintf(stderr, "Error: Failed to convert IR value to IR node\n");
        east_source_map_release(*map_out);
        *map_out = NULL;
        return NULL;
    }

    /* Validate IR is a function */
    if (ir->kind != IR_FUNCTION && ir->kind != IR_ASYNC_FUNCTION) {
        fprintf(stderr,
                "Error: IR must be a Function or AsyncFunction node, got kind %d\n"
                "The IR file should contain compiled function IR.\n",
                ir->kind);
    } else if (!ir->type || (ir->type->kind != EAST_TYPE_FUNCTION &&
                             ir->type->kind != EAST_TYPE_ASYNC_FUNCTION)) {
        fprintf(stderr, "Error: IR function node has invalid type\n");
    } else {
        return ir;
    }
    ir_node_release(ir);
    east_source_map_release(*map_out);
    *map_out = NULL;
    return NULL;
}

/* A function type's signature, `(A, B) -> C`, as the runners print it.
 * Allocated. */
static char *format_signature(EastType *fn_type)
{
    char sig_buf[1024];
    size_t num_params = fn_type->data.function.num_inputs;
    int off = snprintf(sig_buf, sizeof(sig_buf), "(");
    for (size_t i = 0; i < num_params; i++) {
        if (i > 0) off += snprintf(sig_buf + off, sizeof(sig_buf) - (size_t)off, ", ");
        char *ts = format_type(fn_type->data.function.inputs[i]);
        off += snprintf(sig_buf + off, sizeof(sig_buf) - (size_t)off, "%s", ts ? ts : "?");
        free(ts);
    }
    off += snprintf(sig_buf + off, sizeof(sig_buf) - (size_t)off, ") -> ");
    char *rs = format_type(fn_type->data.function.output);
    snprintf(sig_buf + off, sizeof(sig_buf) - (size_t)off, "%s", rs ? rs : "?");
    free(rs);
    return strdup(sig_buf);
}

static int cmd_run(const char *ir_path, const char **packages, int num_packages,
                   const char **input_files, int num_inputs, const char *output_file, bool verbose,
                   bool profile)
{
    /* Init type system */
    east_type_of_type_init();

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
    clock_gettime(CLOCK_MONOTONIC, &t0);

    EastSourceMap *decoded_source_map = NULL;
    IRNode *ir = load_program(ir_path, verbose, &decoded_source_map);
    if (!ir) {
        platform_registry_free(platform);
        builtin_registry_free(builtins);
        return 1;
    }

    /* Extract function signature */
    EastType *fn_type = ir->type;
    size_t num_params = fn_type->data.function.num_inputs;
    EastType **param_types = fn_type->data.function.inputs;
    EastType *return_type = fn_type->data.function.output;

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
    if ((size_t)num_inputs != num_params) {
        char *signature = format_signature(fn_type);
        fprintf(stderr, "Error: Function expects %zu inputs, got %d\nSignature: %s\n", num_params,
                num_inputs, signature ? signature : "?");
        free(signature);
        ir_node_release(ir);
        east_source_map_release(decoded_source_map);
        platform_registry_free(platform);
        builtin_registry_free(builtins);
        return 1;
    }

    /* Load inputs with type-directed parsing (paths already listed in the
     * Function section above). Collection inputs open lazily at or above the
     * size threshold. */
    size_t num_args = (size_t)num_inputs;
    size_t threshold = lazy_input_threshold();
    EastValue **args = NULL;
    bool *lazy_inputs = num_inputs > 0 ? calloc((size_t)num_inputs, sizeof(bool)) : NULL;
    if (num_args > 0) {
        args = calloc(num_args, sizeof(EastValue *));
        for (int i = 0; i < num_inputs; i++) {
            bool mapped = false;
            args[i] = load_input_value(input_files[i], param_types[i], threshold, &mapped);
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
/*  Exec: the runner protocol (east/unit.h)                            */
/* ------------------------------------------------------------------ */

/* Where an exec's time goes. */
typedef struct {
    struct timespec mark;
    double load, compile, execute, output;
} ExecClock;

/* Adds the time since the last lap to `phase`. */
static void exec_lap(ExecClock *clock, double *phase)
{
    struct timespec now;
    clock_gettime(CLOCK_MONOTONIC, &now);
    *phase += elapsed_ms(&clock->mark, &now);
    clock->mark = now;
}

/* A failed exec step: the message the library posted, else `fallback`. */
static EvalResult exec_error(const char *fallback)
{
    char *posted = east_builtin_get_error();
    EvalResult r = eval_error(posted ? posted : fallback);
    free(posted);
    return r;
}

/* The registries a unit's functions compile against: the builtins, and the
 * platform packages the unit names. False with the message posted. */
static bool exec_registries(const EastUnit *unit, BuiltinRegistry **builtins_out,
                            PlatformRegistry **platform_out)
{
    for (size_t i = 0; i < unit->num_platforms; i++) {
        if (!is_std_package(unit->platforms[i])) {
            char msg[512];
            snprintf(msg, sizeof(msg),
                     "Unknown platform package: %s (available: east-c-std, or shorthand std)",
                     unit->platforms[i]);
            east_builtin_error(msg);
            return false;
        }
    }
    *builtins_out = builtin_registry_new();
    east_register_all_builtins(*builtins_out);
    *platform_out = platform_registry_new();
    if (unit->num_platforms > 0) east_std_register_all(*platform_out);
    return true;
}

/* The function in an IR file, compiled with the unit's registries: what a
 * dict's equal keys or a fold's values fold with. `out` takes the IR and the
 * compiled function, which own the file's source map. False with the message
 * posted. */
static bool exec_function(const char *path, PlatformRegistry *platform, BuiltinRegistry *builtins,
                          UnitFunction *out)
{
    out->ir = NULL;
    out->fn = NULL;
    char msg[1024];
    EastSourceMap *map = NULL;
    EastValue *ir_val = load_ir_with_map(path, &map);
    IRNode *ir = ir_val ? east_ir_from_value(ir_val) : NULL;
    if (ir_val) east_value_release(ir_val);
    if (!ir || ir->kind != IR_FUNCTION) {
        snprintf(msg, sizeof(msg), "exec: %s does not hold a function", path);
        east_builtin_error(msg);
        if (ir) ir_node_release(ir);
        east_source_map_release(map);
        return false;
    }
    const EastSourceMap *saved_map = east_get_source_map();
    if (map) east_set_source_map(map);
    char *err = NULL;
    EastCompiledFn *fn = east_compile_fn(ir, platform, builtins, &err);
    east_set_source_map(saved_map);
    if (!fn) {
        snprintf(msg, sizeof(msg), "exec: %s: %s", path,
                 err ? err : "the function does not compile");
        east_builtin_error(msg);
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

/* A run unit: the program evaluated on its inputs, its output written by
 * kind. */
static EvalResult exec_run(const EastUnit *unit, ExecClock *clock)
{
    BuiltinRegistry *builtins = NULL;
    PlatformRegistry *platform = NULL;
    if (!exec_registries(unit, &builtins, &platform))
        return exec_error("exec: the platforms cannot be loaded");
    char msg[1024];
    EastSourceMap *map = NULL;
    IRNode *ir = load_program(unit->program, false, &map);
    if (!ir) {
        platform_registry_free(platform);
        builtin_registry_free(builtins);
        snprintf(msg, sizeof(msg), "exec: %s does not hold a program", unit->program);
        return eval_error(msg);
    }
    EastType *fn_type = ir->type;
    size_t num_params = fn_type->data.function.num_inputs;
    EastType **param_types = fn_type->data.function.inputs;
    /* Every kind but a value is emitted, through the trailing parameter. */
    bool emitted = unit->output.kind != EAST_UNIT_VALUE;
    static const char *kinds[5] = {"value", "array", "set", "dict", "fold"};
    EvalResult r = eval_ok(east_null());
    UnitFunction fold = {NULL, NULL};
    EastValue *zero = NULL;
    EastValue **args = calloc(num_params ? num_params : 1, sizeof(EastValue *));
    EastCompiledFn *fn = NULL;
    EastUnitSink *sink = NULL;
    size_t file_params = emitted && num_params > 0 ? num_params - 1 : num_params;
    if (emitted && num_params == 0) {
        snprintf(msg, sizeof(msg),
                 "exec: a %s output is emitted: the program's trailing parameter must be emit, "
                 "a function",
                 kinds[unit->output.kind]);
        r = eval_error(msg);
    } else if (unit->num_inputs != file_params) {
        char *signature = format_signature(fn_type);
        snprintf(msg, sizeof(msg), "Function expects %zu inputs, got %zu\nSignature: %s",
                 file_params, unit->num_inputs, signature ? signature : "?");
        free(signature);
        r = eval_error(msg);
    }

    /* What the output folds with: a dict's merge, a fold's combine and zero. */
    EastType *emit_type = emitted ? param_types[num_params - 1] : NULL;
    const char *fold_path = unit->output.kind == EAST_UNIT_DICT   ? unit->output.merge
                            : unit->output.kind == EAST_UNIT_FOLD ? unit->output.combine
                                                                  : NULL;
    if (r.status != EVAL_ERROR && fold_path && !exec_function(fold_path, platform, builtins, &fold))
        r = exec_error("exec: the output's function cannot be loaded");
    if (r.status != EVAL_ERROR && unit->output.kind == EAST_UNIT_FOLD && emit_type &&
        emit_type->kind == EAST_TYPE_FUNCTION && emit_type->data.function.num_inputs == 1) {
        zero = load_input_value(unit->output.zero, emit_type->data.function.inputs[0], 0, NULL);
        if (!zero) {
            snprintf(msg, sizeof(msg), "exec: fold: the zero %s cannot be read", unit->output.zero);
            r = eval_error(msg);
        }
    }

    /* The inputs, frozen; one at or above the lazy threshold opens as a paged
     * value, weighed by the value it holds. */
    size_t threshold = lazy_input_threshold();
    for (size_t i = 0; r.status != EVAL_ERROR && i < file_params; i++) {
        args[i] = load_input_value(unit->inputs[i], param_types[i], threshold, NULL);
        if (!args[i]) {
            char *ts = format_type(param_types[i]);
            snprintf(msg, sizeof(msg), "exec: input %zu (%s) cannot be read as %s", i,
                     unit->inputs[i], ts ? ts : "?");
            free(ts);
            r = eval_error(msg);
        }
    }
    exec_lap(clock, &clock->load);

    if (r.status != EVAL_ERROR) {
        /* The program's map is current while it compiles, so a compile error
         * names its node's location, and stays current while it runs. */
        if (map) east_set_source_map(map);
        char *err = NULL;
        fn = east_compile_fn(ir, platform, builtins, &err);
        if (fn) {
            if (map) fn->source_map = map;
            map = NULL;
        } else {
            r = eval_error(err ? err : "Failed to compile IR");
            free(err);
        }
    }
    if (r.status != EVAL_ERROR) {
        sink =
            east_unit_sink_new(&unit->output, emitted ? emit_type : fn_type->data.function.output,
                               unit->output.kind == EAST_UNIT_DICT ? fold.fn : NULL,
                               unit->output.kind == EAST_UNIT_FOLD ? fold.fn : NULL, zero);
        if (!sink) r = exec_error("exec: the output cannot be opened");
    }
    if (r.status != EVAL_ERROR && emitted) {
        args[num_params - 1] = east_unit_sink_function(sink, emit_type);
        if (!args[num_params - 1]) r = eval_error("exec: failed to construct the emit capability");
    }
    exec_lap(clock, &clock->compile);

    if (r.status != EVAL_ERROR) {
        eval_result_free(&r);
        r = east_call(fn, args, num_params);
        exec_lap(clock, &clock->execute);
        if (r.status != EVAL_ERROR) {
            bool ok = east_unit_sink_finish(sink, r.value);
            if (r.value) east_value_release(r.value);
            eval_result_free(&r);
            r = ok ? eval_ok(east_null()) : exec_error("exec: the output cannot be written");
            exec_lap(clock, &clock->output);
        }
    }

    /* The emit capability refers to the sink, so it goes first. */
    for (size_t i = 0; i < num_params; i++)
        if (args[i]) east_value_release(args[i]);
    free(args);
    east_unit_sink_free(sink);
    if (zero) east_value_release(zero);
    unit_function_free(&fold);
    if (fn) east_compiled_fn_free(fn);
    east_set_source_map(NULL);
    east_source_map_release(map);
    ir_node_release(ir);
    platform_registry_free(platform);
    builtin_registry_free(builtins);
    return r;
}

/* A merge unit: set or dict parts merged into one run, or fold partials
 * folded in order from zero. */
static EvalResult exec_merge(const EastUnit *unit, ExecClock *clock)
{
    if (unit->output.kind == EAST_UNIT_ARRAY)
        return eval_error("exec: an array's parts are concatenated, never merged: a merge unit "
                          "takes set, dict or fold parts");
    if (unit->output.kind == EAST_UNIT_VALUE)
        return eval_error("exec: a value has no parts: a merge unit takes set, dict or fold parts");
    BuiltinRegistry *builtins = NULL;
    PlatformRegistry *platform = NULL;
    if (!exec_registries(unit, &builtins, &platform))
        return exec_error("exec: the platforms cannot be loaded");
    char msg[1024];
    EvalResult r = eval_ok(east_null());
    UnitFunction fold = {NULL, NULL};
    const char *fold_path = unit->output.kind == EAST_UNIT_DICT   ? unit->output.merge
                            : unit->output.kind == EAST_UNIT_FOLD ? unit->output.combine
                                                                  : NULL;
    if (fold_path && !exec_function(fold_path, platform, builtins, &fold))
        r = exec_error("exec: the output's function cannot be loaded");

    if (r.status != EVAL_ERROR && unit->output.kind == EAST_UNIT_FOLD) {
        /* A merge of fold partials has no program to say what was emitted:
         * the combine's own type does. */
        EastType *t = fold.fn->fn_type;
        EastType *value_type = t->data.function.output;
        if (t->data.function.num_inputs != 2 ||
            !east_type_equal(t->data.function.inputs[0], value_type) ||
            !east_type_equal(t->data.function.inputs[1], value_type)) {
            char *printed_t = format_type(value_type);
            char *printed = format_type(t);
            snprintf(msg, sizeof(msg),
                     "exec: combine: expected a function (T, T) -> T (T = %s), got %s",
                     printed_t ? printed_t : "?", printed ? printed : "?");
            free(printed_t);
            free(printed);
            r = eval_error(msg);
        }
        EastValue *acc = r.status != EVAL_ERROR
                             ? load_input_value(unit->output.zero, value_type, 0, NULL)
                             : NULL;
        if (r.status != EVAL_ERROR && !acc) {
            snprintf(msg, sizeof(msg), "exec: fold: the zero %s cannot be read", unit->output.zero);
            r = eval_error(msg);
        }
        exec_lap(clock, &clock->compile);
        for (size_t i = 0; r.status != EVAL_ERROR && i < unit->num_inputs; i++) {
            EastValue *part = load_input_value(unit->inputs[i], value_type, 0, NULL);
            if (!part) {
                snprintf(msg, sizeof(msg), "exec: part %zu (%s) cannot be read", i,
                         unit->inputs[i]);
                eval_result_free(&r);
                r = eval_error(msg);
                break;
            }
            EastValue *fold_args[2] = {acc, part};
            EvalResult c = east_call(fold.fn, fold_args, 2);
            east_value_release(part);
            if (c.status == EVAL_ERROR) {
                eval_result_free(&r);
                r = c;
                break;
            }
            east_value_release(acc);
            acc = c.value; /* the result's reference */
            eval_result_free(&c);
        }
        exec_lap(clock, &clock->execute);
        if (r.status != EVAL_ERROR && !east_unit_write_value(unit->output.path, acc, value_type)) {
            eval_result_free(&r);
            r = exec_error("exec: the output cannot be written");
        }
        if (acc) east_value_release(acc);
        exec_lap(clock, &clock->output);
    } else if (r.status != EVAL_ERROR) {
        exec_lap(clock, &clock->load);
        if (!east_unit_merge_runs(unit, fold.fn)) {
            eval_result_free(&r);
            r = exec_error("exec: the parts cannot be merged");
        }
        exec_lap(clock, &clock->execute);
    }
    unit_function_free(&fold);
    platform_registry_free(platform);
    builtin_registry_free(builtins);
    return r;
}

/* `exec <unit>`: the unit's work done, its output written and its result
 * recorded where it says. Exits 0 for an ok outcome and 1 for a failure, whose
 * message and locations also go to stderr; a unit that cannot be read, or a
 * result that cannot be written, leaves no result and exits 2. */
static int cmd_exec(const char *unit_path, bool verbose)
{
    east_type_of_type_init();
    EastUnit *unit = east_unit_read(unit_path);
    if (!unit) {
        char *err = east_builtin_get_error();
        fprintf(stderr, "Error: exec %s: %s\n", unit_path, err ? err : "the unit cannot be read");
        free(err);
        return 2;
    }
    /* The grant caps every pool the library starts; one thread frames every
     * output inline. */
    east_set_thread_limit(unit->threads < 1 ? 1 : unit->threads > 1024 ? 1024 : (int)unit->threads);
    ExecClock clock;
    memset(&clock, 0, sizeof(clock));
    clock_gettime(CLOCK_MONOTONIC, &clock.mark);
    EvalResult outcome = unit->merge ? exec_merge(unit, &clock) : exec_run(unit, &clock);

    bool ok = outcome.status != EVAL_ERROR;
    size_t num_locations = ok ? 0 : outcome.num_locations;
    EastUnitLocation *locations =
        num_locations > 0 ? calloc(num_locations, sizeof(EastUnitLocation)) : NULL;
    if (!locations) num_locations = 0;
    for (size_t i = 0; i < num_locations; i++) {
        locations[i].filename = outcome.locations[i].filename ? outcome.locations[i].filename : "";
        locations[i].line = outcome.locations[i].line;
        locations[i].column = outcome.locations[i].column;
    }
    const char *message = ok                      ? NULL
                          : outcome.error_message ? outcome.error_message
                                                  : "unknown error";
    EastUnitResult result = {
        .ok = ok,
        .message = message,
        .locations = locations,
        .num_locations = num_locations,
        .peak_bytes = (uint64_t)east_peak_rss_kb() * 1024u,
        .load_ms = clock.load,
        .compile_ms = clock.compile,
        .execute_ms = clock.execute,
        .output_ms = clock.output,
    };
    int code = ok ? 0 : 1;
    if (!east_unit_write_result(unit->result, &result)) {
        char *err = east_builtin_get_error();
        fprintf(stderr, "Error: exec %s: %s\n", unit_path,
                err ? err : "the result cannot be written");
        free(err);
        code = 2;
    } else if (!ok) {
        fprintf(stderr, "Error: %s\n", message);
        for (size_t i = 0; i < num_locations; i++)
            fprintf(stderr, "  at %s:%ld:%ld\n", locations[i].filename, (long)locations[i].line,
                    (long)locations[i].column);
    }
    if (verbose) {
        fprintf(stderr, "\nTiming:\n");
        fprintf(stderr, "  Load:     %8.1f ms\n", clock.load);
        fprintf(stderr, "  Compile:  %8.1f ms\n", clock.compile);
        fprintf(stderr, "  Execute:  %8.1f ms\n", clock.execute);
        fprintf(stderr, "  Output:   %8.1f ms\n", clock.output);
        fprintf(stderr, "  Total:    %8.1f ms\n",
                clock.load + clock.compile + clock.execute + clock.output);
        fprintf(stderr, "\nMemory:\n");
        fprintf(stderr, "  Peak RSS: %8.1f MB\n", (double)result.peak_bytes / (1024.0 * 1024.0));
    }
    free(locations);
    if (outcome.value) east_value_release(outcome.value);
    eval_result_free(&outcome);
    east_unit_free(unit);
    return code;
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
            "  %s exec <unit> [-v]\n"
            "  %s convert <in_file> [-o FILE] [--type TYPE] [-v]\n"
            "  %s ir normalize <ir_file> [-o FILE]\n"
            "  %s ir diff <ir_file_a> <ir_file_b> [--raw]\n"
            "  %s ir convert <ir_file> -o FILE\n"
            "  %s version [-p PACKAGE...]\n"
            "\n"
            "Commands:\n"
            "  run      Run an East IR program\n"
            "  exec     Execute a unit, the runner protocol: run a program, or merge the\n"
            "           parts of an output, as the unit file says, write the output by its\n"
            "           kind and record the result; exit 0 when it is ok and 1 when it\n"
            "           failed. Relative paths in the unit are relative to its directory.\n"
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
            "      --profile           Print every East function called, by self time,\n"
            "                          with its call count and source location\n"
            "\n"
            "Supported formats: .json, .beast2, .beast, .east\n",
            prog, prog, prog, prog, prog, prog, prog);
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
    bool profile = false;

    if (strcmp(command, "run") == 0) {
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
            } else if (a[0] != '-' && !ir_path) {
                ir_path = a;
                i++;
            } else {
                fprintf(stderr, "Error: Unknown option: %s\n", a);
                print_usage(argv[0]);
                return 1;
            }
        }

        if (!ir_path) {
            fprintf(stderr, "Error: Missing IR file argument\n");
            print_usage(argv[0]);
            return 1;
        }

        return cmd_run(ir_path, packages, num_packages, input_files, num_inputs, output_file,
                       verbose, profile);

    } else if (strcmp(command, "exec") == 0) {
        const char *unit_path = NULL;
        for (int i = 2; i < argc; i++) {
            if (strcmp(argv[i], "-v") == 0 || strcmp(argv[i], "--verbose") == 0) {
                verbose = true;
            } else if (argv[i][0] != '-' && !unit_path) {
                unit_path = argv[i];
            } else {
                fprintf(stderr, "Error: Unknown option: %s\n", argv[i]);
                print_usage(argv[0]);
                return 2;
            }
        }
        if (!unit_path) {
            fprintf(stderr, "Error: exec requires <unit>\n");
            print_usage(argv[0]);
            return 2;
        }
        return cmd_exec(unit_path, verbose);

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
