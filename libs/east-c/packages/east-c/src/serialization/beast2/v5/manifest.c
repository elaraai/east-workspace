/*
 * Segment manifests (v5/SPEC.md, "Segment manifests"): the manifest itself,
 * the directory it and its objects sit in, and the writer of both. The pager
 * over a manifest is stream.c's — this file reads and writes the manifest and
 * the directory convention.
 *
 * A manifest names its header and each segment by the SHA-256 of its bytes,
 * the name a store gives an object, so a directory this writes is the one the
 * TypeScript writer writes for the same value, and the one e3 stages.
 */

#include <east/compat.h>

#include "internal_v5.h"

#include <east/file_map.h>
#include <east/sha256.h>
#include <east/type_of_type.h>

#include <errno.h>
#include <stdlib.h>
#include <string.h>

/* The manifest's fields and an entry's, in TypeScript's declaration order —
 * the order a struct encodes in. */
static const char *manifest_fields[6] = {"kind", "level", "type", "rule", "header", "entries"};
static const char *entry_fields[4] = {"hash", "fence", "count", "bytes"};

static EastType *manifest_entry_type(void)
{
    EastType *types[4] = {&east_string_type, &east_blob_type, &east_integer_type,
                          &east_integer_type};
    return east_struct_type(entry_fields, types, 4);
}

EastType *east_beast2_manifest_type(void)
{
    if (!east_type_type) east_type_of_type_init();
    EastType *types[6] = {&east_string_type, &east_integer_type,
                          east_type_type,    &east_string_type,
                          &east_string_type, east_array_type(manifest_entry_type())};
    return east_struct_type(manifest_fields, types, 6);
}

/* Recognized by the exact field set, as TypeScript recognizes it: any struct
 * a user chose flows through the same reads, and a subset match would read one
 * as a manifest. The kind is checked once the value decodes. */
static bool manifest_shaped(const EastType *type)
{
    if (!type || type->kind != EAST_TYPE_STRUCT || type->data.struct_.num_fields != 6) return false;
    for (size_t i = 0; i < 6; i++)
        if (strcmp(type->data.struct_.fields[i].name, manifest_fields[i]) != 0) return false;
    return true;
}

static bool string_is(const EastValue *v, const char *text)
{
    size_t len = strlen(text);
    return v && v->kind == EAST_VAL_STRING && v->data.string.len == len &&
           memcmp(v->data.string.data, text, len) == 0;
}

int east_beast2_read_manifest(const uint8_t *data, size_t len, EastValue **manifest_out)
{
    if (manifest_out) *manifest_out = NULL;
    if (!data || len < 8 || memcmp(data, BEAST2_MAGIC_V5, 8) != 0) return 0;
    size_t offset = 8;
    EastType *root = b2v5_read_type_section(data, len, &offset);
    if (!root) {
        /* A type section that does not read is not a manifest's. */
        free(east_builtin_get_error());
        return 0;
    }
    bool shaped = manifest_shaped(root);
    east_type_release(root);
    if (!shaped) return 0;

    EastValue *manifest = east_beast2_decode_full(data, len, east_beast2_manifest_type());
    if (!manifest) {
        char *specific = east_builtin_get_error();
        east_builtin_error(
            specific ? specific : "beast2 v5: a blob typed as a manifest does not decode as one");
        free(specific);
        return -1;
    }
    /* A struct of the manifest's shape carrying another tag is a different
     * object, never segments. */
    if (!string_is(east_struct_get_field_idx(manifest, 0), EAST_BEAST2_MANIFEST_KIND)) {
        east_value_release(manifest);
        return 0;
    }
    EastValue *level = east_struct_get_field_idx(manifest, 1);
    if (!level || level->kind != EAST_VAL_INTEGER || level->data.integer != 0) {
        east_value_release(manifest);
        east_builtin_error("beast2 v5: the manifest names manifests (a level above 0), which this "
                           "build does not read");
        return -1;
    }
    if (manifest_out)
        *manifest_out = manifest;
    else
        east_value_release(manifest);
    return 1;
}

/* ================================================================== */
/*  Reading a manifest directory                                       */
/* ================================================================== */

typedef struct {
    char *segment_dir;   /* `<manifest path>.segments` */
    EastValue *manifest; /* retained */
} ManifestDir;

/* A name is a SHA-256 in lowercase hex, and nothing else reaches a path. */
static bool sha256_named(const EastValue *hash)
{
    if (!hash || hash->kind != EAST_VAL_STRING || hash->data.string.len != 64) return false;
    for (size_t i = 0; i < 64; i++) {
        char c = hash->data.string.data[i];
        if (!((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f'))) return false;
    }
    return true;
}

/* `<dir>/<hash>.beast2`, allocated; NULL on OOM. */
static char *object_path(const char *dir, const char *hash)
{
    size_t need = strlen(dir) + 1 + 64 + sizeof(".beast2");
    char *path = malloc(need);
    if (path) snprintf(path, need, "%s/%.64s.beast2", dir, hash);
    return path;
}

static bool manifest_dir_open(void *ctx, size_t i, const uint8_t **data, size_t *len, void **handle)
{
    ManifestDir *dir = ctx;
    EastValue *entry = east_array_get(east_struct_get_field_idx(dir->manifest, 5), i);
    EastValue *hash = east_struct_get_field_idx(entry, 0);
    char msg[512];
    if (!sha256_named(hash)) {
        snprintf(msg, sizeof(msg),
                 "beast2 v5: manifest entry %zu does not name its segment by a SHA-256", i);
        east_builtin_error(msg);
        return false;
    }
    char *path = object_path(dir->segment_dir, hash->data.string.data);
    if (!path) {
        east_builtin_error("beast2 v5: out of memory opening a manifest segment");
        return false;
    }
    uint8_t *mapped = map_input_file(path, len, handle);
    if (!mapped) {
        snprintf(msg, sizeof(msg), "beast2 v5: manifest segment %s cannot be read", path);
        east_builtin_error(msg);
        free(path);
        return false;
    }
    free(path);
    *data = mapped;
    return true;
}

static void manifest_dir_close(void *ctx, void *handle, const uint8_t *data, size_t len)
{
    (void)ctx;
    input_release_mapping(handle, (uint8_t *)data, len);
}

static void manifest_dir_free(void *ctx)
{
    ManifestDir *dir = ctx;
    east_value_release(dir->manifest);
    free(dir->segment_dir);
    free(dir);
}

/* The segments of the manifest at `path`, read from `<path>.segments/`. */
static bool manifest_dir_source(const char *path, EastValue *manifest, Beast2SegmentSource *out)
{
    ManifestDir *dir = calloc(1, sizeof(*dir));
    size_t need = strlen(path) + sizeof(".segments");
    char *segment_dir = malloc(need);
    if (!dir || !segment_dir) {
        free(dir);
        free(segment_dir);
        east_builtin_error("beast2 v5: out of memory opening a manifest directory");
        return false;
    }
    snprintf(segment_dir, need, "%s.segments", path);
    dir->segment_dir = segment_dir;
    dir->manifest = manifest;
    east_value_retain(manifest);
    out->ctx = dir;
    out->open = manifest_dir_open;
    out->close = manifest_dir_close;
    out->free = manifest_dir_free;
    return true;
}

EastValue *east_beast2_open_manifest_dir(const char *path, EastValue *manifest, EastType *type,
                                         bool frozen)
{
    Beast2SegmentSource source;
    if (!path || !manifest || !manifest_dir_source(path, manifest, &source)) return NULL;
    return east_beast2_open_paged_manifest(manifest, type, frozen, &source);
}

EastValue *east_beast2_decode_manifest_dir(const char *path, EastValue *manifest, EastType *type,
                                           bool frozen)
{
    Beast2SegmentSource source;
    if (!path || !manifest || !manifest_dir_source(path, manifest, &source)) return NULL;
    return east_beast2_decode_manifest(manifest, type, frozen, &source);
}

/* ================================================================== */
/*  Writing a manifest                                                 */
/* ================================================================== */

/* Where a directory writer puts its files. */
typedef struct {
    char *manifest_path;
    char *segment_dir;
} DirTarget;

struct Beast2ManifestWriter {
    Beast2ElementWriter *writer; /* cuts the segments, handed over one at a time */
    EastType *type;
    Beast2ManifestSink sink;
    char header_hash[EAST_SHA256_HEX_SIZE];
    EastType *entry_type;
    EastValue *entries; /* one entry per segment written, in order */
    DirTarget *dir;     /* a directory writer's files, else NULL */
    bool finished;
    bool failed;
};

static bool manifest_writer_segment(void *ctx, const uint8_t *blob, size_t len, size_t count,
                                    const uint8_t *fence, size_t fence_len)
{
    Beast2ManifestWriter *w = ctx;
    char hash[EAST_SHA256_HEX_SIZE];
    east_sha256_hex(blob, len, hash);
    if (!w->sink.object(w->sink.ctx, hash, blob, len)) return false;
    EastValue *fields[4] = {east_string(hash), east_blob(fence, fence_len),
                            east_integer((int64_t)count), east_integer((int64_t)len)};
    EastValue *entry = east_struct_new_owned(entry_fields, fields, 4, w->entry_type);
    if (!entry) {
        for (int i = 0; i < 4; i++)
            east_value_release(fields[i]);
        east_builtin_error("beast2 v5: out of memory recording a segment");
        return false;
    }
    east_array_push(w->entries, entry);
    east_value_release(entry);
    return true;
}

Beast2ManifestWriter *east_beast2_manifest_writer_new(EastType *type, int32_t codec_id,
                                                      const Beast2ManifestSink *sink)
{
    if (!sink || !sink->object || !sink->manifest) {
        east_builtin_error(
            "beast2 v5: a manifest writer needs a sink for its objects and manifest");
        return NULL;
    }
    Beast2ManifestWriter *w = calloc(1, sizeof(*w));
    if (!w) {
        east_builtin_error("beast2 v5: out of memory building a manifest writer");
        return NULL;
    }
    w->type = type;
    w->sink = *sink;
    w->entry_type = manifest_entry_type();
    w->entries = east_array_new(w->entry_type);
    Beast2SegmentSink segments = {w, manifest_writer_segment};
    w->writer = east_beast2_element_writer_new_segments(type, codec_id, &segments);
    if (!w->entries || !w->writer) {
        east_beast2_manifest_writer_free(w);
        return NULL;
    }
    /* The header first: every segment is written under it, and a manifest
     * of no segments still names it. */
    size_t header_len = 0;
    const uint8_t *header = east_beast2_element_writer_header(w->writer, &header_len);
    east_sha256_hex(header, header_len, w->header_hash);
    if (!w->sink.object(w->sink.ctx, w->header_hash, header, header_len)) {
        east_beast2_manifest_writer_free(w);
        return NULL;
    }
    return w;
}

static bool write_file(const char *path, const uint8_t *bytes, size_t len)
{
    char msg[512];
    FILE *f = fopen(path, "wb");
    if (!f) {
        snprintf(msg, sizeof(msg), "beast2 v5: cannot write %s: %s", path, strerror(errno));
        east_builtin_error(msg);
        return false;
    }
    bool ok = fwrite(bytes, 1, len, f) == len;
    ok = fclose(f) == 0 && ok;
    if (!ok) {
        snprintf(msg, sizeof(msg), "beast2 v5: failed writing %s", path);
        east_builtin_error(msg);
    }
    return ok;
}

static bool dir_object(void *ctx, const char *hash, const uint8_t *bytes, size_t len)
{
    DirTarget *dir = ctx;
    char *path = object_path(dir->segment_dir, hash);
    if (!path) {
        east_builtin_error("beast2 v5: out of memory writing a manifest directory");
        return false;
    }
    bool ok = write_file(path, bytes, len);
    free(path);
    return ok;
}

static bool dir_manifest(void *ctx, const uint8_t *bytes, size_t len)
{
    return write_file(((DirTarget *)ctx)->manifest_path, bytes, len);
}

static void dir_target_free(DirTarget *dir)
{
    if (!dir) return;
    free(dir->manifest_path);
    free(dir->segment_dir);
    free(dir);
}

Beast2ManifestWriter *east_beast2_manifest_writer_new_dir(EastType *type, int32_t codec_id,
                                                          const char *path)
{
    if (!path) {
        east_builtin_error("beast2 v5: a manifest directory needs a path");
        return NULL;
    }
    DirTarget *dir = calloc(1, sizeof(*dir));
    size_t need = strlen(path) + sizeof(".segments");
    if (dir) {
        dir->manifest_path = strdup(path);
        dir->segment_dir = malloc(need);
    }
    if (!dir || !dir->manifest_path || !dir->segment_dir) {
        dir_target_free(dir);
        east_builtin_error("beast2 v5: out of memory writing a manifest directory");
        return NULL;
    }
    snprintf(dir->segment_dir, need, "%s.segments", path);
    if (east_mkdir(dir->segment_dir) != 0 && errno != EEXIST) {
        char msg[512];
        snprintf(msg, sizeof(msg), "beast2 v5: cannot create %s: %s", dir->segment_dir,
                 strerror(errno));
        east_builtin_error(msg);
        dir_target_free(dir);
        return NULL;
    }
    Beast2ManifestSink sink = {dir, dir_object, dir_manifest};
    Beast2ManifestWriter *w = east_beast2_manifest_writer_new(type, codec_id, &sink);
    if (!w) {
        dir_target_free(dir);
        return NULL;
    }
    w->dir = dir;
    return w;
}

bool east_beast2_manifest_writer_add(Beast2ManifestWriter *w, EastValue *element)
{
    return w && east_beast2_element_writer_add(w->writer, element);
}

bool east_beast2_manifest_writer_add_pair(Beast2ManifestWriter *w, EastValue *key, EastValue *value)
{
    return w && east_beast2_element_writer_add_pair(w->writer, key, value);
}

bool east_beast2_manifest_writer_add_encoded(Beast2ManifestWriter *w, const uint8_t *element,
                                             size_t len, size_t key_len)
{
    return w && east_beast2_element_writer_add_encoded(w->writer, element, len, key_len);
}

bool east_beast2_manifest_writer_finish(Beast2ManifestWriter *w)
{
    if (!w) return false;
    if (w->finished) return !w->failed;
    w->finished = true;
    if (!east_beast2_element_writer_finish(w->writer)) {
        w->failed = true;
        return false;
    }
    EastType *manifest_type = east_beast2_manifest_type();
    const char *rule = w->type->kind == EAST_TYPE_ARRAY ? EAST_BEAST2_SEGMENT_RULE_ARRAY
                                                        : EAST_BEAST2_SEGMENT_RULE_KEYED;
    east_value_retain(w->entries); /* the manifest takes this reference */
    EastValue *fields[6] = {east_string(EAST_BEAST2_MANIFEST_KIND),
                            east_integer(0),
                            east_type_to_value(w->type),
                            east_string(rule),
                            east_string(w->header_hash),
                            w->entries};
    EastValue *manifest = east_struct_new_owned(manifest_fields, fields, 6, manifest_type);
    if (!manifest) {
        for (int i = 0; i < 6; i++)
            east_value_release(fields[i]);
        east_builtin_error("beast2 v5: out of memory writing a manifest");
        w->failed = true;
        return false;
    }
    ByteBuffer *bytes = east_beast2_encode_full(manifest, manifest_type);
    east_value_release(manifest);
    bool ok = bytes && w->sink.manifest(w->sink.ctx, bytes->data, bytes->len);
    byte_buffer_free(bytes);
    if (!ok) w->failed = true;
    return ok;
}

size_t east_beast2_manifest_writer_segments(const Beast2ManifestWriter *w)
{
    return w ? east_beast2_element_writer_segments(w->writer) : 0;
}

void east_beast2_manifest_writer_free(Beast2ManifestWriter *w)
{
    if (!w) return;
    east_beast2_element_writer_free(w->writer);
    if (w->entries) east_value_release(w->entries);
    dir_target_free(w->dir);
    free(w);
}

bool east_beast2_write_manifest_dir(EastValue *value, EastType *type, int32_t codec_id,
                                    const char *path)
{
    if (!value || !type) return false;
    if (!b2v5_is_segmented_root(type)) {
        east_builtin_error("beast2 v5: a manifest holds an Array, Set or Dict value");
        return false;
    }
    Beast2ManifestWriter *w = east_beast2_manifest_writer_new_dir(type, codec_id, path);
    if (!w) return false;
    bool ok = true;
    switch (type->kind) {
    case EAST_TYPE_ARRAY:
        for (size_t i = 0; ok && i < value->data.array.len; i++)
            ok = east_beast2_manifest_writer_add(w, value->data.array.items[i]);
        break;
    case EAST_TYPE_SET:
        for (size_t i = 0; ok && i < value->data.set.len; i++)
            ok = east_beast2_manifest_writer_add(w, east_set_at(value, i));
        break;
    default:
        for (size_t i = 0; ok && i < value->data.dict.len; i++)
            ok = east_beast2_manifest_writer_add_pair(w, east_dict_key_at(value, i),
                                                      east_dict_val_at(value, i));
        break;
    }
    if (ok) ok = east_beast2_manifest_writer_finish(w);
    east_beast2_manifest_writer_free(w);
    return ok;
}
