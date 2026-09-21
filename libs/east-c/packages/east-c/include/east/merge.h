#ifndef EAST_MERGE_H
#define EAST_MERGE_H

/*
 * The blob merge behind `merge` (issue #770).
 *
 * Canonical Set or Dict blobs of one type in — sorted, indexed beast2 v5
 * collections, as every runner writes them — and one canonical blob out, in
 * a single pass: every input is read segment by segment through a mapping,
 * a heap over the inputs' current entries yields keys in East order, and the
 * merged entries are written as VALUES through the very call `run --emit`
 * writes its batches through (emit_writer_write), so the file is
 * byte-identical to what that sink writes for the same entries emitted
 * ascending — including the beast2 aliasing, which is scoped per output
 * segment there and so is scoped per output segment here. Writing
 * pre-encoded entries instead, each under its own scope, wrote a container
 * two entries of one segment share as two copies: a different blob, a
 * different hash, and a merge that disagreed with its own sink. Memory is
 * one decoded segment per input plus one open batch; no temporary file is
 * ever written.
 *
 * Equal keys across inputs fold in input order: with a merge function (Dict
 * inputs) `acc = merge(key, acc, value)`; in union mode (Set inputs) the
 * first element stands. Without a fold, an equal key is the duplicate error
 * the emit sink raises. An input whose keys do not ascend, an input whose
 * type is not input 0's, and an Array input are refused.
 *
 * With a key range (`range_path`, a blob of `Struct{from: Option<K>, to:
 * Option<K>}` over the inputs' key type) only the keys in `[from, to)`
 * merge: every input is sought to the segment owning `from` through its
 * fences and read up to the first key at or past `to`, so a unit over a
 * range of a large output reads that range's share of each input, plus at
 * most one segment. An absent bound is open; both absent is the whole merge.
 *
 * This is the fan-in of a partitioned task's keyed partials: e3 runs it as an
 * ordinary execution on the task's runner, one unit per key range of a group
 * of partials, and never decodes a partial itself. The sink lives in the core
 * library so the east-c CLI and east-py merge through the same code.
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
    /* The keys to merge, `[from, to)`: a beast2 blob of `Struct{from:
     * Option<K>, to: Option<K>}` over the inputs' key type, an absent bound
     * open. NULL: the whole inputs. */
    const char *range_path;
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
