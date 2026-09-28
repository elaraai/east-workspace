/*
 * The blob merge's segment writer — see emit_writer.h.
 */

#include <east/compat.h>

#include "emit_writer.h"

#include <east/builtins.h>

#include <stdlib.h>
#include <string.h>

/* Moves the bytes the writer has produced to the file. */
static bool emit_writer_drain(EmitWriter *w)
{
    ByteBuffer *buf = east_beast2_element_writer_take(w->writer);
    if (!buf) return true;
    size_t wrote = fwrite(buf->data, 1, buf->len, w->out);
    bool ok = wrote == buf->len;
    byte_buffer_free(buf);
    if (!ok) east_builtin_error("emit: failed to write the output file");
    return ok;
}

/* Writes the held entry through the element writer and lets it go. The file
 * takes the writer's bytes whenever a segment closes, so what waits in the
 * writer is the frames still deflating. */
static bool emit_writer_settle(EmitWriter *w)
{
    if (!w->key) return true;
    if (w->manifest) {
        /* A manifest directory takes each segment as a file as it closes. */
        bool ok = w->type->kind == EAST_TYPE_DICT
                      ? east_beast2_manifest_writer_add_pair(w->manifest, w->key, w->value)
                      : east_beast2_manifest_writer_add(w->manifest, w->key);
        east_value_release(w->key);
        if (w->value) east_value_release(w->value);
        w->key = NULL;
        w->value = NULL;
        return ok;
    }
    size_t before = east_beast2_element_writer_segments(w->writer);
    bool ok = w->type->kind == EAST_TYPE_DICT
                  ? east_beast2_element_writer_add_pair(w->writer, w->key, w->value)
                  : east_beast2_element_writer_add(w->writer, w->key);
    east_value_release(w->key);
    if (w->value) east_value_release(w->value);
    w->key = NULL;
    w->value = NULL;
    if (!ok) return false;
    return east_beast2_element_writer_segments(w->writer) == before || emit_writer_drain(w);
}

bool emit_writer_open(EmitWriter *w, EastType *type, const char *path)
{
    memset(w, 0, sizeof(*w));
    w->type = type;
    w->out = fopen(path, "wb");
    if (!w->out) {
        char msg[1024];
        snprintf(msg, sizeof(msg), "Cannot write file: %s", path);
        east_builtin_error(msg);
        return false;
    }
    w->writer = east_beast2_element_writer_new(type, EAST_BEAST2_CODEC_DEFLATE);
    if (!w->writer) {
        fclose(w->out);
        w->out = NULL;
        east_builtin_error("emit: failed to construct the output writer");
        return false;
    }
    /* Frames deflate on worker threads (#763); where the segments fall never
     * depends on it. */
    east_beast2_element_writer_set_parallel(w->writer, true);
    return true;
}

bool emit_writer_open_manifest(EmitWriter *w, EastType *type, const char *path)
{
    memset(w, 0, sizeof(*w));
    w->type = type;
    w->manifest = east_beast2_manifest_writer_new_dir(type, EAST_BEAST2_CODEC_DEFLATE, path);
    if (!w->manifest) return false;
    /* Frames deflate on worker threads, as for a blob. */
    east_beast2_manifest_writer_set_parallel(w->manifest, true);
    return true;
}

bool emit_writer_push(EmitWriter *w, EastValue *key, EastValue *value)
{
    if (!emit_writer_settle(w)) return false;
    east_value_retain(key);
    w->key = key;
    if (value) {
        east_value_retain(value);
        w->value = value;
    }
    return true;
}

bool emit_writer_finish(EmitWriter *w)
{
    if (w->manifest)
        return emit_writer_settle(w) && east_beast2_manifest_writer_finish(w->manifest);
    bool ok = emit_writer_settle(w) && east_beast2_element_writer_finish(w->writer);
    ok = emit_writer_drain(w) && ok;
    ok = fclose(w->out) == 0 && ok;
    w->out = NULL;
    if (!ok) east_builtin_error("emit: failed to write the output");
    return ok;
}

void emit_writer_close(EmitWriter *w)
{
    if (w->out) fclose(w->out);
    if (w->writer) east_beast2_element_writer_free(w->writer);
    if (w->manifest) east_beast2_manifest_writer_free(w->manifest);
    if (w->key) east_value_release(w->key);
    if (w->value) east_value_release(w->value);
    memset(w, 0, sizeof(*w));
}
