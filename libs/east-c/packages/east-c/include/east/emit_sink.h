#ifndef EAST_EMIT_SINK_H
#define EAST_EMIT_SINK_H

/*
 * The streaming emit sink behind `run --emit` (issues #507, #518).
 *
 * A body's trailing parameter is a runner-provided function value; each call
 * appends one element (a key/value pair for dict outputs) to a streaming
 * beast2 v5 writer on the output file. The sink lives in the core library so
 * every runner that embeds east-c — the east-c CLI and east-py — writes the
 * same bytes through the same code.
 *
 * Emission order is unconstrained. While Set/Dict emissions stay strictly
 * ascending in East (key) order, segments stream straight to the output file
 * — O(batch) memory, byte-identical to an always-ascending producer. On the
 * first out-of-order key the file written so far is finalized (a complete
 * canonical beast2 file of the prefix) and demoted to spill run #0; from then
 * on every emission is encoded into a byte arena as it arrives, its value
 * released at once, and only its key kept for ordering. A run is that entry
 * table sorted by key and written raw beside the output as
 * `varint(key_len) key varint(val_len) value` records — the sink's own
 * temporary format, not beast2 — up to the run cap entries per run. The finish
 * k-way merges the runs and the in-memory tail into the canonical output
 * decoding KEYS only: value bytes are copied straight into the output
 * segments, never decoded or re-encoded, and the final write is the only
 * deflate. Duplicate Set/Dict keys are a hard error in every path: immediately
 * when adjacent in the stream, at spill/merge time otherwise.
 *
 * Errors are posted through east_builtin_error: a failed east_emit_sink_new or
 * east_emit_sink_finish leaves the message for east_builtin_get_error, and the
 * per-row entry returns it as the call's evaluation error.
 */

#include "compiler.h"
#include "types.h"
#include "values.h"

#include <stdbool.h>
#include <stddef.h>

typedef enum {
    EAST_EMIT_ARRAY = 0,
    EAST_EMIT_SET = 1,
    EAST_EMIT_DICT = 2,
} EastEmitKind;

typedef struct {
    EastEmitKind kind;
    /* The output collection type (borrowed; kept alive by the caller for the
     * sink's lifetime): Array<E>, Set<E> or Dict<K, V> of the kind. */
    EastType *out_type;
    /* The output file (borrowed for the sink's lifetime). Spill runs are
     * written beside it as `<output_path>.run<N>`. */
    const char *output_path;
    /* Collect the spill/merge timings reported by east_emit_sink_stats. */
    bool verbose;
    /* Spill once this many out-of-order entries are buffered; 0 reads
     * EAST_EMIT_RUN_ELEMENTS (digits only, at least 1), else 100,000. */
    size_t run_elements;
} EastEmitSinkConfig;

typedef struct {
    /* Emissions accepted. */
    size_t emitted;
    /* Whether emission left ascending order (the spill/merge path ran). */
    bool buffered;
    /* Runs merged by the finish, the demoted prefix included. */
    size_t runs;
    /* Runs written by spilling. */
    size_t spills;
    /* The most entries, and the most encoded entry bytes, held at once. */
    size_t peak_entries;
    size_t peak_bytes;
    /* Bytes written to temporary runs, the demoted prefix included. */
    size_t spilled_bytes;
    /* Milliseconds spent spilling and merging (0 unless `verbose`). */
    double spill_ms;
    double merge_ms;
} EastEmitSinkStats;

typedef struct EastEmitSink EastEmitSink;

/* Opens the output file and builds the sink. NULL with the message posted
 * when the output cannot be written or the configuration is unusable. */
EastEmitSink *east_emit_sink_new(const EastEmitSinkConfig *cfg);

/* The emit capability: a function value of `fn_type` (borrowed; the emit
 * parameter's type — `(K, V) -> Null` for a dict sink, `(E) -> Null`
 * otherwise) whose invoke is the sink's per-row entry. The caller owns the
 * returned value; the sink must outlive it. NULL on allocation failure. */
EastValue *east_emit_sink_function(EastEmitSink *sink, EastType *fn_type);

/* Flushes the final batch and writes the terminator + index (ascending path),
 * or merges the spilled runs and the tail into the canonical output (buffered
 * path). On failure the output is left unfinalized — no terminator or index —
 * and the message is posted. Removes the spill runs on success. */
bool east_emit_sink_finish(EastEmitSink *sink);

/* The sink's counters so far. */
void east_emit_sink_stats(const EastEmitSink *sink, EastEmitSinkStats *out);

/* Closes the output and frees the sink, finished or not. NULL-safe. */
void east_emit_sink_free(EastEmitSink *sink);

#endif
