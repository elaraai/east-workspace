#ifndef EAST_MERGE_H
#define EAST_MERGE_H

/*
 * The blob merge behind `merge` (issue #770).
 *
 * Canonical Set or Dict blobs of one type in — sorted, indexed beast2 v5
 * collections, as every runner writes them — and one canonical blob out, in
 * a single pass: every input is read segment by segment through a mapping,
 * a heap over the inputs' current entries yields keys in East order, and the
 * output is written through the same segment writer as `run --emit`, so the
 * file is byte-identical to what that sink writes for the same entries
 * emitted ascending. Memory is one decoded segment per input plus one output
 * segment; no temporary file is ever written.
 *
 * Equal keys across inputs fold in input order: with a merge function (Dict
 * inputs) `acc = merge(key, acc, value)`; in union mode (Set inputs) the
 * first element stands. Without a fold, an equal key is the duplicate error
 * the emit sink raises. An input whose keys do not ascend, an input whose
 * type is not input 0's, and an Array input are refused.
 *
 * This is the fan-in of a partitioned task's keyed partials: e3 runs it as an
 * ordinary execution on the task's runner, one unit per group of partials,
 * and never decodes a partial itself. The sink lives in the core library so
 * the east-c CLI and east-py merge through the same code.
 *
 * Errors are posted through east_builtin_error; a failed merge leaves the
 * output unfinalised (no terminator or index).
 */

#include "compiler.h"
#include "types.h"

#include <stdbool.h>
#include <stddef.h>

typedef struct {
    /* The inputs, in the order equal keys fold; at least one. */
    const char *const *input_paths;
    size_t num_inputs;
    /* The output file. */
    const char *output_path;
    /* Dict inputs: fold an equal key, `acc = merge(key, acc, value)` — a
     * compiled `(K, V, V) -> V` over the inputs' key and value types
     * (borrowed; kept alive by the caller for the merge). NULL: equal keys
     * are a duplicate error. */
    EastCompiledFn *merge_fn;
    /* Set inputs: the first of equal elements stands. */
    bool union_mode;
} EastMergeConfig;

typedef struct {
    /* Inputs merged. */
    size_t inputs;
    /* Entries written to the output. */
    size_t entries;
    /* Equal keys folded (merge) or collapsed (union). */
    size_t folds;
} EastMergeStats;

/* Merges the inputs into the output. False with the message posted. */
bool east_merge_blobs(const EastMergeConfig *cfg, EastMergeStats *stats_out);

#endif
