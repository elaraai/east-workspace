#ifndef EAST_EMIT_WRITER_H
#define EAST_EMIT_WRITER_H

/*
 * The output side shared by the emit sink (emit_sink.c) and the blob merge
 * (merge.c): a streaming beast2 v5 writer on a file — indexed, self-contained,
 * deflating frames on the writer's pool (#763) — whose segments fall exactly
 * where the paged encoder puts them, so one value segments the same wherever
 * it is written (#770).
 *
 * Where that is depends on the root. A Set or Dict is cut by the pinned
 * content-defined rule (B2V5Cutter): a segment starts at the element whose key
 * hashes into the pattern, so the cut depends only on the keys and every
 * runtime agrees on it. An Array has no key to hash and is batched toward
 * EMIT_TARGET_BYTES of wire per segment from the bytes written so far, capped
 * at EMIT_BATCH_CAP elements, the header left out of the average
 * (east_beast2_paged_next_batch).
 *
 * Internal to the library; the public surfaces are east/emit_sink.h and
 * east/merge.h.
 */

#include <east/serialization.h>

#include "serialization/beast2/v5/internal_v5.h"

#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>

/* The element cap, the byte target of one segment, and the elements the
 * opening probe measures — the paged encoder's three, so the segmentation
 * matches it element for element. */
#define EMIT_BATCH_CAP 1000
#define EMIT_TARGET_BYTES (2u * 1024u * 1024u)
#define EMIT_PROBE_BATCH 16

typedef struct {
    FILE *out;
    Beast2StreamWriter *writer;
    EastType *type;          /* borrowed: the output collection type */
    size_t header;           /* the writer's emitted total at creation: the header's bytes */
    size_t written_elements; /* elements in the segments written so far */
    size_t next_batch;       /* elements the next segment should hold (Array) */
    bool probed;             /* the opening probe has sized next_batch (Array) */
    B2V5Cutter cutter;       /* the content rule; `key_type` NULL for an Array */
} EmitWriter;

/* Opens `path` for writing and a writer of `type` on it. False with the
 * message posted (east_builtin_error); the struct is then closed. */
bool emit_writer_open(EmitWriter *w, EastType *type, const char *path);

/* One segment from a batch value of the collection type holding `n`
 * elements, drained to the file; refines the next batch for an Array. False
 * with the message posted. */
bool emit_writer_write(EmitWriter *w, EastValue *batch, size_t n);

/* Whether the arriving entry starts a new segment, so the open batch of
 * `batch_count` entries must go out first. `key` is the Dict key or the Set
 * element; for an Array it is unused and the open batch's size decides.
 * Called once per entry that is not folding into the last one, so a keyed
 * output's cutter sees each distinct key exactly once. */
bool emit_writer_starts_segment(EmitWriter *w, EastValue *key, size_t batch_count);

/* Seeds the batch size from a throwaway encode of the first EMIT_PROBE_BATCH
 * entries — the probe the paged encoder runs, over the same count, so one
 * value segments the same whether it was returned or emitted. A no-op for a
 * keyed output, whose boundaries come from the keys. Call it after
 * each append; it does nothing until the batch reaches the probe count, and
 * nothing thereafter. When the probe sizes segments below what is already
 * held, those entries go out in refined-size segments and `*batch`/`*count`
 * are replaced with the remainder (which always keeps the last entry, so a
 * fold still lands in the open batch). False with the message posted. */
bool emit_writer_probe(EmitWriter *w, EastValue **batch, size_t *count);

/* The terminator and index, the last bytes to the file, and the close. False
 * with the message posted; the file is then unfinalised. */
bool emit_writer_finish(EmitWriter *w);

/* Releases whatever is still open, finished or not. Safe on a zeroed struct
 * and after emit_writer_finish. */
void emit_writer_close(EmitWriter *w);

#endif
