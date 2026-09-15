/*
 * Static name resolution.
 *
 * Walks an IR tree once, after construction, with a compile-time chain of the
 * scopes the evaluator will open at run time, and annotates every Variable,
 * Let and Assign with the frame and cell its name binds to. The chain
 * mirrors the analyzer's rules and the evaluator's frames exactly: a Block
 * opens a frame only when it holds a direct Let; a Let binds sequentially
 * into the innermost open frame (a second Let of one name reuses the cell);
 * IfElse and While bind nothing; the For loops, a Match case and a catch
 * body open a frame with their binders; a Function body's frame holds its
 * params and sits on the definition-site chain, which is what a closure
 * captures.
 *
 * A name not found in the chain — a capture of a decoded closure, a value
 * bound from outside by name — stays unresolved and reads by name at run
 * time. The evaluator verifies a resolved read against the live frame
 * (scope identity, bound cell) and falls back to the name walk on any
 * mismatch, so resolution only ever shortens a lookup, never changes it.
 */
#include "east/ir.h"

#include <stdlib.h>
#include <string.h>

typedef struct RChain {
    IRScope *scope;
    struct RChain *parent;
} RChain;

static void resolve(IRNode *node, RChain *chain);

/* Where `name` is bound in the chain, if anywhere: (hops, slot) into
 * `scope`, which the annotation retains. */
static void lookup(const char *name, RChain *chain, IRScope **scope_out, uint32_t *hops_out,
                   uint32_t *slot_out)
{
    uint32_t hops = 0;
    for (RChain *c = chain; c; c = c->parent, hops++) {
        size_t i = ir_scope_find(c->scope, name);
        if (i == SIZE_MAX) continue;
        ir_scope_retain(c->scope);
        *scope_out = c->scope;
        *hops_out = hops;
        *slot_out = (uint32_t)i;
        return;
    }
}

static void resolve_all(IRNode **nodes, size_t n, RChain *chain)
{
    for (size_t i = 0; i < n; i++)
        resolve(nodes[i], chain);
}

static void resolve(IRNode *node, RChain *chain)
{
    if (!node) return;

    switch (node->kind) {
    case IR_VALUE:
    case IR_BREAK:
    case IR_CONTINUE:
        return;

    case IR_VARIABLE:
        lookup(node->data.variable.name, chain, &node->data.variable.scope,
               &node->data.variable.hops, &node->data.variable.slot);
        return;

    case IR_LET: {
        IRNode *value = node->data.let.value;
        resolve(value, chain);
        if (chain) {
            size_t slot = ir_scope_bind(chain->scope, node->data.let.var.name);
            if (slot != SIZE_MAX) {
                ir_scope_retain(chain->scope);
                node->data.let.scope = chain->scope;
                node->data.let.slot = (uint32_t)slot;
            }
        }
        /* A function bound straight to a Let is named after it, for the
         * profiler. */
        if (value && (value->kind == IR_FUNCTION || value->kind == IR_ASYNC_FUNCTION) &&
            !value->data.function.name && node->data.let.var.name)
            value->data.function.name = strdup(node->data.let.var.name);
        return;
    }

    case IR_ASSIGN:
        resolve(node->data.assign.value, chain);
        lookup(node->data.assign.var.name, chain, &node->data.assign.scope, &node->data.assign.hops,
               &node->data.assign.slot);
        return;

    case IR_BLOCK: {
        bool binds = false;
        for (size_t i = 0; i < node->data.block.num_stmts && !binds; i++)
            binds = node->data.block.stmts[i] && node->data.block.stmts[i]->kind == IR_LET;
        if (!binds) {
            resolve_all(node->data.block.stmts, node->data.block.num_stmts, chain);
            return;
        }
        IRScope *scope = ir_scope_new();
        if (!scope) return;
        node->data.block.scope = scope;
        RChain inner = {scope, chain};
        resolve_all(node->data.block.stmts, node->data.block.num_stmts, &inner);
        return;
    }

    case IR_IF_ELSE:
        resolve(node->data.if_else.cond, chain);
        resolve(node->data.if_else.then_branch, chain);
        resolve(node->data.if_else.else_branch, chain);
        return;

    case IR_MATCH:
        resolve(node->data.match.expr, chain);
        for (size_t i = 0; i < node->data.match.num_cases; i++) {
            IRMatchCase *mc = &node->data.match.cases[i];
            IRScope *scope = ir_scope_new();
            if (!scope) return;
            if (mc->bind.name) ir_scope_push(scope, mc->bind.name);
            mc->scope = scope;
            RChain inner = {scope, chain};
            resolve(mc->body, &inner);
        }
        return;

    case IR_WHILE:
        resolve(node->data.while_.cond, chain);
        resolve(node->data.while_.body, chain);
        return;

    case IR_FOR_ARRAY: {
        resolve(node->data.for_array.array, chain);
        IRScope *scope = ir_scope_new();
        if (!scope) return;
        ir_scope_push(scope, node->data.for_array.var.name);
        if (node->data.for_array.index_var.name)
            ir_scope_push(scope, node->data.for_array.index_var.name);
        node->data.for_array.scope = scope;
        RChain inner = {scope, chain};
        resolve(node->data.for_array.body, &inner);
        return;
    }

    case IR_FOR_SET: {
        resolve(node->data.for_set.set, chain);
        IRScope *scope = ir_scope_new();
        if (!scope) return;
        ir_scope_push(scope, node->data.for_set.var.name);
        node->data.for_set.scope = scope;
        RChain inner = {scope, chain};
        resolve(node->data.for_set.body, &inner);
        return;
    }

    case IR_FOR_DICT: {
        resolve(node->data.for_dict.dict, chain);
        IRScope *scope = ir_scope_new();
        if (!scope) return;
        ir_scope_push(scope, node->data.for_dict.key.name);
        ir_scope_push(scope, node->data.for_dict.val.name);
        node->data.for_dict.scope = scope;
        RChain inner = {scope, chain};
        resolve(node->data.for_dict.body, &inner);
        return;
    }

    case IR_FUNCTION:
    case IR_ASYNC_FUNCTION: {
        IRScope *scope = ir_scope_new();
        if (!scope) return;
        for (size_t i = 0; i < node->data.function.num_params; i++)
            ir_scope_push(scope, node->data.function.params[i].name);
        node->data.function.scope = scope;
        RChain inner = {scope, chain};
        resolve(node->data.function.body, &inner);
        return;
    }

    case IR_CALL:
    case IR_CALL_ASYNC:
        resolve(node->data.call.func, chain);
        resolve_all(node->data.call.args, node->data.call.num_args, chain);
        return;

    case IR_PLATFORM:
        resolve_all(node->data.platform.args, node->data.platform.num_args, chain);
        return;

    case IR_BUILTIN:
        resolve_all(node->data.builtin.args, node->data.builtin.num_args, chain);
        return;

    case IR_RETURN:
        resolve(node->data.return_.value, chain);
        return;

    case IR_ERROR:
        resolve(node->data.error.message, chain);
        return;

    case IR_TRY_CATCH: {
        resolve(node->data.try_catch.try_body, chain);
        IRScope *scope = ir_scope_new();
        if (!scope) return;
        const char *msg = node->data.try_catch.message_var.name;
        const char *stack = node->data.try_catch.stack_var.name;
        node->data.try_catch.message_slot =
            msg && msg[0] ? (uint32_t)ir_scope_push(scope, msg) : UINT32_MAX;
        node->data.try_catch.stack_slot =
            stack && stack[0] ? (uint32_t)ir_scope_push(scope, stack) : UINT32_MAX;
        node->data.try_catch.scope = scope;
        RChain inner = {scope, chain};
        resolve(node->data.try_catch.catch_body, &inner);
        resolve(node->data.try_catch.finally_body, chain);
        return;
    }

    case IR_NEW_ARRAY:
    case IR_NEW_SET:
        resolve_all(node->data.new_collection.items, node->data.new_collection.num_items, chain);
        return;

    case IR_NEW_DICT:
        resolve_all(node->data.new_dict.keys, node->data.new_dict.num_pairs, chain);
        resolve_all(node->data.new_dict.values, node->data.new_dict.num_pairs, chain);
        return;

    case IR_NEW_REF:
        resolve(node->data.new_ref.value, chain);
        return;

    case IR_NEW_VECTOR:
        resolve_all(node->data.new_vector.items, node->data.new_vector.num_items, chain);
        return;

    case IR_NEW_MATRIX:
        resolve_all(node->data.new_matrix.items, node->data.new_matrix.num_items, chain);
        return;

    case IR_STRUCT:
        resolve_all(node->data.struct_.field_values, node->data.struct_.num_fields, chain);
        return;

    case IR_GET_FIELD:
        resolve(node->data.get_field.expr, chain);
        return;

    case IR_VARIANT:
        resolve(node->data.variant.value, chain);
        return;

    case IR_WRAP_RECURSIVE:
    case IR_UNWRAP_RECURSIVE:
        resolve(node->data.recursive.value, chain);
        return;
    }
}

void ir_resolve_scopes(IRNode *root)
{
    resolve(root, NULL);
}
