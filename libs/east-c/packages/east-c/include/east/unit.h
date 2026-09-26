#ifndef EAST_UNIT_H
#define EAST_UNIT_H

/*
 * The runner protocol: the unit a runner's `exec` executes, and the result it
 * reports — the C side of TypeScript's runner_protocol.ts. The east-c CLI and
 * east-py read units and write results through this, and write a running
 * program's output through its sink, so the two write the same bytes.
 *
 * A unit runs a program on its inputs, or merges the parts of one output that
 * earlier units wrote, and names where its output and its result go. The
 * output is written by its kind:
 *
 *   value  the program's result: a collection as a manifest directory at the
 *          path, anything else as one blob;
 *   array  elements emitted in order, through the Writer, as the manifest
 *          directory <dir>/0.beast2;
 *   set    elements emitted in any order, through the RunSorter, as sorted
 *          runs, each the manifest directory <dir>/<n>.beast2 — numbered from
 *          0 in the order they close — with equal elements collapsed;
 *   dict   entries emitted in any order, as runs like a set's, equal keys
 *          folded with the merge function in the order they were emitted, or
 *          without one refused;
 *   fold   every emitted value folded into an accumulator that starts at
 *          zero, written as a value is.
 *
 * Every kind but a value is emitted through the program's trailing parameter,
 * whose type the kind fixes: (T) -> Null, or (K, V) -> Null for a dict.
 *
 * Errors are posted through east_builtin_error.
 */

#include "compiler.h"
#include "types.h"
#include "values.h"

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

/* The unit's type and the result's, as TypeScript declares UnitType and
 * UnitResultType. Interned, like every constructed type. */
EastType *east_unit_type(void);
EastType *east_unit_result_type(void);

typedef enum {
    EAST_UNIT_VALUE,
    EAST_UNIT_ARRAY,
    EAST_UNIT_SET,
    EAST_UNIT_DICT,
    EAST_UNIT_FOLD,
} EastUnitOutputKind;

/* Where a unit's output goes. Paths are resolved: see east_unit_read. */
typedef struct {
    EastUnitOutputKind kind;
    char *path;    /* value and fold: the file; array, set and dict: the directory */
    char *merge;   /* dict: the (K, V, V) -> V function's IR file, or NULL */
    char *zero;    /* fold: the file holding the accumulator's start */
    char *combine; /* fold: the (T, T) -> T function's IR file */
} EastUnitOutput;

typedef struct {
    bool merge;    /* false: run `program` on `inputs`; true: merge `inputs` as parts */
    char *program; /* run: the program's IR file */
    char **inputs; /* run: one file per parameter; merge: the parts, in order */
    size_t num_inputs;
    char *range; /* merge: the key-range file, or NULL */
    EastUnitOutput output;
    char **platforms; /* the platform packages, as the runner names them */
    size_t num_platforms;
    int64_t threads; /* the threads the runner may use, its own pools included */
    char *result;    /* where the result goes */
} EastUnit;

/* Reads the unit file at `path`. Every path the unit names is resolved: a
 * relative one against the unit file's directory, so a unit and the files it
 * names move together. NULL with the message posted. */
EastUnit *east_unit_read(const char *path);
void east_unit_free(EastUnit *unit);

/* One source location of a failure. */
typedef struct {
    const char *filename;
    int64_t line;
    int64_t column;
} EastUnitLocation;

/* What a runner reports for a unit. */
typedef struct {
    bool ok;
    const char *message;               /* a failure's message */
    const EastUnitLocation *locations; /* a failure's source locations, innermost first */
    size_t num_locations;
    uint64_t peak_bytes; /* the process's peak resident memory */
    double load_ms, compile_ms, execute_ms, output_ms;
} EastUnitResult;

/* Writes a result to `path`. False with the message posted. */
bool east_unit_write_result(const char *path, const EastUnitResult *result);

/* Writes a value output: a collection as a manifest directory at `path`,
 * anything else as one blob there. A paged value is read whole first. False
 * with the message posted. */
bool east_unit_write_value(const char *path, EastValue *value, EastType *type);

/* Where a running program's output goes. */
typedef struct EastUnitSink EastUnitSink;

/* Opens a running program's output. `type` is the program's result type for a
 * value, and its emit parameter's type for every other kind. `merge_fn` (a
 * dict's) and `combine_fn` (a fold's) are borrowed and must outlive the sink;
 * `zero` (a fold's) is retained. NULL with the message posted: an emit
 * parameter or function that does not fit the kind, or an output directory
 * that holds anything already. */
EastUnitSink *east_unit_sink_new(const EastUnitOutput *output, EastType *type,
                                 EastCompiledFn *merge_fn, EastCompiledFn *combine_fn,
                                 EastValue *zero);

/* The emit capability: a function value of `fn_type` (borrowed; the emit
 * parameter's type) whose invoke writes the output. NULL for a value output,
 * which the program returns. The caller owns the returned value; the sink must
 * outlive it. */
EastValue *east_unit_sink_function(EastUnitSink *sink, EastType *fn_type);

/* Writes the output: the program's `result` for a value output — ignored
 * otherwise — and for the rest whatever is still open. False with the message
 * posted; a directory of runs or a manifest is then left without its
 * manifest, so nothing reads it as complete. */
bool east_unit_sink_finish(EastUnitSink *sink, EastValue *result);

/* Frees the sink, finished or not. NULL-safe. */
void east_unit_sink_free(EastUnitSink *sink);

/* A merge unit's set or dict parts merged into one run, <dir>/0.beast2: a key
 * several parts hold collapses (a set) or folds with `merge_fn` (a dict; NULL
 * refuses it), in part order, over the unit's key range when it has one. The
 * output directory must hold nothing yet. False with the message posted. */
bool east_unit_merge_runs(const EastUnit *unit, EastCompiledFn *merge_fn);

#endif
