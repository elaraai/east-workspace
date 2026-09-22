/*
 * The streaming emit sink behind `run --emit` — see include/east/emit_sink.h
 * for the contract. Shared by the east-c CLI and east-py, so both write the
 * same bytes for the same emissions.
 */

#include <east/compat.h>
#include <east/emit_sink.h>

#include <east/builtins.h>
#include <east/compiler.h>
#include <east/serialization.h>

#include "emit_writer.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

struct EastEmitSink {
    EmitWriter out;
    EastType *out_type; /* borrowed: the output collection type */
    EastEmitKind kind;
    EastCompiledFn *merge_fn; /* borrowed: folds an equal dict key, or NULL */
    bool union_mode;          /* an equal set element collapses into the previous one */
    EastValue *batch;         /* owned accumulator of the collection kind */
    EastValue *last_key;      /* owned: the previous key/element, for the ascent check */
    size_t batch_count;
    size_t emitted;
};

typedef struct EastEmitSink EmitSink;

static EastValue *emit_new_batch(EmitSink *s)
{
    switch (s->kind) {
    case EAST_EMIT_ARRAY:
    case EAST_EMIT_SET:
        return s->kind == EAST_EMIT_ARRAY ? east_array_new(s->out_type->data.element)
                                          : east_set_new(s->out_type->data.element);
    default:
        return east_dict_new(s->out_type->data.dict.key, s->out_type->data.dict.value);
    }
}

/* The key type of a Set/Dict sink (the element type for a Set). */
static EastType *emit_key_type(EmitSink *s)
{
    return s->kind == EAST_EMIT_DICT ? s->out_type->data.dict.key : s->out_type->data.element;
}

static bool emit_flush(EmitSink *s)
{
    if (s->batch_count == 0) return true;
    if (!emit_writer_write(&s->out, s->batch, s->batch_count)) return false;
    east_value_release(s->batch);
    s->batch = emit_new_batch(s);
    s->batch_count = 0;
    return s->batch != NULL;
}

/* Formats the duplicate-key error. */
static void emit_duplicate_msg(EmitSink *s, EastValue *key, char *buf, size_t buflen)
{
    const char *noun = s->kind == EAST_EMIT_DICT ? "Dict" : "Set";
    const char *part = s->kind == EAST_EMIT_DICT ? "key" : "element";
    char *printed = key ? east_print_value(key, emit_key_type(s)) : NULL;
    snprintf(buf, buflen, "beast2 v5: duplicate %s %s emitted%s%s — %s %ss must be unique", noun,
             part, printed ? ": " : "", printed ? printed : "", noun, part);
    free(printed);
}

/* Formats the out-of-order error: `beast2 v5: <Dict key|Set element> emitted
 * out of order: <key> after <last> — Set/Dict emissions must ascend in East
 * order`. */
static void emit_disorder_msg(EmitSink *s, EastValue *key, EastValue *last, char *buf,
                              size_t buflen)
{
    const char *noun = s->kind == EAST_EMIT_DICT ? "Dict" : "Set";
    const char *part = s->kind == EAST_EMIT_DICT ? "key" : "element";
    char *printed = east_print_value(key, emit_key_type(s));
    char *previous = east_print_value(last, emit_key_type(s));
    snprintf(buf, buflen,
             "beast2 v5: %s %s emitted out of order: %s after %s — Set/Dict emissions must "
             "ascend in East order",
             noun, part, printed ? printed : "?", previous ? previous : "?");
    free(printed);
    free(previous);
}

static EvalResult emit_invoke(EastCompiledFn *self, EastValue **args, size_t n_args)
{
    EmitSink *s = (EmitSink *)self->invoke_userdata;
    size_t expected = s->kind == EAST_EMIT_DICT ? 2 : 1;
    if (n_args != expected || !args[0] || (expected == 2 && !args[1])) {
        return eval_error("emit called with the wrong number of arguments");
    }
    EastValue *key = args[0];
    if (s->kind != EAST_EMIT_ARRAY) {
        if (s->last_key) {
            int order = east_value_compare(s->last_key, key);
            if (order == 0 && s->union_mode) {
                /* The previous element stands. */
                s->emitted++;
                return eval_ok(east_null());
            }
            if (order == 0 && s->merge_fn) {
                /* The flush rule keeps the previous entry in the open batch,
                 * so the fold lands in place. */
                EastValue *acc = east_dict_get(s->batch, key); /* borrowed */
                if (!acc) return eval_error("emit: the folded key is missing from the batch");
                EastValue *fold_args[3] = {key, acc, args[1]};
                EvalResult r = east_call(s->merge_fn, fold_args, 3);
                if (r.status == EVAL_ERROR) return r;
                east_dict_set(s->batch, key, r.value);
                if (r.value) east_value_release(r.value);
                eval_result_free(&r);
                s->emitted++;
                return eval_ok(east_null());
            }
            char msg[512];
            if (order == 0) {
                emit_duplicate_msg(s, key, msg, sizeof(msg));
                return eval_error(msg);
            }
            if (order > 0) {
                emit_disorder_msg(s, key, s->last_key, msg, sizeof(msg));
                return eval_error(msg);
            }
        }
        east_value_retain(key);
        if (s->last_key) east_value_release(s->last_key);
        s->last_key = key;
    }
    /* The flush rule: the open batch goes out only now that an element which
     * will not fold into it has arrived. */
    if (emit_writer_starts_segment(&s->out, args[0], s->batch_count) && !emit_flush(s)) {
        return eval_error("emit: failed to write output segment");
    }
    switch (s->kind) {
    case EAST_EMIT_ARRAY:
        east_array_push(s->batch, args[0]);
        break;
    case EAST_EMIT_SET:
        east_set_insert(s->batch, args[0]);
        break;
    default:
        east_dict_set(s->batch, args[0], args[1]);
        break;
    }
    s->batch_count++;
    s->emitted++;
    /* The opening probe sizes the first segment from what these entries
     * weigh, as the paged encoder does; it is a no-op after the first. */
    if (!emit_writer_probe(&s->out, &s->batch, &s->batch_count)) {
        return eval_error("emit: failed to write output segment");
    }
    return eval_ok(east_null());
}

EastEmitSink *east_emit_sink_new(const EastEmitSinkConfig *cfg)
{
    if (!cfg || !cfg->out_type || !cfg->output_path) {
        east_builtin_error("emit: the sink needs an output type and an output path");
        return NULL;
    }
    if (cfg->merge_fn && cfg->kind != EAST_EMIT_DICT) {
        east_builtin_error("--merge applies to --emit dict only");
        return NULL;
    }
    if (cfg->union_mode && cfg->kind != EAST_EMIT_SET) {
        east_builtin_error("--union applies to --emit set only");
        return NULL;
    }
    EmitSink *s = calloc(1, sizeof(EmitSink));
    if (!s) {
        east_builtin_error("emit: out of memory");
        return NULL;
    }
    s->kind = cfg->kind;
    s->merge_fn = cfg->merge_fn;
    s->union_mode = cfg->union_mode;
    s->out_type = cfg->out_type;
    if (!emit_writer_open(&s->out, s->out_type, cfg->output_path)) {
        free(s);
        return NULL;
    }
    s->batch = emit_new_batch(s);
    if (!s->batch) {
        emit_writer_close(&s->out);
        free(s);
        east_builtin_error("emit: failed to construct the output writer");
        return NULL;
    }
    return s;
}

EastValue *east_emit_sink_function(EastEmitSink *sink, EastType *fn_type)
{
    return east_foreign_function(emit_invoke, sink, NULL, fn_type);
}

bool east_emit_sink_finish(EastEmitSink *s)
{
    if (!emit_flush(s)) {
        east_builtin_error("emit: failed to write the output");
        return false;
    }
    return emit_writer_finish(&s->out);
}

void east_emit_sink_stats(const EastEmitSink *s, EastEmitSinkStats *out)
{
    memset(out, 0, sizeof(*out));
    out->emitted = s->emitted;
}

void east_emit_sink_free(EastEmitSink *s)
{
    if (!s) return;
    emit_writer_close(&s->out);
    if (s->batch) east_value_release(s->batch);
    if (s->last_key) east_value_release(s->last_key);
    free(s);
}
