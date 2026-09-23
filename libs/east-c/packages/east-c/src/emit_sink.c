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
    size_t emitted;
};

typedef struct EastEmitSink EmitSink;

/* The key type of a Set/Dict sink (the element type for a Set). */
static EastType *emit_key_type(EmitSink *s)
{
    return s->kind == EAST_EMIT_DICT ? s->out_type->data.dict.key : s->out_type->data.element;
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
    /* The writer holds the last entry emitted until the next one arrives. */
    EastValue *last = s->out.key;
    if (s->kind != EAST_EMIT_ARRAY && last) {
        int order = east_value_compare(last, key);
        if (order == 0 && s->union_mode) {
            /* The previous element stands. */
            s->emitted++;
            return eval_ok(east_null());
        }
        if (order == 0 && s->merge_fn) {
            /* The previous entry is still held, so the fold lands in place. */
            EastValue *fold_args[3] = {key, s->out.value, args[1]};
            EvalResult r = east_call(s->merge_fn, fold_args, 3);
            if (r.status == EVAL_ERROR) return r;
            east_value_release(s->out.value);
            s->out.value = r.value; /* the result's reference */
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
            emit_disorder_msg(s, key, last, msg, sizeof(msg));
            return eval_error(msg);
        }
    }
    if (!emit_writer_push(&s->out, key, s->kind == EAST_EMIT_DICT ? args[1] : NULL)) {
        return eval_error("emit: failed to write output segment");
    }
    s->emitted++;
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
    return s;
}

EastValue *east_emit_sink_function(EastEmitSink *sink, EastType *fn_type)
{
    return east_foreign_function(emit_invoke, sink, NULL, fn_type);
}

bool east_emit_sink_finish(EastEmitSink *s)
{
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
    free(s);
}
