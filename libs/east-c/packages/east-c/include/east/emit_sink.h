#ifndef EAST_EMIT_SINK_H
#define EAST_EMIT_SINK_H

/*
 * The streaming emit sink behind `run --emit` (issues #507, #770).
 *
 * A body's trailing parameter is a runner-provided function value; each call
 * appends one element (a key/value pair for dict outputs) to the canonical
 * element writer on the output file, in one pass with memory for one open
 * segment. The sink lives in the core library so every runner that embeds
 * east-c — the east-c CLI and east-py — writes the same bytes through the same
 * code.
 *
 * Set and Dict emissions must ascend strictly in East (key) order: segment
 * content is the canonical value split at segment boundaries, and the sink
 * writes each entry through to the file. An out-of-order key ends the
 * emission with an error; a re-keying producer partitions its input and
 * merges the sorted partials instead (east/merge.h), which is the
 * orchestrator's step, never the sink's. Segments fall where the
 * content-defined cut rule places them (src/emit_writer.h), so the file is
 * byte-identical to what every other writer produces for the same value.
 *
 * Duplicate Set/Dict keys are an error unless the sink folds them: with a
 * merge function (dict sinks) an equal key folds into the previous entry,
 * `acc = merge(key, acc, value)`, in emission order; with union mode (set
 * sinks) an equal element collapses into the previous one. The latest entry
 * is held back until the next one arrives (or the sink finishes), so a fold
 * lands in it in place and only settled entries are written: the file is
 * byte-identical to what the non-folding sink writes for the already-folded
 * sequence.
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
    /* The output file (borrowed for the sink's lifetime). */
    const char *output_path;
    /* Dict sinks: fold an equal key into the previous entry,
     * `acc = merge(key, acc, value)` — a compiled `(K, V, V) -> V` over the
     * output's key and value types (borrowed; kept alive by the caller for
     * the sink's lifetime). NULL: equal keys are a duplicate error. */
    EastCompiledFn *merge_fn;
    /* Set sinks: an equal element collapses into the previous one. */
    bool union_mode;
} EastEmitSinkConfig;

typedef struct {
    /* Emissions accepted. */
    size_t emitted;
} EastEmitSinkStats;

typedef struct EastEmitSink EastEmitSink;

/* Opens the output file and builds the sink. NULL with the message posted
 * when the output cannot be written or the configuration is unusable (a
 * merge function on a non-dict sink, union mode on a non-set sink). */
EastEmitSink *east_emit_sink_new(const EastEmitSinkConfig *cfg);

/* The emit capability: a function value of `fn_type` (borrowed; the emit
 * parameter's type — `(K, V) -> Null` for a dict sink, `(E) -> Null`
 * otherwise) whose invoke is the sink's per-row entry. The caller owns the
 * returned value; the sink must outlive it. NULL on allocation failure. */
EastValue *east_emit_sink_function(EastEmitSink *sink, EastType *fn_type);

/* Writes the held entry, then the terminator + index. On failure the
 * output is left unfinalized — no terminator or index — and the message is
 * posted. */
bool east_emit_sink_finish(EastEmitSink *sink);

/* The sink's counters so far. */
void east_emit_sink_stats(const EastEmitSink *sink, EastEmitSinkStats *out);

/* Closes the output and frees the sink, finished or not. NULL-safe. */
void east_emit_sink_free(EastEmitSink *sink);

#endif
