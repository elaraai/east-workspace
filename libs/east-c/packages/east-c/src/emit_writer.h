#ifndef EAST_EMIT_WRITER_H
#define EAST_EMIT_WRITER_H

/*
 * The output side shared by the emit sink (emit_sink.c) and the blob merge
 * (merge.c): a streaming beast2 v5 writer on a file — indexed, self-contained,
 * deflating frames on the writer's pool (#763) — whose segments are sized by
 * the paged encoder's refinement: toward EMIT_TARGET_BYTES of wire per segment
 * from the bytes written so far, capped at EMIT_BATCH_CAP elements, the header
 * left out of the average (east_beast2_paged_next_batch). Every writer of a
 * collection blob sizes its segments this way, here and in TypeScript, so one
 * value segments the same wherever it is written (#770).
 *
 * Internal to the library; the public surfaces are east/emit_sink.h and
 * east/merge.h.
 */

#include <east/serialization.h>

#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>

/* The element cap and the byte target of one segment. */
#define EMIT_BATCH_CAP 1000
#define EMIT_TARGET_BYTES (2u * 1024u * 1024u)

typedef struct {
    FILE *out;
    Beast2StreamWriter *writer;
    size_t header;           /* the writer's emitted total at creation: the header's bytes */
    size_t written_elements; /* elements in the segments written so far */
    size_t next_batch;       /* elements the next segment should hold */
} EmitWriter;

/* Opens `path` for writing and a writer of `type` on it. False with the
 * message posted (east_builtin_error); the struct is then closed. */
bool emit_writer_open(EmitWriter *w, EastType *type, const char *path);

/* One segment from a batch value of the collection type holding `n`
 * elements, drained to the file; refines the next batch. False with the
 * message posted. */
bool emit_writer_write(EmitWriter *w, EastValue *batch, size_t n);

/* The terminator and index, the last bytes to the file, and the close. False
 * with the message posted; the file is then unfinalised. */
bool emit_writer_finish(EmitWriter *w);

/* Releases whatever is still open, finished or not. Safe on a zeroed struct
 * and after emit_writer_finish. */
void emit_writer_close(EmitWriter *w);

#endif
