/*
 * The segment writer shared by the emit sink and the blob merge — see
 * emit_writer.h.
 */

#include <east/compat.h>

#include "emit_writer.h"

#include <east/builtins.h>

#include <stdlib.h>
#include <string.h>

/* Moves the bytes the writer has produced to the file. */
static bool emit_writer_drain(EmitWriter *w)
{
    ByteBuffer *buf = east_beast2_writer_take(w->writer);
    if (!buf) return true;
    size_t wrote = fwrite(buf->data, 1, buf->len, w->out);
    bool ok = wrote == buf->len;
    byte_buffer_free(buf);
    if (!ok) east_builtin_error("emit: failed to write the output file");
    return ok;
}

/* After a segment of `n` elements landed: the running average wire size of
 * an element — the header left out — refines the next batch toward the byte
 * target. Frames may still be deflating on the writer's pool, so the byte
 * count is known only within bounds; the refinement is monotone in it, so
 * agreeing decisions at both bounds are the serial decision, and disagreeing
 * ones wait for the frames. The segmentation, and every byte, is what a
 * serial writer produces. */
static void emit_writer_refine(EmitWriter *w, size_t n)
{
    w->written_elements += n;
    size_t lo, hi;
    east_beast2_writer_emitted_bounds(w->writer, &lo, &hi);
    size_t at_lo =
        east_beast2_paged_next_batch(EMIT_TARGET_BYTES, lo - w->header, w->written_elements);
    size_t at_hi =
        east_beast2_paged_next_batch(EMIT_TARGET_BYTES, hi - w->header, w->written_elements);
    if (at_lo != at_hi) {
        east_beast2_writer_settle(w->writer);
        east_beast2_writer_emitted_bounds(w->writer, &lo, &hi);
        at_lo =
            east_beast2_paged_next_batch(EMIT_TARGET_BYTES, lo - w->header, w->written_elements);
    }
    w->next_batch = at_lo;
}

bool emit_writer_open(EmitWriter *w, EastType *type, const char *path)
{
    memset(w, 0, sizeof(*w));
    w->out = fopen(path, "wb");
    if (!w->out) {
        char msg[1024];
        snprintf(msg, sizeof(msg), "Cannot write file: %s", path);
        east_builtin_error(msg);
        return false;
    }
    w->writer = east_beast2_writer_new(type, EAST_BEAST2_CODEC_DEFLATE, true, true);
    if (!w->writer) {
        fclose(w->out);
        w->out = NULL;
        east_builtin_error("emit: failed to construct the output writer");
        return false;
    }
    /* Frames deflate on worker threads (#763); emit_writer_refine reads the
     * byte count through the writer's bounds, so the output is byte-identical
     * to a serial writer's. */
    east_beast2_writer_set_parallel(w->writer, true);
    size_t lo, hi;
    east_beast2_writer_emitted_bounds(w->writer, &lo, &hi);
    w->header = lo;
    w->next_batch = EMIT_BATCH_CAP;
    return true;
}

bool emit_writer_write(EmitWriter *w, EastValue *batch, size_t n)
{
    if (n == 0) return true;
    if (!east_beast2_writer_write(w->writer, batch)) return false;
    if (!emit_writer_drain(w)) return false;
    emit_writer_refine(w, n);
    return true;
}

bool emit_writer_write_raw(EmitWriter *w, const uint8_t *entries, size_t len, size_t n,
                           EastValue *first_key, EastValue *last_key)
{
    if (n == 0) return true;
    if (!east_beast2_writer_write_raw(w->writer, entries, len, n, first_key, last_key))
        return false;
    if (!emit_writer_drain(w)) return false;
    emit_writer_refine(w, n);
    return true;
}

bool emit_writer_finish(EmitWriter *w)
{
    bool ok = east_beast2_writer_finish(w->writer);
    ok = emit_writer_drain(w) && ok;
    ok = fclose(w->out) == 0 && ok;
    w->out = NULL;
    if (!ok) east_builtin_error("emit: failed to write the output");
    return ok;
}

void emit_writer_close(EmitWriter *w)
{
    if (w->out) fclose(w->out);
    if (w->writer) east_beast2_writer_free(w->writer);
    memset(w, 0, sizeof(*w));
}
