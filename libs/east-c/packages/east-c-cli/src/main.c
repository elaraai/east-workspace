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
#include <east/ir_normalize.h>
#include <east_std/east_std.h>

#include "snapshot.h"

#include <errno.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
#include <sys/stat.h>
#ifndef _WIN32
#include <fcntl.h>
#include <sys/mman.h>
#include <unistd.h>
#endif
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

/* A lazily opened input MAPS its file: the paged value reads its segments
 * from the mapping, so the input's residency is the page cache and the heap
 * holds one decoded segment at a time — the mapping is released with the
 * value through this hook. Windows has no mmap here: the bytes are read
 * into a heap buffer the same hook frees. */
static void input_release_mapping(void *ctx, uint8_t *data, size_t len)
{
    (void)ctx;
#ifndef _WIN32
    munmap(data, len);
#else
    (void)len;
    free(data);
#endif
}

/* Maps (POSIX) or reads (Windows) the whole input file. NULL, quietly, when
 * the file cannot be mapped (missing, empty, a directory, a file system
 * without mmap) — the caller then takes the eager path, which reads the
 * file and reports failures exactly as it always did. */
static uint8_t *map_input_file(const char *path, size_t *len_out)
{
#ifndef _WIN32
    int fd = open(path, O_RDONLY);
    if (fd < 0) return NULL;
    struct stat st;
    if (fstat(fd, &st) != 0 || S_ISDIR(st.st_mode) || st.st_size <= 0) {
        close(fd);
        return NULL;
    }
    size_t len = (size_t)st.st_size;
    void *map = mmap(NULL, len, PROT_READ, MAP_PRIVATE, fd, 0);
    close(fd);
    if (map == MAP_FAILED) return NULL;
    *len_out = len;
    return (uint8_t *)map;
#else
    return read_file_binary(path, len_out);
#endif
}

/* Loads input value `path`, always FROZEN — task inputs are immutable
 * (mutating builtins raise the uniform copy-first error, and frozen
 * collections compare by value). When `want_lazy`, an indexed beast2
 * collection blob opens as a lazy paged value over a mapping of the file
 * (O(segment) decoded memory — issue #505; *mapped_out reports it); anything
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
    uint8_t *data = map_input_file(path, &len);
    if (!data) return load_input_value(path, type, false, mapped_out);
    EastValue *paged =
        east_beast2_open_paged_external(data, len, type, true, input_release_mapping, NULL);
    if (paged) {
        if (mapped_out) *mapped_out = true;
        return paged; /* the value releases the mapping */
    }
    free(east_builtin_get_error());
    /* Not pageable: decode whole from the mapping, then drop it at once. */
    EastValue *val = east_beast2_decode_full_frozen(data, len, type);
    input_release_mapping(NULL, data, len);
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

/* Out-of-order Set/Dict emission buffers and spills sorted runs of at most
 * this many elements (EAST_EMIT_RUN_ELEMENTS overrides; minimum 1) — the
 * in-memory bound of the sink's spill/merge path (issue #518). */
#define EMIT_RUN_ELEMENTS_DEFAULT 100000u

static size_t emit_run_elements(void)
{
    const char *env = getenv("EAST_EMIT_RUN_ELEMENTS");
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
            if (errno == 0 && end && *end == '\0' && v >= 1 && v <= (unsigned long long)SIZE_MAX)
                return (size_t)v;
        }
    }
    return EMIT_RUN_ELEMENTS_DEFAULT;
}

/* One buffered out-of-order emission: an owned key (element) and, for dict
 * outputs, an owned value. */
typedef struct {
    EastValue *key;
    EastValue *value;
} EmitPending;

/* The body's trailing parameter is a runner-provided function value; each
 * call appends one element (pair for dict outputs) through a streaming
 * beast2 writer to the output file.
 *
 * Emission order is unconstrained (issue #518). While Set/Dict emissions
 * stay strictly ascending in East (key) order, segments stream straight to
 * the output file — O(batch) memory, byte-identical to an always-ascending
 * producer. On the first out-of-order key the file written so far is
 * finalized (a complete canonical beast2 file of the prefix) and demoted to
 * spill run #0; emissions then buffer to a bounded element cap
 * (EAST_EMIT_RUN_ELEMENTS) and spill as sorted runs beside the output, and
 * finish k-way merges runs + tail into the canonical output. Duplicate
 * Set/Dict keys are a hard error in every path: immediately when adjacent
 * in the stream, at spill/merge time otherwise. */
typedef struct {
    FILE *out;
    Beast2StreamWriter *writer;
    EastType *out_type;      /* owned: the output collection type */
    const char *output_path; /* borrowed from argv */
    EmitKind kind;
    bool verbose;
    EastValue *batch;    /* owned accumulator of the collection kind */
    EastValue *last_key; /* owned: previous key/element for the ascent check */
    size_t batch_count;
    size_t next_batch;
    size_t written_elements;
    size_t written_bytes;
    size_t emitted;
    /* Out-of-order (spill/merge) state; `buffered` false means the
     * ascending fast path is still live. */
    bool buffered;
    EmitPending *buf;
    size_t buf_len, buf_cap;
    size_t run_cap;
    char **run_paths; /* owned paths of spilled runs (run 0 = demoted prefix) */
    size_t num_runs, runs_cap;
    size_t spilled_bytes;
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

/* Formats the duplicate-key error (shared by the emit-time eval error and
 * the finalize-time stderr report). `key` may be NULL. */
static void emit_duplicate_msg(EmitSink *s, EastValue *key, char *buf, size_t buflen)
{
    const char *noun = s->kind == EMIT_DICT ? "Dict" : "Set";
    const char *part = s->kind == EMIT_DICT ? "key" : "element";
    EastType *kt = s->kind == EMIT_DICT ? s->out_type->data.dict.key : s->out_type->data.element;
    char *printed = key ? east_print_value(key, kt) : NULL;
    snprintf(buf, buflen, "beast2 v5: duplicate %s %s emitted%s%s — %s %ss must be unique", noun,
             part, printed ? ": " : "", printed ? printed : "", noun, part);
    free(printed);
}

static char *emit_run_path(EmitSink *s, size_t i)
{
    size_t len = strlen(s->output_path) + 32;
    char *p = malloc(len);
    if (p) snprintf(p, len, "%s.run%zu", s->output_path, i);
    return p;
}

static void emit_buf_clear(EmitSink *s)
{
    for (size_t i = 0; i < s->buf_len; i++) {
        east_value_release(s->buf[i].key);
        if (s->buf[i].value) east_value_release(s->buf[i].value);
    }
    s->buf_len = 0;
}

static bool emit_buf_push(EmitSink *s, EastValue *key, EastValue *val)
{
    if (s->buf_len == s->buf_cap) {
        size_t cap = s->buf_cap ? s->buf_cap * 2 : 1024;
        EmitPending *grown = realloc(s->buf, cap * sizeof(EmitPending));
        if (!grown) return false;
        s->buf = grown;
        s->buf_cap = cap;
    }
    east_value_retain(key);
    if (val) east_value_retain(val);
    s->buf[s->buf_len].key = key;
    s->buf[s->buf_len].value = val;
    s->buf_len++;
    return true;
}

static bool emit_runs_reserve(EmitSink *s)
{
    if (s->runs_cap > s->num_runs) return true;
    size_t cap = s->runs_cap ? s->runs_cap * 2 : 8;
    char **grown = realloc(s->run_paths, cap * sizeof(char *));
    if (!grown) return false;
    s->run_paths = grown;
    s->runs_cap = cap;
    return true;
}

static int emit_pending_cmp(const void *a, const void *b)
{
    return east_value_compare(((const EmitPending *)a)->key, ((const EmitPending *)b)->key);
}

/* Sorts the pending buffer in East order and checks adjacent duplicates.
 * Returns the offending key (borrowed from the buffer) or NULL. */
static EastValue *emit_sort_pending(EmitSink *s)
{
    qsort(s->buf, s->buf_len, sizeof(EmitPending), emit_pending_cmp);
    for (size_t i = 1; i < s->buf_len; i++) {
        if (east_value_compare(s->buf[i - 1].key, s->buf[i].key) == 0) return s->buf[i].key;
    }
    return NULL;
}

/* Writes the sorted pending buffer as one indexed run file and clears it.
 * Returns 0 on success, 1 on a duplicate (retaining the offending key into
 * *dup_out), 2 on an I/O or allocation failure. */
static int emit_spill(EmitSink *s, EastValue **dup_out)
{
    if (s->buf_len == 0) return 0;
    EastValue *dup = emit_sort_pending(s);
    if (dup) {
        east_value_retain(dup);
        *dup_out = dup;
        return 1;
    }
    if (!emit_runs_reserve(s)) return 2;
    char *path = emit_run_path(s, s->num_runs);
    if (!path) return 2;
    FILE *rf = fopen(path, "wb");
    if (!rf) {
        free(path);
        return 2;
    }
    Beast2StreamWriter *rw =
        east_beast2_writer_new(s->out_type, EAST_BEAST2_CODEC_DEFLATE, true, true);
    bool ok = rw != NULL;
    for (size_t i = 0; ok && i < s->buf_len; i += EMIT_BATCH_CAP) {
        size_t end = i + EMIT_BATCH_CAP < s->buf_len ? i + EMIT_BATCH_CAP : s->buf_len;
        EastValue *chunk = emit_new_batch(s);
        ok = chunk != NULL;
        for (size_t j = i; ok && j < end; j++) {
            if (s->kind == EMIT_DICT)
                east_dict_set(chunk, s->buf[j].key, s->buf[j].value);
            else
                east_set_insert(chunk, s->buf[j].key);
        }
        ok = ok && east_beast2_writer_write(rw, chunk);
        if (chunk) east_value_release(chunk);
        if (ok) {
            ByteBuffer *bb = east_beast2_writer_take(rw);
            if (bb) {
                ok = fwrite(bb->data, 1, bb->len, rf) == bb->len;
                s->spilled_bytes += bb->len;
                byte_buffer_free(bb);
            }
        }
    }
    ok = ok && east_beast2_writer_finish(rw);
    if (ok) {
        ByteBuffer *bb = east_beast2_writer_take(rw);
        if (bb) {
            ok = fwrite(bb->data, 1, bb->len, rf) == bb->len;
            s->spilled_bytes += bb->len;
            byte_buffer_free(bb);
        }
    }
    if (rw) east_beast2_writer_free(rw);
    ok = fclose(rf) == 0 && ok;
    if (!ok) {
        remove(path);
        free(path);
        return 2;
    }
    s->run_paths[s->num_runs++] = path;
    emit_buf_clear(s);
    return 0;
}

/* First out-of-order key: finalize the ascending prefix written so far (a
 * complete canonical beast2 file), demote it to spill run #0, and switch to
 * buffered emission. */
static bool emit_demote_to_runs(EmitSink *s)
{
    if (!emit_flush(s)) return false;
    bool ok = east_beast2_writer_finish(s->writer);
    ok = emit_drain(s) && ok;
    ok = fclose(s->out) == 0 && ok;
    s->out = NULL;
    east_beast2_writer_free(s->writer);
    s->writer = NULL;
    if (!ok) return false;
    if (s->written_elements > 0) {
        if (!emit_runs_reserve(s)) return false;
        char *run0 = emit_run_path(s, 0);
        if (!run0) return false;
        remove(run0); /* Windows rename() refuses an existing destination */
        if (rename(s->output_path, run0) != 0) {
            free(run0);
            return false;
        }
        s->run_paths[s->num_runs++] = run0;
        s->spilled_bytes += s->written_bytes;
    } else {
        /* Header-only prefix: nothing emitted before the inversion. */
        remove(s->output_path);
    }
    s->buffered = true;
    fprintf(stderr,
            "east emit: %s left ascending order at element %zu; establishing canonical "
            "order in the sink (spill/merge)\n",
            s->kind == EMIT_DICT ? "Dict keys" : "Set elements", s->emitted);
    return true;
}

/* One merge cursor: a run's bytes + segment reader + the current decoded
 * segment with an element index into it. */
typedef struct {
    uint8_t *data;
    size_t len;
    Beast2SegmentReader *reader;
    EastValue *segment; /* owned; NULL when exhausted */
    size_t idx;
    size_t seg_len;
} MergeCursor;

/* Advances to the next non-empty segment (or exhaustion). Returns false on
 * a reader error. */
static bool merge_cursor_advance(EmitSink *s, MergeCursor *c)
{
    if (c->segment) {
        east_value_release(c->segment);
        c->segment = NULL;
    }
    for (;;) {
        EastValue *seg = east_beast2_reader_next(c->reader);
        if (!seg) return east_beast2_reader_done(c->reader);
        size_t n = s->kind == EMIT_DICT ? east_dict_len(seg) : east_set_len(seg);
        if (n > 0) {
            c->segment = seg;
            c->idx = 0;
            c->seg_len = n;
            return true;
        }
        east_value_release(seg);
    }
}

static EastValue *merge_cursor_key(EmitSink *s, MergeCursor *c)
{
    return s->kind == EMIT_DICT ? east_dict_key_at(c->segment, c->idx)
                                : east_set_at(c->segment, c->idx);
}

/* K-way merges the spilled runs + the sorted in-memory tail into the
 * canonical output file — O(run cap + one decoded segment per run) memory,
 * with the cross-run duplicate check on the merged stream. On failure the
 * partial output is left unfinalized (no terminator or index), exactly like
 * an error on the straight-through path. */
static bool emit_merge_runs(EmitSink *s)
{
    EastValue *tail_dup = emit_sort_pending(s);
    if (tail_dup) {
        char msg[512];
        emit_duplicate_msg(s, tail_dup, msg, sizeof(msg));
        fprintf(stderr, "Error: %s\n", msg);
        return false;
    }

    size_t k = s->num_runs;
    MergeCursor *cur = calloc(k > 0 ? k : 1, sizeof(MergeCursor));
    bool ok = cur != NULL;
    for (size_t i = 0; ok && i < k; i++) {
        cur[i].data = read_file_binary(s->run_paths[i], &cur[i].len);
        ok = cur[i].data != NULL;
        if (ok) {
            cur[i].reader = east_beast2_reader_new(cur[i].data, cur[i].len, s->out_type);
            ok = cur[i].reader != NULL;
        }
        if (ok) ok = merge_cursor_advance(s, &cur[i]);
    }

    if (ok) {
        s->out = fopen(s->output_path, "wb");
        ok = s->out != NULL;
    }
    if (ok) {
        s->writer = east_beast2_writer_new(s->out_type, EAST_BEAST2_CODEC_DEFLATE, true, true);
        ok = s->writer != NULL && emit_drain(s);
    }

    size_t tail_idx = 0;
    EastValue *prev_key = NULL; /* owned */
    bool duplicate = false;
    while (ok) {
        int min = -1;
        EastValue *min_key = NULL;
        for (size_t i = 0; i < k; i++) {
            if (!cur[i].segment) continue;
            EastValue *ck = merge_cursor_key(s, &cur[i]);
            if (min < 0 || east_value_compare(ck, min_key) < 0) {
                min = (int)i;
                min_key = ck;
            }
        }
        bool from_tail = false;
        if (tail_idx < s->buf_len &&
            (min < 0 || east_value_compare(s->buf[tail_idx].key, min_key) < 0)) {
            from_tail = true;
        }
        if (min < 0 && !from_tail) break;

        EastValue *key, *val = NULL;
        if (from_tail) {
            key = s->buf[tail_idx].key;
            val = s->buf[tail_idx].value;
            tail_idx++;
        } else {
            key = merge_cursor_key(s, &cur[min]);
            if (s->kind == EMIT_DICT) val = east_dict_val_at(cur[min].segment, cur[min].idx);
        }
        if (prev_key && east_value_compare(prev_key, key) == 0) {
            char msg[512];
            emit_duplicate_msg(s, key, msg, sizeof(msg));
            fprintf(stderr, "Error: %s\n", msg);
            duplicate = true;
            ok = false;
            break;
        }
        east_value_retain(key);
        if (prev_key) east_value_release(prev_key);
        prev_key = key;

        if (s->kind == EMIT_DICT)
            east_dict_set(s->batch, key, val);
        else
            east_set_insert(s->batch, key);
        s->batch_count++;
        if (!from_tail) {
            cur[min].idx++;
            if (cur[min].idx >= cur[min].seg_len) ok = merge_cursor_advance(s, &cur[min]);
        }
        if (ok && s->batch_count >= s->next_batch && !emit_flush(s)) ok = false;
    }
    if (ok) ok = emit_flush(s);
    if (ok) {
        ok = east_beast2_writer_finish(s->writer);
        ok = emit_drain(s) && ok;
    }
    if (s->out) {
        ok = fclose(s->out) == 0 && ok;
        s->out = NULL;
    }

    if (prev_key) east_value_release(prev_key);
    for (size_t i = 0; i < k; i++) {
        if (cur[i].segment) east_value_release(cur[i].segment);
        if (cur[i].reader) east_beast2_reader_free(cur[i].reader);
        free(cur[i].data);
    }
    free(cur);
    emit_buf_clear(s);
    if (ok) {
        for (size_t i = 0; i < s->num_runs; i++)
            remove(s->run_paths[i]);
        if (s->verbose) {
            char sz[32];
            format_size((off_t)s->spilled_bytes, sz, sizeof(sz));
            fprintf(stderr, "  emit: merged %zu spilled run(s) + in-memory tail (%s temp)\n",
                    s->num_runs, sz);
        }
    } else if (!duplicate) {
        fprintf(stderr, "Error: emit: failed to merge spilled runs\n");
    }
    return ok;
}

static EvalResult emit_invoke(EastCompiledFn *self, EastValue **args, size_t n_args)
{
    EmitSink *s = (EmitSink *)self->invoke_userdata;
    size_t expected = s->kind == EMIT_DICT ? 2 : 1;
    if (n_args != expected || !args[0] || (expected == 2 && !args[1])) {
        return eval_error("emit called with the wrong number of arguments");
    }
    EastValue *key = args[0];
    if (s->buffered) {
        if (!emit_buf_push(s, key, expected == 2 ? args[1] : NULL)) {
            return eval_error("emit: out of memory buffering out-of-order emission");
        }
        s->emitted++;
        if (s->buf_len >= s->run_cap) {
            EastValue *dup = NULL;
            int rc = emit_spill(s, &dup);
            if (rc == 1) {
                char msg[512];
                emit_duplicate_msg(s, dup, msg, sizeof(msg));
                east_value_release(dup);
                return eval_error(msg);
            }
            if (rc != 0) return eval_error("emit: failed to write a spill run");
        }
        return eval_ok(east_null());
    }
    if (s->kind != EMIT_ARRAY) {
        if (s->last_key) {
            int order = east_value_compare(s->last_key, key);
            if (order == 0) {
                char msg[512];
                emit_duplicate_msg(s, key, msg, sizeof(msg));
                return eval_error(msg);
            }
            if (order > 0) {
                /* Out of order: demote to spill runs and re-enter buffered. */
                if (!emit_demote_to_runs(s)) {
                    return eval_error("emit: failed to demote the output to a spill run");
                }
                return emit_invoke(self, args, n_args);
            }
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
    s->emitted++;
    if (s->batch_count >= s->next_batch && !emit_flush(s)) {
        return eval_error("emit: failed to write output segment");
    }
    return eval_ok(east_null());
}

/* Builds the sink + its output collection type from the emit parameter's
 * function type. Returns NULL with a message on stderr when the shape or
 * output destination is unusable. */
static EmitSink *emit_sink_new(EmitKind kind, EastType *emit_param_type, const char *output_file,
                               bool verbose)
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
    s->output_path = output_file;
    s->verbose = verbose;
    s->next_batch = EMIT_BATCH_CAP;
    s->run_cap = emit_run_elements();
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

/* Fast path: flushes the final batch and the terminator + index, then
 * closes the file. Buffered (out-of-order) path: k-way merges the spilled
 * runs + tail into the canonical output. */
static bool emit_sink_finish(EmitSink *s)
{
    if (s->buffered) return emit_merge_runs(s);
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
    emit_buf_clear(s);
    free(s->buf);
    for (size_t i = 0; i < s->num_runs; i++)
        free(s->run_paths[i]);
    free(s->run_paths);
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
                                  output_file, verbose);
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
    size_t threshold = lazy_input_threshold();
    EastValue **args = NULL;
    bool *lazy_inputs = num_inputs > 0 ? calloc((size_t)num_inputs, sizeof(bool)) : NULL;
    if (num_args > 0) {
        args = calloc(num_args, sizeof(EastValue *));
        for (int i = 0; i < num_inputs; i++) {
            /* The streamed input always opens lazily; other collection
             * inputs open lazily at or above the size threshold. */
            bool want_lazy = i == stream_input;
            if (!want_lazy && threshold > 0) {
                struct stat st;
                want_lazy = stat(input_files[i], &st) == 0 && (size_t)st.st_size >= threshold;
            }
            bool mapped = false;
            args[i] = load_input_value(input_files[i], param_types[i], want_lazy, &mapped);
            if (lazy_inputs) lazy_inputs[i] = mapped;
            if (verbose && mapped) {
#ifdef _WIN32
                fprintf(stderr, "  input %d: opened lazily — read into memory, paged from there\n",
                        i);
#else
                fprintf(stderr, "  input %d: opened lazily — mapped from the file\n", i);
#endif
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
                free(lazy_inputs);
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
        free(lazy_inputs);
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

    /* Cleanup */
    if (result.value) east_value_release(result.value);
    eval_result_free(&result);
    east_compiled_fn_free(fn);
    for (size_t i = 0; i < num_args; i++)
        east_value_release(args[i]);
    free(args);
    free(lazy_inputs);
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
            "  %s run <ir_file> [-p PACKAGE...] [-i FILE...] [-o FILE] [-v] [--snapshot PATH]\n"
            "  %s run --from-snapshot PATH [-o FILE] [-v]\n"
            "  %s convert <in_file> [-o FILE] [--type TYPE] [-v]\n"
            "  %s ir normalize <ir_file> [-o FILE]\n"
            "  %s ir diff <ir_file_a> <ir_file_b> [--raw]\n"
            "  %s ir convert <ir_file> -o FILE\n"
            "  %s version [-p PACKAGE...]\n"
            "\n"
            "Commands:\n"
            "  run      Run an East IR program\n"
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
            "      --emit KIND         Write the output incrementally from the function's\n"
            "                          trailing emit parameter (array|set|dict)\n"
            "      --stream N          Feed the given -i input lazily (0-based index;\n"
            "                          segment-fed iteration, O(segment) decoded memory)\n"
            "      --snapshot PATH     Write a .east-snapshot bundle (IR + inputs + manifest)\n"
            "      --from-snapshot PATH  Replay from a .east-snapshot bundle (exclusive\n"
            "                            with <ir_file>, -i, -p)\n"
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
            /* The manifest carries no streaming flags (format v1), so an emit
             * task's flags must be passed explicitly on replay — forward them. */
            int rc = cmd_run(ex.ir_path, (const char **)ex.packages, (int)ex.num_packages,
                             (const char **)ex.input_paths, (int)ex.num_inputs, output_file,
                             verbose, NULL, emit_kind, stream_input);
            snapshot_extract_free(&ex);
            return rc;
        }

        if (snapshot_out_path && (emit_kind != EMIT_NONE || stream_input >= 0)) {
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
    cli_args args = {argc, argv};
    return east_run_on_large_stack(cli_main, &args);
}
