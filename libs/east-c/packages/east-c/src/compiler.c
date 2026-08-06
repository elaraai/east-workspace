#include "east/compiler.h"
#include "east/type_of_type.h"
#include "east/arena.h"
#include "east/gc.h"
#include "east/serialization.h"

#include <stdarg.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

/* Thread-local source map for loc_id resolution at error time */
static __thread const EastSourceMap *g_current_source_map = NULL;

/* Lazy IR compilation: convert source_ir EastValue → IRNode body on first use */
static void east_compile_lazy(EastCompiledFn *fn)
{
    if (fn->ir || !fn->source_ir) return;
    IRNode *ir_node = east_ir_from_value(fn->source_ir);
    if (ir_node && (ir_node->kind == IR_FUNCTION || ir_node->kind == IR_ASYNC_FUNCTION)) {
        fn->ir = ir_node->data.function.body;
        ir_node_retain(fn->ir);
    }
    if (ir_node) ir_node_release(ir_node);
}

/* ------------------------------------------------------------------ */
/*  Convenience constructors for EvalResult                            */
/* ------------------------------------------------------------------ */

EvalResult eval_ok(EastValue *value)
{
    return (EvalResult){
        .status = EVAL_OK,
        .value = value,
        .label = NULL,
        .error_message = NULL,
        .locations = NULL,
        .num_locations = 0,
    };
}

EvalResult eval_error(const char *msg)
{
    return (EvalResult){
        .status = EVAL_ERROR,
        .value = NULL,
        .label = NULL,
        .error_message = msg ? strdup(msg) : NULL,
        .locations = NULL,
        .num_locations = 0,
    };
}

/* Resolve loc_id and append to an EvalResult's location stack */
static void eval_result_add_loc_id(EvalResult *r, int64_t loc_id)
{
    if (!r || r->status != EVAL_ERROR || loc_id <= 0) return;
    size_t count = 0;
    const EastLocation *locs = east_source_map_resolve(g_current_source_map, loc_id, &count);
    if (!locs || count == 0) return;
    size_t old = r->num_locations;
    size_t total = old + count;
    EastLocation *combined = realloc(r->locations, total * sizeof(EastLocation));
    if (!combined) return;
    for (size_t i = 0; i < count; i++) {
        combined[old + i].filename = locs[i].filename ? strdup(locs[i].filename) : NULL;
        combined[old + i].line = locs[i].line;
        combined[old + i].column = locs[i].column;
    }
    r->locations = combined;
    r->num_locations = total;
}

/* Render a loc_id for an error message that carries no location stack of its
 * own, writing "file:line:column" into buf. A loc_id means nothing to the
 * developer reading it, so an id the source map cannot place is described
 * rather than printed. Returns buf, for use as a "%s" argument. */
static const char *describe_loc_id(int64_t loc_id, char *buf, size_t buf_size)
{
    size_t count = 0;
    const EastLocation *locs =
        loc_id > 0 ? east_source_map_resolve(g_current_source_map, loc_id, &count) : NULL;
    if (locs && count > 0 && locs[0].filename) {
        snprintf(buf, buf_size, "%s:%lld:%lld", locs[0].filename, (long long)locs[0].line,
                 (long long)locs[0].column);
    } else {
        snprintf(buf, buf_size, "an unknown location");
    }
    return buf;
}

/* Create an error result with location from an IR node.
 * Takes ownership of msg (caller must not free). */
static EvalResult eval_error_at_owned(char *msg, IRNode *node)
{
    EvalResult r = {
        .status = EVAL_ERROR,
        .value = NULL,
        .label = NULL,
        .error_message = msg,
        .locations = NULL,
        .num_locations = 0,
    };
    if (node) eval_result_add_loc_id(&r, node->loc_id);
    return r;
}

/* Convenience wrapper for callers with a const char* message and an IRNode in
 * scope. Use this instead of `eval_error(msg)` so runtime errors carry the
 * IR node's source location. */
static EvalResult eval_error_at(IRNode *node, const char *msg)
{
    return eval_error_at_owned(msg ? strdup(msg) : NULL, node);
}

void eval_result_free(EvalResult *result)
{
    if (!result) return;
    if (result->label) {
        free(result->label);
        result->label = NULL;
    }
    if (result->error_message) {
        free(result->error_message);
        result->error_message = NULL;
    }
    if (result->locations) {
        for (size_t i = 0; i < result->num_locations; i++)
            free(result->locations[i].filename);
        free(result->locations);
        result->locations = NULL;
        result->num_locations = 0;
    }
}

/* ------------------------------------------------------------------ */
/*  Internal helpers                                                   */
/* ------------------------------------------------------------------ */

static bool labels_match(const char *a, const char *b)
{
    if (!a && !b) return true;
    if (!a || !b) return false;
    return strcmp(a, b) == 0;
}

static bool is_truthy(EastValue *v)
{
    if (!v) return false;
    if (v->kind == EAST_VAL_BOOLEAN) return v->data.boolean;
    if (v->kind == EAST_VAL_NULL) return false;
    return true;
}

/* ------------------------------------------------------------------ */
/*  Lazy paged collections (issue #505)                                */
/* ------------------------------------------------------------------ */

/* Builtins that answer from the pager and so receive the paged wrapper
 * itself; every other builtin gets the hydrated collection (observational
 * equivalence — hydrate once, delegate). Consulted only when an argument is
 * actually paged, so the strcmp scan is off the hot path. */
static bool builtin_serves_paged(const char *name)
{
    static const char *const served[] = {
        "ArraySize", "ArrayHas", "ArrayGet",   "ArrayTryGet",      "ArrayGetOrDefault", "DictSize",
        "DictHas",   "DictGet",  "DictTryGet", "DictGetOrDefault", "SetSize",           "SetHas",
    };
    for (size_t i = 0; i < sizeof(served) / sizeof(served[0]); i++)
        if (strcmp(name, served[i]) == 0) return true;
    return false;
}

/* Replace an owned paged argument with an owned reference to its hydrated
 * collection. Returns false when hydration fails (error posted). */
static bool hydrate_owned_arg(EastValue **slot)
{
    EastValue *h = east_paged_hydrated(*slot);
    if (!h) return false;
    east_value_retain(h);
    east_value_release(*slot);
    *slot = h;
    return true;
}

/* Iteration locks on a paged wrapper cover its hydrated child too: the child
 * inherits the count at hydration (east_paged_hydrated), and unlock must
 * mirror the decrement on whichever child exists by then. */
static void paged_iter_lock(EastValue *v)
{
    v->iter_lock++;
    if (v->data.paged.hydrated) v->data.paged.hydrated->iter_lock++;
}

static void paged_iter_unlock(EastValue *v)
{
    v->iter_lock--;
    if (v->data.paged.hydrated) v->data.paged.hydrated->iter_lock--;
}

/* The paged fallthrough error for a loop or argument that failed a pager
 * read or hydration: prefer the pager's own posted message. */
static EvalResult paged_error(IRNode *node)
{
    char *err = east_builtin_get_error();
    return err ? eval_error_at_owned(err, node)
               : eval_error_at(node, "beast2 v5: paged read failed");
}

/* ------------------------------------------------------------------ */
/*  Paged for-loops: segment-fed iteration at O(segment) decoded memory */
/* ------------------------------------------------------------------ */

/* One iteration step's loop-control disposition. */
typedef enum { PAGED_LOOP_NEXT, PAGED_LOOP_STOP, PAGED_LOOP_RETURN } PagedLoopStep;

/* Applies the eager loops' break/continue/label/error rules to one body
 * result. On PAGED_LOOP_RETURN the caller propagates *out. */
static PagedLoopStep paged_loop_step(EvalResult *body_res, const char *loop_label, EvalResult *out)
{
    if (body_res->status == EVAL_BREAK) {
        if (labels_match(body_res->label, loop_label)) {
            eval_result_free(body_res);
            return PAGED_LOOP_STOP;
        }
        *out = *body_res;
        return PAGED_LOOP_RETURN;
    }
    if (body_res->status == EVAL_CONTINUE) {
        if (labels_match(body_res->label, loop_label)) {
            eval_result_free(body_res);
            return PAGED_LOOP_NEXT;
        }
        *out = *body_res;
        return PAGED_LOOP_RETURN;
    }
    if (body_res->status != EVAL_OK) {
        *out = *body_res;
        return PAGED_LOOP_RETURN;
    }
    east_value_release(body_res->value);
    east_gc_maybe_collect_young(); /* safe point: loop back-edge */
    return PAGED_LOOP_NEXT;
}

/* Shared driver for the three paged for-loops: walks segments in stream
 * order, binds each element through `bind`, and evaluates the body — one
 * decoded segment live at a time (Array) or the pager's small LRU (Set/Dict
 * via the disjointness-checked read). Owns and releases `subject`. */
typedef void (*PagedBindFn)(IRNode *node, Environment *iter_env, EastValue *seg, size_t i,
                            size_t global_index);

static EvalResult eval_for_paged(IRNode *node, Environment *env, PlatformRegistry *platform,
                                 BuiltinRegistry *builtins, EastValue *subject, IRNode *body,
                                 const char *loop_label, bool disjoint, PagedBindFn bind)
{
    Beast2Pages *pages = subject->data.paged.pages;
    size_t seg_count = east_beast2_pages_segment_count(pages);
    size_t base = 0;
    paged_iter_lock(subject);

    for (size_t s = 0; s < seg_count; s++) {
        EastValue *seg = disjoint ? east_beast2_pages_segment_disjoint(pages, s)
                                  : east_beast2_pages_segment(pages, s);
        if (!seg) {
            paged_iter_unlock(subject);
            east_value_release(subject);
            return paged_error(node);
        }
        size_t seg_len =
            disjoint ? (east_beast2_pages_type(pages)->kind == EAST_TYPE_DICT ? east_dict_len(seg)
                                                                              : east_set_len(seg))
                     : east_array_len(seg);
        for (size_t i = 0; i < seg_len; i++) {
            Environment *iter_env = env_new(env);
            bind(node, iter_env, seg, i, base + i);
            EvalResult body_res = eval_ir(body, iter_env, platform, builtins);
            env_release(iter_env);

            EvalResult out;
            PagedLoopStep step = paged_loop_step(&body_res, loop_label, &out);
            if (step == PAGED_LOOP_RETURN) {
                east_value_release(seg);
                paged_iter_unlock(subject);
                east_value_release(subject);
                return out;
            }
            if (step == PAGED_LOOP_STOP) {
                east_value_release(seg);
                paged_iter_unlock(subject);
                east_value_release(subject);
                return eval_ok(east_null());
            }
        }
        base += seg_len;
        east_value_release(seg);
    }

    paged_iter_unlock(subject);
    east_value_release(subject);
    return eval_ok(east_null());
}

static void paged_bind_array(IRNode *node, Environment *iter_env, EastValue *seg, size_t i,
                             size_t global_index)
{
    env_set(iter_env, node->data.for_array.var.name, east_array_get(seg, i));
    if (node->data.for_array.index_var.name) {
        EastValue *idx = east_integer((int64_t)global_index);
        env_set(iter_env, node->data.for_array.index_var.name, idx);
        east_value_release(idx);
    }
}

static void paged_bind_set(IRNode *node, Environment *iter_env, EastValue *seg, size_t i,
                           size_t global_index)
{
    (void)global_index;
    env_set(iter_env, node->data.for_set.var.name, east_set_at(seg, i));
}

static void paged_bind_dict(IRNode *node, Environment *iter_env, EastValue *seg, size_t i,
                            size_t global_index)
{
    (void)global_index;
    env_set(iter_env, node->data.for_dict.key.name, east_dict_key_at(seg, i));
    env_set(iter_env, node->data.for_dict.val.name, east_dict_val_at(seg, i));
}

/* Whether a paged loop subject still pages (pre-hydration) with the given
 * root kind; a hydrated or mismatched subject falls back to the eager loop
 * over its hydrated collection. */
static bool paged_loop_serves(EastValue *v, EastTypeKind root)
{
    return v->kind == EAST_VAL_PAGED && v->data.paged.hydrated == NULL &&
           east_beast2_pages_type(v->data.paged.pages)->kind == root;
}

/* ------------------------------------------------------------------ */
/*  Main eval dispatch                                                 */
/* ------------------------------------------------------------------ */

EvalResult eval_ir(IRNode *node, Environment *env, PlatformRegistry *platform,
                   BuiltinRegistry *builtins)
{
    if (!node) return eval_ok(east_null());

    switch (node->kind) {
    /* ----- IR_VALUE ------------------------------------------------ */
    case IR_VALUE: {
        EastValue *v = node->data.value.value;
        east_value_retain(v);
        return eval_ok(v);
    }

    /* ----- IR_VARIABLE --------------------------------------------- */
    case IR_VARIABLE: {
        EastValue *v = env_get(env, node->data.variable.name);
        if (!v) {
            char buf[256];
            snprintf(buf, sizeof(buf), "Undefined variable: %s", node->data.variable.name);
            return eval_error_at(node, buf);
        }
        east_value_retain(v);
        return eval_ok(v);
    }

    /* ----- IR_LET -------------------------------------------------- */
    case IR_LET: {
        EvalResult val_res = eval_ir(node->data.let.value, env, platform, builtins);
        if (val_res.status != EVAL_OK) return val_res;

        env_set(env, node->data.let.var.name, val_res.value);
        east_value_release(val_res.value);
        return eval_ok(east_null());
    }

    /* ----- IR_ASSIGN ----------------------------------------------- */
    case IR_ASSIGN: {
        EvalResult val_res = eval_ir(node->data.assign.value, env, platform, builtins);
        if (val_res.status != EVAL_OK) return val_res;

        env_update(env, node->data.assign.var.name, val_res.value);
        east_value_release(val_res.value);
        return eval_ok(east_null());
    }

    /* ----- IR_BLOCK ------------------------------------------------ */
    case IR_BLOCK: {
        EastValue *last = east_null();
        east_value_retain(last);

        for (size_t i = 0; i < node->data.block.num_stmts; i++) {
            east_value_release(last);
            EvalResult r = eval_ir(node->data.block.stmts[i], env, platform, builtins);
            if (r.status != EVAL_OK) return r;
            last = r.value;
        }

        return eval_ok(last);
    }

    /* ----- IR_IF_ELSE ---------------------------------------------- */
    case IR_IF_ELSE: {
        EvalResult cond_res = eval_ir(node->data.if_else.cond, env, platform, builtins);
        if (cond_res.status != EVAL_OK) return cond_res;

        bool cond = is_truthy(cond_res.value);
        east_value_release(cond_res.value);

        if (cond) {
            return eval_ir(node->data.if_else.then_branch, env, platform, builtins);
        } else if (node->data.if_else.else_branch) {
            return eval_ir(node->data.if_else.else_branch, env, platform, builtins);
        } else {
            return eval_ok(east_null());
        }
    }

    /* ----- IR_MATCH ------------------------------------------------ */
    case IR_MATCH: {
        EvalResult expr_res = eval_ir(node->data.match.expr, env, platform, builtins);
        if (expr_res.status != EVAL_OK) return expr_res;

        EastValue *val = expr_res.value;
        if (val->kind != EAST_VAL_VARIANT) {
            east_value_release(val);
            return eval_error_at(node, "match expression is not a variant");
        }

        const char *case_name = east_variant_case_name(val);
        EastValue *inner = val->data.variant.value;

        for (size_t i = 0; i < node->data.match.num_cases; i++) {
            IRMatchCase *mc = &node->data.match.cases[i];
            if (strcmp(mc->case_name, case_name) == 0) {
                Environment *match_env = env_new(env);
                if (mc->bind.name && inner) {
                    env_set(match_env, mc->bind.name, inner);
                }
                EvalResult body_res = eval_ir(mc->body, match_env, platform, builtins);
                env_release(match_env);
                east_value_release(val);
                return body_res;
            }
        }

        east_value_release(val);
        return eval_error_at(node, "no matching case in match expression");
    }

    /* ----- IR_WHILE ------------------------------------------------ */
    case IR_WHILE: {
        const char *loop_label = node->data.while_.label.name;

        for (;;) {
            EvalResult cond_res = eval_ir(node->data.while_.cond, env, platform, builtins);
            if (cond_res.status != EVAL_OK) return cond_res;

            bool cond = is_truthy(cond_res.value);
            east_value_release(cond_res.value);
            if (!cond) break;

            EvalResult body_res = eval_ir(node->data.while_.body, env, platform, builtins);

            if (body_res.status == EVAL_BREAK) {
                if (labels_match(body_res.label, loop_label)) {
                    eval_result_free(&body_res);
                    break;
                }
                return body_res;
            }
            if (body_res.status == EVAL_CONTINUE) {
                if (labels_match(body_res.label, loop_label)) {
                    eval_result_free(&body_res);
                    continue;
                }
                return body_res;
            }
            if (body_res.status != EVAL_OK) {
                return body_res;
            }
            east_value_release(body_res.value);
            east_gc_maybe_collect_young(); /* safe point: loop back-edge */
        }

        return eval_ok(east_null());
    }

    /* ----- IR_FOR_ARRAY -------------------------------------------- */
    case IR_FOR_ARRAY: {
        EvalResult arr_res = eval_ir(node->data.for_array.array, env, platform, builtins);
        if (arr_res.status != EVAL_OK) return arr_res;

        EastValue *arr = arr_res.value;
        if (paged_loop_serves(arr, EAST_TYPE_ARRAY)) {
            return eval_for_paged(node, env, platform, builtins, arr, node->data.for_array.body,
                                  node->data.for_array.label.name, false, paged_bind_array);
        }
        if (arr->kind == EAST_VAL_PAGED && !hydrate_owned_arg(&arr)) {
            east_value_release(arr);
            return paged_error(node);
        }
        if (arr->kind != EAST_VAL_ARRAY) {
            east_value_release(arr);
            return eval_error_at(node, "for-array: expression is not an array");
        }

        size_t len = east_array_len(arr);
        const char *loop_label = node->data.for_array.label.name;
        bool should_break = false;

        arr->iter_lock++;
        for (size_t i = 0; i < len; i++) {
            Environment *iter_env = env_new(env);

            EastValue *elem = east_array_get(arr, i);
            /* env_set retains internally, no extra retain needed */
            env_set(iter_env, node->data.for_array.var.name, elem);

            if (node->data.for_array.index_var.name) {
                EastValue *idx = east_integer((int64_t)i);
                env_set(iter_env, node->data.for_array.index_var.name, idx);
                east_value_release(idx);
            }

            EvalResult body_res = eval_ir(node->data.for_array.body, iter_env, platform, builtins);
            env_release(iter_env);

            if (body_res.status == EVAL_BREAK) {
                if (labels_match(body_res.label, loop_label)) {
                    eval_result_free(&body_res);
                    should_break = true;
                    break;
                }
                arr->iter_lock--;
                east_value_release(arr);
                return body_res;
            }
            if (body_res.status == EVAL_CONTINUE) {
                if (labels_match(body_res.label, loop_label)) {
                    eval_result_free(&body_res);
                    continue;
                }
                arr->iter_lock--;
                east_value_release(arr);
                return body_res;
            }
            if (body_res.status != EVAL_OK) {
                arr->iter_lock--;
                east_value_release(arr);
                return body_res;
            }
            east_value_release(body_res.value);
            east_gc_maybe_collect_young(); /* safe point: loop back-edge */
        }
        arr->iter_lock--;

        east_value_release(arr);
        (void)should_break;
        return eval_ok(east_null());
    }

    /* ----- IR_FOR_SET ---------------------------------------------- */
    case IR_FOR_SET: {
        EvalResult set_res = eval_ir(node->data.for_set.set, env, platform, builtins);
        if (set_res.status != EVAL_OK) return set_res;

        EastValue *set = set_res.value;
        if (paged_loop_serves(set, EAST_TYPE_SET)) {
            return eval_for_paged(node, env, platform, builtins, set, node->data.for_set.body,
                                  node->data.for_set.label.name, true, paged_bind_set);
        }
        if (set->kind == EAST_VAL_PAGED && !hydrate_owned_arg(&set)) {
            east_value_release(set);
            return paged_error(node);
        }
        if (set->kind != EAST_VAL_SET) {
            east_value_release(set);
            return eval_error_at(node, "for-set: expression is not a set");
        }

        size_t len = east_set_len(set);
        const char *loop_label = node->data.for_set.label.name;
        bool should_break = false;

        set->iter_lock++;
        for (size_t i = 0; i < len; i++) {
            Environment *iter_env = env_new(env);

            EastValue *elem = east_set_at(set, i);
            /* env_set retains internally, no extra retain needed */
            env_set(iter_env, node->data.for_set.var.name, elem);

            EvalResult body_res = eval_ir(node->data.for_set.body, iter_env, platform, builtins);
            env_release(iter_env);

            if (body_res.status == EVAL_BREAK) {
                if (labels_match(body_res.label, loop_label)) {
                    eval_result_free(&body_res);
                    should_break = true;
                    break;
                }
                set->iter_lock--;
                east_value_release(set);
                return body_res;
            }
            if (body_res.status == EVAL_CONTINUE) {
                if (labels_match(body_res.label, loop_label)) {
                    eval_result_free(&body_res);
                    continue;
                }
                set->iter_lock--;
                east_value_release(set);
                return body_res;
            }
            if (body_res.status != EVAL_OK) {
                set->iter_lock--;
                east_value_release(set);
                return body_res;
            }
            east_value_release(body_res.value);
            east_gc_maybe_collect_young(); /* safe point: loop back-edge */
        }
        set->iter_lock--;

        east_value_release(set);
        (void)should_break;
        return eval_ok(east_null());
    }

    /* ----- IR_FOR_DICT --------------------------------------------- */
    case IR_FOR_DICT: {
        EvalResult dict_res = eval_ir(node->data.for_dict.dict, env, platform, builtins);
        if (dict_res.status != EVAL_OK) return dict_res;

        EastValue *dict = dict_res.value;
        if (paged_loop_serves(dict, EAST_TYPE_DICT)) {
            return eval_for_paged(node, env, platform, builtins, dict, node->data.for_dict.body,
                                  node->data.for_dict.label.name, true, paged_bind_dict);
        }
        if (dict->kind == EAST_VAL_PAGED && !hydrate_owned_arg(&dict)) {
            east_value_release(dict);
            return paged_error(node);
        }
        if (dict->kind != EAST_VAL_DICT) {
            east_value_release(dict);
            return eval_error_at(node, "for-dict: expression is not a dict");
        }

        size_t len = east_dict_len(dict);
        const char *loop_label = node->data.for_dict.label.name;
        bool should_break = false;

        dict->iter_lock++;
        for (size_t i = 0; i < len; i++) {
            Environment *iter_env = env_new(env);

            EastValue *key = east_dict_key_at(dict, i);
            EastValue *val = east_dict_val_at(dict, i);
            /* env_set retains internally, no extra retain needed */
            env_set(iter_env, node->data.for_dict.key.name, key);
            env_set(iter_env, node->data.for_dict.val.name, val);

            EvalResult body_res = eval_ir(node->data.for_dict.body, iter_env, platform, builtins);
            env_release(iter_env);

            if (body_res.status == EVAL_BREAK) {
                if (labels_match(body_res.label, loop_label)) {
                    eval_result_free(&body_res);
                    should_break = true;
                    break;
                }
                dict->iter_lock--;
                east_value_release(dict);
                return body_res;
            }
            if (body_res.status == EVAL_CONTINUE) {
                if (labels_match(body_res.label, loop_label)) {
                    eval_result_free(&body_res);
                    continue;
                }
                dict->iter_lock--;
                east_value_release(dict);
                return body_res;
            }
            if (body_res.status != EVAL_OK) {
                dict->iter_lock--;
                east_value_release(dict);
                return body_res;
            }
            east_value_release(body_res.value);
            east_gc_maybe_collect_young(); /* safe point: loop back-edge */
        }
        dict->iter_lock--;

        east_value_release(dict);
        (void)should_break;
        return eval_ok(east_null());
    }

    /* ----- IR_FUNCTION / IR_ASYNC_FUNCTION ------------------------- */
    case IR_FUNCTION:
    case IR_ASYNC_FUNCTION: {
        EastCompiledFn *fn = east_calloc(1, sizeof(EastCompiledFn));
        if (!fn) return eval_error_at(node, "out of memory");

        /* Share the enclosing environment for captured variables.
         * Mutable captures must see modifications from both sides. */
        fn->captures = env;
        env_retain(env);

        /* Store parameter names */
        fn->num_params = node->data.function.num_params;
        if (fn->num_params > 0) {
            fn->param_names = east_calloc(fn->num_params, sizeof(char *));
            if (!fn->param_names) {
                env_release(fn->captures);
                east_free(fn);
                return eval_error_at(node, "out of memory");
            }
            for (size_t i = 0; i < fn->num_params; i++) {
                fn->param_names[i] = east_strdup(node->data.function.params[i].name);
            }
        } else {
            fn->param_names = NULL;
        }

        /* Retain the IR body */
        ir_node_retain(node->data.function.body);
        fn->ir = node->data.function.body;

        fn->platform = platform;
        if (platform) platform_registry_retain(platform);
        fn->builtins = builtins;

        /* Store source IR for serialization */
        fn->source_ir = node->data.function.source_ir;
        if (fn->source_ir) east_value_retain(fn->source_ir);

        /* Store function type (not owned — points to IR node's type) */
        fn->fn_type = node->type;

        /* Snapshot the thread-local source map so this function value can be
         * beast2-encoded with its own source_map section (matches JS's
         * SourceMapSymbol attach at East.function/asyncFunction construction).
         * Borrowed, not owned — same ownership as value_decode.c:333. */
        fn->source_map = (EastSourceMap *)g_current_source_map;

        EastValue *fv = east_function_value(fn);
        return eval_ok(fv);
    }

    /* ----- IR_CALL / IR_CALL_ASYNC --------------------------------- */
    case IR_CALL:
    case IR_CALL_ASYNC: {
        EvalResult func_res = eval_ir(node->data.call.func, env, platform, builtins);
        if (func_res.status != EVAL_OK) return func_res;

        EastValue *func_val = func_res.value;
        if (func_val->kind != EAST_VAL_FUNCTION) {
            east_value_release(func_val);
            return eval_error_at(node, "call target is not a function");
        }

        EastCompiledFn *cfn = func_val->data.function.compiled;

        /* Foreign-runtime dispatch: skip IR eval and route to custom invoke */
        if (cfn->invoke) {
            size_t nargs = node->data.call.num_args;
            EastValue **args = NULL;
            if (nargs > 0) {
                args = calloc(nargs, sizeof(EastValue *));
                if (!args) {
                    east_value_release(func_val);
                    return eval_error_at(node, "out of memory");
                }
                for (size_t i = 0; i < nargs; i++) {
                    EvalResult arg_res = eval_ir(node->data.call.args[i], env, platform, builtins);
                    if (arg_res.status != EVAL_OK) {
                        for (size_t j = 0; j < i; j++)
                            east_value_release(args[j]);
                        free(args);
                        east_value_release(func_val);
                        return arg_res;
                    }
                    args[i] = arg_res.value;
                }
            }
            EvalResult body_res = cfn->invoke(cfn, args, nargs);
            for (size_t i = 0; i < nargs; i++)
                east_value_release(args[i]);
            free(args);
            east_value_release(func_val);
            if (body_res.status == EVAL_RETURN) {
                EastValue *ret_val = body_res.value;
                eval_result_free(&body_res);
                body_res = eval_ok(ret_val);
            }
            return body_res;
        }

        /* Lazy IR conversion for beast2-decoded functions */
        if (!cfn->ir && cfn->source_ir) east_compile_lazy(cfn);
        if (!cfn->ir) {
            east_value_release(func_val);
            return eval_error_at(node, "function has no IR body");
        }

        /* Evaluate arguments */
        size_t nargs = node->data.call.num_args;
        EastValue **args = NULL;
        if (nargs > 0) {
            args = calloc(nargs, sizeof(EastValue *));
            if (!args) {
                east_value_release(func_val);
                return eval_error_at(node, "out of memory");
            }
            for (size_t i = 0; i < nargs; i++) {
                EvalResult arg_res = eval_ir(node->data.call.args[i], env, platform, builtins);
                if (arg_res.status != EVAL_OK) {
                    for (size_t j = 0; j < i; j++)
                        east_value_release(args[j]);
                    free(args);
                    east_value_release(func_val);
                    return arg_res;
                }
                args[i] = arg_res.value;
            }
        }

        /* Create call environment: captures as parent, then params */
        Environment *call_env = env_new(cfn->captures);
        for (size_t i = 0; i < cfn->num_params && i < nargs; i++) {
            env_set(call_env, cfn->param_names[i], args[i]);
        }

        /* Evaluate body */
        EvalResult body_res = eval_ir(cfn->ir, call_env, cfn->platform, cfn->builtins);

        env_release(call_env);

        /* Clean up args */
        for (size_t i = 0; i < nargs; i++)
            east_value_release(args[i]);
        free(args);
        east_value_release(func_val);

        /* Handle RETURN status: extract value */
        if (body_res.status == EVAL_RETURN) {
            EastValue *ret_val = body_res.value;
            eval_result_free(&body_res);
            return eval_ok(ret_val);
        }

        /* Extend error location stack with call site */
        if (body_res.status == EVAL_ERROR) {
            eval_result_add_loc_id(&body_res, node->loc_id);
        }

        return body_res;
    }

    /* ----- IR_PLATFORM --------------------------------------------- */
    case IR_PLATFORM: {
        PlatformFn pfn = platform_registry_get(platform, node->data.platform.name,
                                               node->data.platform.type_params,
                                               node->data.platform.num_type_params);
        if (!pfn) {
            if (node->data.platform.optional) {
                char buf[256];
                snprintf(buf, sizeof(buf), "Platform function '%s' is not available",
                         node->data.platform.name);
                return eval_error_at_owned(strdup(buf), node);
            }
            char buf[256];
            snprintf(buf, sizeof(buf), "Unknown platform function: %s", node->data.platform.name);
            return eval_error_at_owned(strdup(buf), node);
        }

        size_t nargs = node->data.platform.num_args;
        EastValue **args = NULL;
        if (nargs > 0) {
            args = calloc(nargs, sizeof(EastValue *));
            if (!args) return eval_error_at(node, "out of memory");
            for (size_t i = 0; i < nargs; i++) {
                EvalResult arg_res = eval_ir(node->data.platform.args[i], env, platform, builtins);
                if (arg_res.status != EVAL_OK) {
                    for (size_t j = 0; j < i; j++)
                        east_value_release(args[j]);
                    free(args);
                    return arg_res;
                }
                args[i] = arg_res.value;
            }
        }

        /* Platform functions always see eager collections (issue #505). */
        for (size_t i = 0; i < nargs; i++) {
            if (args[i] && args[i]->kind == EAST_VAL_PAGED && !hydrate_owned_arg(&args[i])) {
                for (size_t j = 0; j < nargs; j++)
                    east_value_release(args[j]);
                free(args);
                return paged_error(node);
            }
        }

        if (platform->pre_call) {
            platform->pre_call(platform, node->data.platform.name, node->data.platform.type_params,
                               node->data.platform.num_type_params);
        }

        /* Collect input types from the arg IR nodes */
        EastType **input_types = NULL;
        if (nargs > 0) {
            input_types = calloc(nargs, sizeof(EastType *));
            for (size_t i = 0; i < nargs; i++)
                input_types[i] = node->data.platform.args[i]->type;
        }

        EvalResult result = pfn(args, nargs, input_types, nargs, node->type);
        free(input_types);

        for (size_t i = 0; i < nargs; i++)
            east_value_release(args[i]);
        free(args);

        if (result.status != EVAL_OK) {
            eval_result_add_loc_id(&result, node->loc_id);
            return result;
        }
        if (!result.value) result.value = east_null();
        return result;
    }

    /* ----- IR_BUILTIN ---------------------------------------------- */
    case IR_BUILTIN: {
        /* Evaluate arguments FIRST, before calling the factory.
         * This ensures that the factory call and the impl call are adjacent,
         * which allows factories to set static type context safely. */
        size_t nargs = node->data.builtin.num_args;
        EastValue **args = NULL;
        if (nargs > 0) {
            args = calloc(nargs, sizeof(EastValue *));
            if (!args) return eval_error_at(node, "out of memory");
            for (size_t i = 0; i < nargs; i++) {
                EvalResult arg_res = eval_ir(node->data.builtin.args[i], env, platform, builtins);
                if (arg_res.status != EVAL_OK) {
                    for (size_t j = 0; j < i; j++)
                        east_value_release(args[j]);
                    free(args);
                    return arg_res;
                }
                args[i] = arg_res.value;
            }
        }

        /* Paged args reach only the pager-served builtins; every other
         * builtin sees the hydrated collection (issue #505). */
        for (size_t i = 0; i < nargs; i++) {
            if (args[i] && args[i]->kind == EAST_VAL_PAGED &&
                !builtin_serves_paged(node->data.builtin.name) && !hydrate_owned_arg(&args[i])) {
                for (size_t j = 0; j < nargs; j++)
                    east_value_release(args[j]);
                free(args);
                return paged_error(node);
            }
        }

        /* Now call factory + impl back-to-back (no IR eval in between) */
        BuiltinImpl bfn =
            builtin_registry_get(builtins, node->data.builtin.name, node->data.builtin.type_params,
                                 node->data.builtin.num_type_params);
        if (!bfn) {
            for (size_t i = 0; i < nargs; i++)
                east_value_release(args[i]);
            free(args);
            char buf[256];
            snprintf(buf, sizeof(buf), "Unknown builtin function: %s", node->data.builtin.name);
            return eval_error_at_owned(strdup(buf), node);
        }

        EastValue *result = bfn(args, nargs);

        for (size_t i = 0; i < nargs; i++)
            east_value_release(args[i]);
        free(args);

        if (!result) {
            char *err = east_builtin_get_error();
            if (err) {
                return eval_error_at_owned(err, node);
            }
            return eval_ok(east_null());
        }
        return eval_ok(result);
    }

    /* ----- IR_RETURN ----------------------------------------------- */
    case IR_RETURN: {
        EvalResult val_res = eval_ir(node->data.return_.value, env, platform, builtins);
        if (val_res.status != EVAL_OK) return val_res;

        return (EvalResult){
            .status = EVAL_RETURN,
            .value = val_res.value,
            .label = NULL,
            .error_message = NULL,
        };
    }

    /* ----- IR_BREAK ------------------------------------------------ */
    case IR_BREAK: {
        return (EvalResult){
            .status = EVAL_BREAK,
            .value = NULL,
            .label =
                node->data.loop_ctrl.label.name ? strdup(node->data.loop_ctrl.label.name) : NULL,
            .error_message = NULL,
        };
    }

    /* ----- IR_CONTINUE --------------------------------------------- */
    case IR_CONTINUE: {
        return (EvalResult){
            .status = EVAL_CONTINUE,
            .value = NULL,
            .label =
                node->data.loop_ctrl.label.name ? strdup(node->data.loop_ctrl.label.name) : NULL,
            .error_message = NULL,
        };
    }

    /* ----- IR_ERROR ------------------------------------------------ */
    case IR_ERROR: {
        EvalResult msg_res = eval_ir(node->data.error.message, env, platform, builtins);
        if (msg_res.status != EVAL_OK) return msg_res;

        char *msg = NULL;
        if (msg_res.value && msg_res.value->kind == EAST_VAL_STRING) {
            msg = strdup(msg_res.value->data.string.data);
        } else {
            msg = strdup("unknown error");
        }
        east_value_release(msg_res.value);

        return eval_error_at_owned(msg, node);
    }

    /* ----- IR_TRY_CATCH -------------------------------------------- */
    case IR_TRY_CATCH: {
        EvalResult result;

        EvalResult try_res = eval_ir(node->data.try_catch.try_body, env, platform, builtins);
        if (try_res.status == EVAL_ERROR) {
            Environment *catch_env = env_new(env);

            /* Bind the error message as a string value */
            if (node->data.try_catch.message_var.name && node->data.try_catch.message_var.name[0]) {
                EastValue *err_val =
                    east_string(try_res.error_message ? try_res.error_message : "");
                env_set(catch_env, node->data.try_catch.message_var.name, err_val);
                east_value_release(err_val);
            }

            /* Bind the location stack as an array of structs */
            if (node->data.try_catch.stack_var.name && node->data.try_catch.stack_var.name[0]) {
                EastType *loc_struct_type = east_struct_type(
                    (const char *[]){"column", "filename", "line"},
                    (EastType *[]){&east_integer_type, &east_string_type, &east_integer_type}, 3);
                EastType *loc_arr_type = east_array_type(loc_struct_type);
                EastValue *stack_arr = east_array_new(loc_struct_type);

                for (size_t i = 0; i < try_res.num_locations; i++) {
                    EastLocation *loc = &try_res.locations[i];
                    const char *names[] = {"column", "filename", "line"};
                    EastValue *vals[] = {
                        east_integer(loc->column),
                        east_string(loc->filename ? loc->filename : ""),
                        east_integer(loc->line),
                    };
                    EastValue *loc_s = east_struct_new(names, vals, 3, loc_struct_type);
                    east_array_push(stack_arr, loc_s);
                    east_value_release(loc_s);
                    for (int j = 0; j < 3; j++)
                        east_value_release(vals[j]);
                }

                env_set(catch_env, node->data.try_catch.stack_var.name, stack_arr);
                east_value_release(stack_arr);
                east_type_release(loc_arr_type);
                east_type_release(loc_struct_type);
            }

            eval_result_free(&try_res);

            result = eval_ir(node->data.try_catch.catch_body, catch_env, platform, builtins);
            env_release(catch_env);
        } else {
            result = try_res;
        }

        /* Execute finally block if present */
        if (node->data.try_catch.finally_body) {
            /* Skip no-op finally (Value nodes with null type) */
            bool is_noop = (node->data.try_catch.finally_body->kind == IR_VALUE);
            if (!is_noop) {
                EvalResult fin_res =
                    eval_ir(node->data.try_catch.finally_body, env, platform, builtins);
                if (fin_res.status == EVAL_ERROR) {
                    /* Finally error overrides the result */
                    if (result.value) east_value_release(result.value);
                    eval_result_free(&result);
                    return fin_res;
                }
                /* Otherwise discard finally's value, keep original result */
                if (fin_res.value) east_value_release(fin_res.value);
                eval_result_free(&fin_res);
            }
        }

        return result;
    }

    /* ----- IR_NEW_ARRAY -------------------------------------------- */
    case IR_NEW_ARRAY: {
        EastType *elem_type = NULL;
        if (node->type && node->type->kind == EAST_TYPE_ARRAY) {
            elem_type = node->type->data.element;
        }

        EastValue *arr = east_array_new(elem_type);
        size_t n = node->data.new_collection.num_items;

        for (size_t i = 0; i < n; i++) {
            EvalResult item_res =
                eval_ir(node->data.new_collection.items[i], env, platform, builtins);
            if (item_res.status != EVAL_OK) {
                east_value_release(arr);
                return item_res;
            }
            /* Containers hold eager values only — a paged wrapper nested in
             * a container would reach the type-driven encoders (#505). */
            if (item_res.value->kind == EAST_VAL_PAGED && !hydrate_owned_arg(&item_res.value)) {
                east_value_release(item_res.value);
                east_value_release(arr);
                return paged_error(node);
            }
            east_array_push(arr, item_res.value);
            east_value_release(item_res.value);
        }

        return eval_ok(arr);
    }

    /* ----- IR_NEW_SET ---------------------------------------------- */
    case IR_NEW_SET: {
        EastType *elem_type = NULL;
        if (node->type && node->type->kind == EAST_TYPE_SET) {
            elem_type = node->type->data.element;
        }

        EastValue *set = east_set_new(elem_type);
        size_t n = node->data.new_collection.num_items;

        for (size_t i = 0; i < n; i++) {
            EvalResult item_res =
                eval_ir(node->data.new_collection.items[i], env, platform, builtins);
            if (item_res.status != EVAL_OK) {
                east_value_release(set);
                return item_res;
            }
            if (item_res.value->kind == EAST_VAL_PAGED && !hydrate_owned_arg(&item_res.value)) {
                east_value_release(item_res.value);
                east_value_release(set);
                return paged_error(node);
            }
            east_set_insert(set, item_res.value);
            east_value_release(item_res.value);
        }

        return eval_ok(set);
    }

    /* ----- IR_NEW_DICT --------------------------------------------- */
    case IR_NEW_DICT: {
        EastType *key_type = NULL;
        EastType *val_type = NULL;
        if (node->type && node->type->kind == EAST_TYPE_DICT) {
            key_type = node->type->data.dict.key;
            val_type = node->type->data.dict.value;
        }

        EastValue *dict = east_dict_new(key_type, val_type);
        size_t n = node->data.new_dict.num_pairs;

        for (size_t i = 0; i < n; i++) {
            EvalResult k_res = eval_ir(node->data.new_dict.keys[i], env, platform, builtins);
            if (k_res.status != EVAL_OK) {
                east_value_release(dict);
                return k_res;
            }
            EvalResult v_res = eval_ir(node->data.new_dict.values[i], env, platform, builtins);
            if (v_res.status != EVAL_OK) {
                east_value_release(k_res.value);
                east_value_release(dict);
                return v_res;
            }
            if ((k_res.value->kind == EAST_VAL_PAGED && !hydrate_owned_arg(&k_res.value)) ||
                (v_res.value->kind == EAST_VAL_PAGED && !hydrate_owned_arg(&v_res.value))) {
                east_value_release(k_res.value);
                east_value_release(v_res.value);
                east_value_release(dict);
                return paged_error(node);
            }
            east_dict_set(dict, k_res.value, v_res.value);
            east_value_release(k_res.value);
            east_value_release(v_res.value);
        }

        return eval_ok(dict);
    }

    /* ----- IR_NEW_REF ---------------------------------------------- */
    case IR_NEW_REF: {
        EvalResult val_res = eval_ir(node->data.new_ref.value, env, platform, builtins);
        if (val_res.status != EVAL_OK) return val_res;

        if (val_res.value->kind == EAST_VAL_PAGED && !hydrate_owned_arg(&val_res.value)) {
            east_value_release(val_res.value);
            return paged_error(node);
        }
        EastValue *ref = east_ref_new(val_res.value);
        east_value_release(val_res.value);
        return eval_ok(ref);
    }

    /* ----- IR_NEW_VECTOR ------------------------------------------- */
    case IR_NEW_VECTOR: {
        size_t n = node->data.new_vector.num_items;

        /* Determine element type from the node type */
        EastType *elem_type = NULL;
        if (node->type && node->type->kind == EAST_TYPE_VECTOR) {
            elem_type = node->type->data.element;
        }

        EastValue *vec = east_vector_new(elem_type, n);

        for (size_t i = 0; i < n; i++) {
            EvalResult item_res = eval_ir(node->data.new_vector.items[i], env, platform, builtins);
            if (item_res.status != EVAL_OK) {
                east_value_release(vec);
                return item_res;
            }

            /* Copy scalar value into vector data */
            EastValue *item = item_res.value;
            if (elem_type) {
                if (elem_type->kind == EAST_TYPE_FLOAT && item->kind == EAST_VAL_FLOAT) {
                    ((double *)vec->data.vector.data)[i] = item->data.float64;
                } else if (elem_type->kind == EAST_TYPE_INTEGER && item->kind == EAST_VAL_INTEGER) {
                    ((int64_t *)vec->data.vector.data)[i] = item->data.integer;
                } else if (elem_type->kind == EAST_TYPE_BOOLEAN && item->kind == EAST_VAL_BOOLEAN) {
                    ((bool *)vec->data.vector.data)[i] = item->data.boolean;
                }
            }
            east_value_release(item);
        }

        return eval_ok(vec);
    }

    /* ----- IR_NEW_MATRIX ------------------------------------------- */
    case IR_NEW_MATRIX: {
        size_t n = node->data.new_matrix.num_items;
        size_t rows = node->data.new_matrix.rows;
        size_t cols = node->data.new_matrix.cols;

        EastType *elem_type = NULL;
        if (node->type && node->type->kind == EAST_TYPE_MATRIX) {
            elem_type = node->type->data.element;
        }

        EastValue *mat = east_matrix_new(elem_type, rows, cols);

        for (size_t i = 0; i < n; i++) {
            EvalResult item_res = eval_ir(node->data.new_matrix.items[i], env, platform, builtins);
            if (item_res.status != EVAL_OK) {
                east_value_release(mat);
                return item_res;
            }

            EastValue *item = item_res.value;
            if (elem_type) {
                if (elem_type->kind == EAST_TYPE_FLOAT && item->kind == EAST_VAL_FLOAT) {
                    ((double *)mat->data.matrix.data)[i] = item->data.float64;
                } else if (elem_type->kind == EAST_TYPE_INTEGER && item->kind == EAST_VAL_INTEGER) {
                    ((int64_t *)mat->data.matrix.data)[i] = item->data.integer;
                } else if (elem_type->kind == EAST_TYPE_BOOLEAN && item->kind == EAST_VAL_BOOLEAN) {
                    ((bool *)mat->data.matrix.data)[i] = item->data.boolean;
                }
            }
            east_value_release(item);
        }

        return eval_ok(mat);
    }

    /* ----- IR_STRUCT ----------------------------------------------- */
    case IR_STRUCT: {
        size_t n = node->data.struct_.num_fields;

        const char **names = NULL;
        EastValue **vals = NULL;
        if (n > 0) {
            names = calloc(n, sizeof(const char *));
            vals = calloc(n, sizeof(EastValue *));
            if (!names || !vals) {
                free(names);
                free(vals);
                return eval_error_at(node, "out of memory");
            }
        }

        for (size_t i = 0; i < n; i++) {
            names[i] = node->data.struct_.field_names[i];
            EvalResult fv_res =
                eval_ir(node->data.struct_.field_values[i], env, platform, builtins);
            if (fv_res.status != EVAL_OK) {
                for (size_t j = 0; j < i; j++)
                    east_value_release(vals[j]);
                free(names);
                free(vals);
                return fv_res;
            }
            vals[i] = fv_res.value;
            if (vals[i]->kind == EAST_VAL_PAGED && !hydrate_owned_arg(&vals[i])) {
                for (size_t j = 0; j <= i; j++)
                    east_value_release(vals[j]);
                free(names);
                free(vals);
                return paged_error(node);
            }
        }

        EastValue *s = east_struct_new(names, vals, n, node->type);

        for (size_t i = 0; i < n; i++)
            east_value_release(vals[i]);
        free(names);
        free(vals);

        return eval_ok(s);
    }

    /* ----- IR_GET_FIELD -------------------------------------------- */
    case IR_GET_FIELD: {
        EvalResult expr_res = eval_ir(node->data.get_field.expr, env, platform, builtins);
        if (expr_res.status != EVAL_OK) return expr_res;

        EastValue *s = expr_res.value;
        if (s->kind != EAST_VAL_STRUCT) {
            east_value_release(s);
            return eval_error_at(node, "get_field: value is not a struct");
        }

        EastValue *field = east_struct_get_field(s, node->data.get_field.field_name);
        if (!field) {
            char buf[256];
            snprintf(buf, sizeof(buf), "no field named '%s'", node->data.get_field.field_name);
            east_value_release(s);
            return eval_error_at(node, buf);
        }

        east_value_retain(field);
        east_value_release(s);
        return eval_ok(field);
    }

    /* ----- IR_VARIANT ---------------------------------------------- */
    case IR_VARIANT: {
        EvalResult val_res = eval_ir(node->data.variant.value, env, platform, builtins);
        if (val_res.status != EVAL_OK) return val_res;

        if (val_res.value->kind == EAST_VAL_PAGED && !hydrate_owned_arg(&val_res.value)) {
            east_value_release(val_res.value);
            return paged_error(node);
        }
        EastValue *v = east_variant_new(node->data.variant.case_name, val_res.value, node->type);
        east_value_release(val_res.value);
        return eval_ok(v);
    }

    /* ----- IR_WRAP_RECURSIVE / IR_UNWRAP_RECURSIVE ----------------- */
    case IR_WRAP_RECURSIVE:
    case IR_UNWRAP_RECURSIVE: {
        return eval_ir(node->data.recursive.value, env, platform, builtins);
    }

    } /* end switch */

    return eval_error_at(node, "unhandled IR node kind");
}

/* ------------------------------------------------------------------ */
/*  Platform signature validation (east_compile_checked)               */
/* ------------------------------------------------------------------ */

/* malloc'd printf. Returns NULL on allocation failure. */
static char *format_error(const char *fmt, ...)
{
    va_list ap;
    va_start(ap, fmt);
    int len = vsnprintf(NULL, 0, fmt, ap);
    va_end(ap);
    if (len < 0) return NULL;
    char *buf = malloc((size_t)len + 1);
    if (!buf) return NULL;
    va_start(ap, fmt);
    vsnprintf(buf, (size_t)len + 1, fmt, ap);
    va_end(ap);
    return buf;
}

/* Validate every Platform node against its typed registry entry, in
 * evaluation order. Untyped entries (NULL output_type), generic factories,
 * and unregistered names are skipped — resolution failures stay a runtime
 * concern (optional platforms are legal). Returns a malloc'd error message
 * matching the TS analyzer's text (analyze.ts Platform checks), or NULL. */
static char *check_platform_types(IRNode *node, PlatformRegistry *platform)
{
    if (!node) return NULL;
    char *err = NULL;
    char loc[512];

    switch (node->kind) {
    case IR_PLATFORM: {
        const char *name = node->data.platform.name;
        PlatformFunction *pf = platform_registry_lookup(platform, name);
        bool typed = pf && pf->output_type;
        size_t nargs = node->data.platform.num_args;

        if (typed && nargs != pf->num_input_types) {
            return format_error("Platform function '%s' expects %zu arguments but got %zu at %s",
                                name, pf->num_input_types, nargs,
                                describe_loc_id(node->loc_id, loc, sizeof loc));
        }
        for (size_t i = 0; i < nargs; i++) {
            IRNode *arg = node->data.platform.args[i];
            err = check_platform_types(arg, platform);
            if (err) return err;
            if (typed && arg->type->kind != EAST_TYPE_NEVER &&
                !east_type_equal(arg->type, pf->input_types[i])) {
                char *expected = east_print_type(pf->input_types[i]);
                char *got = east_print_type(arg->type);
                err = format_error(
                    "Platform function '%s' argument %zu requires exact type match. "
                    "Expected type %s but got %s. Insert an As node if subtyping is intended. "
                    "at %s",
                    name, i + 1, expected ? expected : "?", got ? got : "?",
                    describe_loc_id(node->loc_id, loc, sizeof loc));
                free(expected);
                free(got);
                return err;
            }
        }
        if (typed && !east_type_equal(node->type, pf->output_type)) {
            char *expected = east_print_type(pf->output_type);
            char *got = east_print_type(node->type);
            err = format_error(
                "Platform function '%s' return type expected to be %s but IR has %s at %s", name,
                expected ? expected : "?", got ? got : "?",
                describe_loc_id(node->loc_id, loc, sizeof loc));
            free(expected);
            free(got);
            return err;
        }
        return NULL;
    }

    case IR_VALUE:
    case IR_VARIABLE:
    case IR_BREAK:
    case IR_CONTINUE:
        return NULL;

    case IR_LET:
        return check_platform_types(node->data.let.value, platform);
    case IR_ASSIGN:
        return check_platform_types(node->data.assign.value, platform);

    case IR_BLOCK:
        for (size_t i = 0; i < node->data.block.num_stmts; i++) {
            err = check_platform_types(node->data.block.stmts[i], platform);
            if (err) return err;
        }
        return NULL;

    case IR_IF_ELSE:
        err = check_platform_types(node->data.if_else.cond, platform);
        if (!err) err = check_platform_types(node->data.if_else.then_branch, platform);
        if (!err) err = check_platform_types(node->data.if_else.else_branch, platform);
        return err;

    case IR_MATCH:
        err = check_platform_types(node->data.match.expr, platform);
        if (err) return err;
        for (size_t i = 0; i < node->data.match.num_cases; i++) {
            err = check_platform_types(node->data.match.cases[i].body, platform);
            if (err) return err;
        }
        return NULL;

    case IR_WHILE:
        err = check_platform_types(node->data.while_.cond, platform);
        if (!err) err = check_platform_types(node->data.while_.body, platform);
        return err;

    case IR_FOR_ARRAY:
        err = check_platform_types(node->data.for_array.array, platform);
        if (!err) err = check_platform_types(node->data.for_array.body, platform);
        return err;
    case IR_FOR_SET:
        err = check_platform_types(node->data.for_set.set, platform);
        if (!err) err = check_platform_types(node->data.for_set.body, platform);
        return err;
    case IR_FOR_DICT:
        err = check_platform_types(node->data.for_dict.dict, platform);
        if (!err) err = check_platform_types(node->data.for_dict.body, platform);
        return err;

    case IR_FUNCTION:
    case IR_ASYNC_FUNCTION:
        return check_platform_types(node->data.function.body, platform);

    case IR_CALL:
    case IR_CALL_ASYNC:
        err = check_platform_types(node->data.call.func, platform);
        if (err) return err;
        for (size_t i = 0; i < node->data.call.num_args; i++) {
            err = check_platform_types(node->data.call.args[i], platform);
            if (err) return err;
        }
        return NULL;

    case IR_BUILTIN:
        for (size_t i = 0; i < node->data.builtin.num_args; i++) {
            err = check_platform_types(node->data.builtin.args[i], platform);
            if (err) return err;
        }
        return NULL;

    case IR_RETURN:
        return check_platform_types(node->data.return_.value, platform);
    case IR_ERROR:
        return check_platform_types(node->data.error.message, platform);

    case IR_TRY_CATCH:
        err = check_platform_types(node->data.try_catch.try_body, platform);
        if (!err) err = check_platform_types(node->data.try_catch.catch_body, platform);
        if (!err) err = check_platform_types(node->data.try_catch.finally_body, platform);
        return err;

    case IR_NEW_ARRAY:
    case IR_NEW_SET:
        for (size_t i = 0; i < node->data.new_collection.num_items; i++) {
            err = check_platform_types(node->data.new_collection.items[i], platform);
            if (err) return err;
        }
        return NULL;

    case IR_NEW_DICT:
        for (size_t i = 0; i < node->data.new_dict.num_pairs; i++) {
            err = check_platform_types(node->data.new_dict.keys[i], platform);
            if (!err) err = check_platform_types(node->data.new_dict.values[i], platform);
            if (err) return err;
        }
        return NULL;

    case IR_NEW_REF:
        return check_platform_types(node->data.new_ref.value, platform);

    case IR_NEW_VECTOR:
        for (size_t i = 0; i < node->data.new_vector.num_items; i++) {
            err = check_platform_types(node->data.new_vector.items[i], platform);
            if (err) return err;
        }
        return NULL;

    case IR_NEW_MATRIX:
        for (size_t i = 0; i < node->data.new_matrix.num_items; i++) {
            err = check_platform_types(node->data.new_matrix.items[i], platform);
            if (err) return err;
        }
        return NULL;

    case IR_STRUCT:
        for (size_t i = 0; i < node->data.struct_.num_fields; i++) {
            err = check_platform_types(node->data.struct_.field_values[i], platform);
            if (err) return err;
        }
        return NULL;

    case IR_GET_FIELD:
        return check_platform_types(node->data.get_field.expr, platform);
    case IR_VARIANT:
        return check_platform_types(node->data.variant.value, platform);

    case IR_WRAP_RECURSIVE:
    case IR_UNWRAP_RECURSIVE:
        return check_platform_types(node->data.recursive.value, platform);
    }

    return NULL;
}

/* ------------------------------------------------------------------ */
/*  Top-level API                                                      */
/* ------------------------------------------------------------------ */

EastCompiledFn *east_compile_checked(IRNode *ir, PlatformRegistry *platform,
                                     BuiltinRegistry *builtins, char **error_out)
{
    if (error_out) *error_out = NULL;

    if (ir && platform) {
        char *err = check_platform_types(ir, platform);
        if (err) {
            if (error_out)
                *error_out = err;
            else
                free(err);
            return NULL;
        }
    }

    EastCompiledFn *fn = calloc(1, sizeof(EastCompiledFn));
    if (!fn) return NULL;

    ir_node_retain(ir);
    fn->ir = ir;
    fn->captures = env_new(NULL);
    fn->param_names = NULL;
    fn->num_params = 0;
    fn->platform = platform;
    if (platform) platform_registry_retain(platform);
    fn->builtins = builtins;
    fn->fn_type = ir->type; /* function type for foreign-runtime type marshalling */

    return fn;
}

EastCompiledFn *east_compile(IRNode *ir, PlatformRegistry *platform, BuiltinRegistry *builtins)
{
    return east_compile_checked(ir, platform, builtins, NULL);
}

/* ------------------------------------------------------------------ */
/*  east_call                                                          */
/* ------------------------------------------------------------------ */

static _Thread_local int east_call_depth = 0;
static _Thread_local PlatformRegistry *current_platform = NULL;
static _Thread_local BuiltinRegistry *current_builtins = NULL;

PlatformRegistry *east_current_platform(void)
{
    return current_platform;
}
BuiltinRegistry *east_current_builtins(void)
{
    return current_builtins;
}

void east_set_thread_context(PlatformRegistry *p, BuiltinRegistry *b)
{
    current_platform = p;
    current_builtins = b;
}

void east_get_thread_context(PlatformRegistry **out_p, BuiltinRegistry **out_b)
{
    if (out_p) *out_p = current_platform;
    if (out_b) *out_b = current_builtins;
}

void east_set_source_map(const EastSourceMap *sm)
{
    g_current_source_map = sm;
}

EvalResult east_call(EastCompiledFn *fn, EastValue **args, size_t num_args)
{
    if (!fn) return eval_error("null function");

    /* Foreign-runtime dispatch: if the function provides a custom invoke
     * hook (e.g. a callback into an embedding host), delegate to it.  Skips the
     * IR-eval path entirely.  Set thread-locals so any nested east_call /
     * platform call from within the foreign callback can resolve them. */
    if (fn->invoke) {
        PlatformRegistry *saved_platform = current_platform;
        BuiltinRegistry *saved_builtins = current_builtins;
        const EastSourceMap *saved_source_map = g_current_source_map;
        current_platform = fn->platform;
        current_builtins = fn->builtins;
        if (fn->source_map) g_current_source_map = fn->source_map;
        east_call_depth++;
        EvalResult r = fn->invoke(fn, args, num_args);
        east_call_depth--;
        if (east_call_depth == 0 && east_gc_should_collect()) {
            east_gc_collect();
        }
        current_platform = saved_platform;
        current_builtins = saved_builtins;
        g_current_source_map = saved_source_map;
        return r;
    }

    /* Lazy IR conversion: beast2-decoded functions defer convert_ir to first call */
    if (!fn->ir && fn->source_ir) east_compile_lazy(fn);
    if (!fn->ir) return eval_error("function has no IR body");

    /* Save and set current platform/builtins/source_map for nested access */
    PlatformRegistry *saved_platform = current_platform;
    BuiltinRegistry *saved_builtins = current_builtins;
    const EastSourceMap *saved_source_map = g_current_source_map;
    current_platform = fn->platform;
    current_builtins = fn->builtins;
    if (fn->source_map) g_current_source_map = fn->source_map;

    east_call_depth++;

    Environment *call_env = env_new(fn->captures);

    /* Bind arguments to parameter names.
     * env_set retains the value internally, so no extra retain needed. */
    for (size_t i = 0; i < fn->num_params && i < num_args; i++) {
        env_set(call_env, fn->param_names[i], args[i]);
    }

    EvalResult result = eval_ir(fn->ir, call_env, fn->platform, fn->builtins);
    env_release(call_env);

    /* If body returned via IR_RETURN, unwrap to EVAL_OK */
    if (result.status == EVAL_RETURN) {
        EastValue *ret_val = result.value;
        eval_result_free(&result);
        result = eval_ok(ret_val);
    }

    /* Run scheduled collection (young, or full when the old generation has
     * grown past the pacing thresholds — see gc.h) at outermost call return.
     * Young-only safe points also fire at loop back-edges within eval_ir. */
    east_call_depth--;
    if (east_call_depth == 0 && east_gc_should_collect()) {
        east_gc_collect();
    }

    /* Restore saved platform/builtins/source_map */
    current_platform = saved_platform;
    current_builtins = saved_builtins;
    g_current_source_map = saved_source_map;

    return result;
}

EastValue *east_foreign_function(EastInvokeFn invoke, void *userdata,
                                 void (*invoke_release)(void *userdata), EastType *fn_type)
{
    EastCompiledFn *fn = east_calloc(1, sizeof(EastCompiledFn));
    if (!fn) {
        if (invoke_release) invoke_release(userdata);
        return NULL;
    }
    fn->invoke = invoke;
    fn->invoke_userdata = userdata;
    fn->invoke_release = invoke_release;
    fn->fn_type = fn_type; /* borrowed, per struct contract */
    return east_function_value(fn);
}

void east_compiled_fn_free(EastCompiledFn *fn)
{
    if (!fn) return;

    /* Foreign-runtime cleanup (e.g. release a handle held by an embedding host).
     * Must run before releasing IR/captures so user data can still reference
     * them if needed. */
    if (fn->invoke_release) {
        fn->invoke_release(fn->invoke_userdata);
        fn->invoke_release = NULL;
        fn->invoke_userdata = NULL;
        fn->invoke = NULL;
    }

    if (fn->ir) {
        ir_node_release(fn->ir);
        fn->ir = NULL;
    }

    if (fn->captures) {
        env_release(fn->captures);
        fn->captures = NULL;
    }

    if (fn->param_names) {
        for (size_t i = 0; i < fn->num_params; i++) {
            east_free(fn->param_names[i]);
        }
        east_free(fn->param_names);
        fn->param_names = NULL;
    }

    if (fn->source_ir) {
        east_value_release(fn->source_ir);
        fn->source_ir = NULL;
    }

    if (fn->platform) {
        platform_registry_release(fn->platform);
        fn->platform = NULL;
    }

    east_free(fn);
}
