/*
 * east-c CLI — Run compiled East IR programs from the command line.
 *
 * Usage:
 *   east-c run <ir_file> [-p PACKAGE...] [-i FILE...] [-o FILE] [-v]
 *   east-c version [-p PACKAGE...]
 */

#include <east/east.h>
#include <east/eval_result.h>
#include <east/type_of_type.h>
#include <east_std/east_std.h>

#include "snapshot.h"

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
        /* Collection-rooted outputs are ALWAYS written segmented + indexed
         * (byte-adaptive segments) so e3's paged dataset reads can seek —
         * one uniform encoding per logical value, at every size. */
        bool collection = type->kind == EAST_TYPE_ARRAY || type->kind == EAST_TYPE_SET ||
                          type->kind == EAST_TYPE_DICT;
        ByteBuffer *buf = collection
                              ? east_beast2_encode_paged(value, type, EAST_BEAST2_CODEC_DEFLATE, 0)
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

/* ------------------------------------------------------------------ */
/*  Streaming emit sink (--emit)                                       */
/* ------------------------------------------------------------------ */

typedef enum {
    EMIT_NONE = -1,
    EMIT_ARRAY = 0,
    EMIT_SET = 1,
    EMIT_DICT = 2,
} EmitKind;

/* Batching mirrors the paged encoder: an element cap, refined toward a
 * byte target from the writer's actual output as segments flush. */
#define EMIT_BATCH_CAP 1000
#define EMIT_TARGET_BYTES (2u * 1024u * 1024u)

/* The body's trailing parameter is a runner-provided function value; each
 * call appends one element (pair for dict outputs) through a streaming
 * beast2 writer to the output file — O(batch) memory end to end. Set/Dict
 * emission must be strictly ascending in East (key) order: the check runs
 * per call so a violation names the offending emit, and a duplicate key
 * can never collapse silently inside a batch container. */
typedef struct {
    FILE *out;
    Beast2StreamWriter *writer;
    EastType *out_type; /* owned: the output collection type */
    EmitKind kind;
    EastValue *batch;    /* owned accumulator of the collection kind */
    EastValue *last_key; /* owned: previous key/element for the ascent check */
    size_t batch_count;
    size_t next_batch;
    size_t written_elements;
    size_t written_bytes;
} EmitSink;

static EastValue *emit_new_batch(EmitSink *s)
{
    switch (s->kind) {
    case EMIT_ARRAY:
    case EMIT_SET:
        return s->kind == EMIT_ARRAY ? east_array_new(s->out_type->data.element)
                                     : east_set_new(s->out_type->data.element);
    default:
        return east_dict_new(s->out_type->data.dict.key, s->out_type->data.dict.value);
    }
}

static bool emit_drain(EmitSink *s)
{
    ByteBuffer *buf = east_beast2_writer_take(s->writer);
    if (!buf) return true;
    size_t wrote = fwrite(buf->data, 1, buf->len, s->out);
    bool ok = wrote == buf->len;
    s->written_bytes += wrote;
    byte_buffer_free(buf);
    return ok;
}

static bool emit_flush(EmitSink *s)
{
    if (s->batch_count == 0) return true;
    if (!east_beast2_writer_write(s->writer, s->batch)) return false;
    if (!emit_drain(s)) return false;
    s->written_elements += s->batch_count;
    east_value_release(s->batch);
    s->batch = emit_new_batch(s);
    s->batch_count = 0;
    if (!s->batch) return false;
    /* written_bytes includes the header — a slight average overestimate
     * that only makes batches marginally smaller. */
    size_t avg = s->written_bytes / (s->written_elements > 0 ? s->written_elements : 1);
    if (avg == 0) avg = 1;
    size_t next = EMIT_TARGET_BYTES / avg;
    if (next < 1) next = 1;
    if (next > EMIT_BATCH_CAP) next = EMIT_BATCH_CAP;
    s->next_batch = next;
    return true;
}

static EvalResult emit_invoke(EastCompiledFn *self, EastValue **args, size_t n_args)
{
    EmitSink *s = (EmitSink *)self->invoke_userdata;
    size_t expected = s->kind == EMIT_DICT ? 2 : 1;
    if (n_args != expected || !args[0] || (expected == 2 && !args[1])) {
        return eval_error("emit called with the wrong number of arguments");
    }
    EastValue *key = args[0];
    if (s->kind != EMIT_ARRAY) {
        if (s->last_key && east_value_compare(s->last_key, key) >= 0) {
            return eval_error(
                s->kind == EMIT_DICT
                    ? "beast2 v5: Dict stream batches must be strictly ascending in East key "
                      "order — segment content is the canonical value; emit in ascending key "
                      "order, or emit arrival order as an Array"
                    : "beast2 v5: Set stream batches must be strictly ascending in East element "
                      "order — segment content is the canonical value; emit in ascending element "
                      "order, or emit arrival order as an Array");
        }
        east_value_retain(key);
        if (s->last_key) east_value_release(s->last_key);
        s->last_key = key;
    }
    switch (s->kind) {
    case EMIT_ARRAY:
        east_array_push(s->batch, args[0]);
        break;
    case EMIT_SET:
        east_set_insert(s->batch, args[0]);
        break;
    default:
        east_dict_set(s->batch, args[0], args[1]);
        break;
    }
    s->batch_count++;
    if (s->batch_count >= s->next_batch && !emit_flush(s)) {
        return eval_error("emit: failed to write output segment");
    }
    return eval_ok(east_null());
}

/* Builds the sink + its output collection type from the emit parameter's
 * function type. Returns NULL with a message on stderr when the shape or
 * output destination is unusable. */
static EmitSink *emit_sink_new(EmitKind kind, EastType *emit_param_type, const char *output_file)
{
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
        fprintf(stderr, "Error: --emit expects an emit parameter taking %zu argument(s), got %zu\n",
                expected, arity);
        return NULL;
    }
    EastType **ins = emit_param_type->data.function.inputs;
    EastType *out_type = kind == EMIT_DICT  ? east_dict_type(ins[0], ins[1])
                         : kind == EMIT_SET ? east_set_type(ins[0])
                                            : east_array_type(ins[0]);
    if (!out_type) return NULL;

    EmitSink *s = calloc(1, sizeof(EmitSink));
    if (!s) {
        east_type_release(out_type);
        return NULL;
    }
    s->kind = kind;
    s->out_type = out_type;
    s->next_batch = EMIT_BATCH_CAP;
    s->out = fopen(output_file, "wb");
    if (!s->out) {
        fprintf(stderr, "Error: Cannot write file: %s\n", output_file);
        east_type_release(out_type);
        free(s);
        return NULL;
    }
    s->writer = east_beast2_writer_new(out_type, EAST_BEAST2_CODEC_DEFLATE, true, true);
    s->batch = emit_new_batch(s);
    if (!s->writer || !s->batch) {
        if (s->writer) east_beast2_writer_free(s->writer);
        if (s->batch) east_value_release(s->batch);
        fclose(s->out);
        east_type_release(out_type);
        free(s);
        return NULL;
    }
    return s;
}

/* Flushes the final batch and the terminator + index, then closes the file. */
static bool emit_sink_finish(EmitSink *s)
{
    bool ok = emit_flush(s);
    ok = east_beast2_writer_finish(s->writer) && ok;
    ok = emit_drain(s) && ok;
    ok = fclose(s->out) == 0 && ok;
    s->out = NULL;
    return ok;
}

static void emit_sink_free(EmitSink *s)
{
    if (!s) return;
    if (s->out) fclose(s->out);
    if (s->writer) east_beast2_writer_free(s->writer);
    if (s->batch) east_value_release(s->batch);
    if (s->last_key) east_value_release(s->last_key);
    if (s->out_type) east_type_release(s->out_type);
    free(s);
}

/* ------------------------------------------------------------------ */
/*  Commands                                                           */
/* ------------------------------------------------------------------ */

static int cmd_run(const char *ir_path, const char **packages, int num_packages,
                   const char **input_files, int num_inputs, const char *output_file, bool verbose,
                   const char *snapshot_out_path, EmitKind emit_kind, int stream_input)
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
    for (int i = 0; i < num_packages; i++) {
        if (is_std_package(packages[i])) {
            east_std_register_all(platform);
        } else {
            fprintf(stderr,
                    "Error: Unknown platform package: %s\n"
                    "Available: east-c-std (or shorthand: std)\n",
                    packages[i]);
            platform_registry_free(platform);
            builtin_registry_free(builtins);
            return 1;
        }
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
    if (stream_input >= 0 && (size_t)stream_input >= file_params) {
        fprintf(stderr, "Error: --stream index %d out of range (%zu inputs)\n", stream_input,
                file_params);
        ir_node_release(ir);
        platform_registry_free(platform);
        builtin_registry_free(builtins);
        return 1;
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
        platform_registry_free(platform);
        builtin_registry_free(builtins);
        return 1;
    }

    /* The emit sink writes the output; built before the inputs so a bad
     * emit shape fails fast. */
    EmitSink *emit_sink = NULL;
    if (emit_kind != EMIT_NONE) {
        emit_sink = emit_sink_new(emit_kind, num_params > 0 ? param_types[num_params - 1] : NULL,
                                  output_file);
        if (!emit_sink) {
            ir_node_release(ir);
            platform_registry_free(platform);
            builtin_registry_free(builtins);
            return 1;
        }
    }

    /* Load inputs with type-directed parsing (paths already listed in the
     * Function section above). The emit capability, when present, is the
     * trailing argument. */
    size_t num_args = (size_t)num_inputs + (emit_sink ? 1u : 0u);
    EastValue **args = NULL;
    if (num_args > 0) {
        args = calloc(num_args, sizeof(EastValue *));
        for (int i = 0; i < num_inputs; i++) {
            args[i] = load_value(input_files[i], param_types[i]);
            if (!args[i]) {
                char *ts = format_type(param_types[i]);
                fprintf(stderr, "Error: Failed to parse input %d (%s) as %s\n", i, input_files[i],
                        ts ? ts : "?");
                free(ts);
                for (int j = 0; j < i; j++)
                    east_value_release(args[j]);
                free(args);
                emit_sink_free(emit_sink);
                ir_node_release(ir);
                platform_registry_free(platform);
                builtin_registry_free(builtins);
                return 1;
            }
        }
        if (emit_sink) {
            args[num_inputs] =
                east_foreign_function(emit_invoke, emit_sink, NULL, param_types[num_params - 1]);
            if (!args[num_inputs]) {
                fprintf(stderr, "Error: failed to construct the emit capability\n");
                for (int j = 0; j < num_inputs; j++)
                    east_value_release(args[j]);
                free(args);
                emit_sink_free(emit_sink);
                ir_node_release(ir);
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

    IRNode *body = ir->data.function.body;
    char *compile_err = NULL;
    EastCompiledFn *fn = east_compile_checked(body, platform, builtins, &compile_err);
    if (!fn) {
        fprintf(stderr, "Error: %s\n", compile_err ? compile_err : "Failed to compile IR");
        free(compile_err);
        for (size_t i = 0; i < num_args; i++)
            east_value_release(args[i]);
        free(args);
        emit_sink_free(emit_sink);
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

    /* Set parameter names so east_call can bind arguments */
    fn->num_params = ir->data.function.num_params;
    if (fn->num_params > 0) {
        fn->param_names = calloc(fn->num_params, sizeof(char *));
        for (size_t i = 0; i < fn->num_params; i++) {
            fn->param_names[i] = strdup(ir->data.function.params[i].name);
        }
    }

    /* Execute */
    clock_gettime(CLOCK_MONOTONIC, &t2);

    EvalResult result = east_call(fn, args, num_args);
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
        if (!emit_sink_finish(emit_sink)) {
            fprintf(stderr, "Error: failed to finalize the emitted output\n");
            exit_code = 1;
        } else if (verbose) {
            char *ts = format_type(emit_sink->out_type);
            char sz[32];
            format_file_size(output_file, sz, sizeof(sz));
            fprintf(stderr, "Output: %s  (%s)\n  %s\n", output_file, sz, ts ? ts : "?");
            free(ts);
        }
    } else {
        /* Save or print result */
        if (output_file) {
            if (save_value(output_file, result.value, return_type) != 0) {
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
            char *text = east_print_value(result.value, return_type);
            if (text) {
                printf("%s\n", text);
                free(text);
            }
        }
    }

    clock_gettime(CLOCK_MONOTONIC, &t4);

    /* Cleanup */
    if (result.value) east_value_release(result.value);
    eval_result_free(&result);
    east_compiled_fn_free(fn);
    for (size_t i = 0; i < num_args; i++)
        east_value_release(args[i]);
    free(args);
    emit_sink_free(emit_sink);
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
            "  %s run <ir_file> [-p PACKAGE...] [-i FILE...] [-o FILE] [-v] [--snapshot PATH]\n"
            "  %s run --from-snapshot PATH [-o FILE] [-v]\n"
            "  %s convert <in_file> [-o FILE] [--type TYPE] [-v]\n"
            "  %s version [-p PACKAGE...]\n"
            "\n"
            "Commands:\n"
            "  run      Run an East IR program\n"
            "  convert  Decode a value file and re-encode in another format.\n"
            "           Output format is determined by -o's extension; omit -o to\n"
            "           print east-text to stdout. Auto-extracts the type from\n"
            "           .beast2 input; --type (east-text) required for other formats.\n"
            "  version  Show version information\n"
            "\n"
            "Options:\n"
            "  -p, --package PACKAGE   Platform package (e.g., std or east-c-std)\n"
            "  -i, --input FILE        Input data file (repeatable, order matches params)\n"
            "  -o, --output FILE       Output file for result\n"
            "  -v, --verbose           Enable verbose output\n"
            "      --emit KIND         Write the output incrementally from the function's\n"
            "                          trailing emit parameter (array|set|dict)\n"
            "      --stream N          Streamed input marker (0-based -i index; inputs\n"
            "                          currently decode eagerly on this runner)\n"
            "      --snapshot PATH     Write a .east-snapshot bundle (IR + inputs + manifest)\n"
            "      --from-snapshot PATH  Replay from a .east-snapshot bundle (exclusive\n"
            "                            with <ir_file>, -i, -p)\n"
            "\n"
            "Supported formats: .json, .beast2, .beast, .east\n",
            prog, prog, prog, prog);
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
    int stream_input = -1;

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
            } else if (strcmp(a, "--stream") == 0 && i + 1 < argc) {
                char *end = NULL;
                long v = strtol(argv[i + 1], &end, 10);
                if (!end || *end != '\0' || v < 0) {
                    fprintf(stderr,
                            "Error: --stream must be a non-negative input index, got '%s'\n",
                            argv[i + 1]);
                    return 1;
                }
                stream_input = (int)v;
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

        if (from_snapshot_path) {
            if (ir_path || num_inputs > 0 || num_packages > 0) {
                fprintf(stderr,
                        "Error: --from-snapshot cannot be combined with <ir_file>, -i, or -p\n");
                return 1;
            }
            SnapshotExtract ex;
            if (snapshot_read(from_snapshot_path, &ex) != 0) return 1;
            int rc = cmd_run(ex.ir_path, (const char **)ex.packages, (int)ex.num_packages,
                             (const char **)ex.input_paths, (int)ex.num_inputs, output_file,
                             verbose, NULL, EMIT_NONE, -1);
            snapshot_extract_free(&ex);
            return rc;
        }

        if (!ir_path) {
            fprintf(stderr, "Error: Missing IR file argument\n");
            print_usage(argv[0]);
            return 1;
        }

        return cmd_run(ir_path, packages, num_packages, input_files, num_inputs, output_file,
                       verbose, snapshot_out_path, emit_kind, stream_input);

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
    cli_args args = {argc, argv};
    return east_run_on_large_stack(cli_main, &args);
}
