/*
 * IR normalization: the canonical form two builders' IR converge on.
 * See include/east/ir_normalize.h for the contract.
 */
#include "east/ir_normalize.h"
#include "east/types.h"
#include "east/values.h"
#include "east/type_of_type.h"

#include <inttypes.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

/* ------------------------------------------------------------------ */
/*  Small value helpers                                                */
/* ------------------------------------------------------------------ */

static size_t field_idx(EastValue *s, const char *name)
{
    for (size_t i = 0; i < s->data.struct_.num_fields; i++)
        if (strcmp(east_struct_field_name(s, i), name) == 0) return i;
    return SIZE_MAX;
}

static EastValue *fld(EastValue *s, const char *name)
{
    size_t i = field_idx(s, name);
    return i == SIZE_MAX ? NULL : s->data.struct_.field_values[i];
}

/* A struct shaped like `proto` whose field values are `vals` (each
 * retained by the new struct; the caller's references are released). */
static EastValue *rebuild_struct(EastValue *proto, EastValue **vals)
{
    size_t n = proto->data.struct_.num_fields;
    const char **names = n ? malloc(n * sizeof(char *)) : NULL;
    for (size_t i = 0; i < n; i++)
        names[i] = east_struct_field_name(proto, i);
    EastValue *out = east_struct_new(names, vals, n, proto->data.struct_.type);
    free(names);
    for (size_t i = 0; i < n; i++)
        east_value_release(vals[i]);
    return out;
}

/* A variant of `proto`'s case holding `payload` (consumed). */
static EastValue *rebuild_variant(EastValue *proto, EastValue *payload)
{
    EastValue *out;
    if (proto->data.variant.case_idx != SIZE_MAX)
        out = east_variant_new_idx(proto->data.variant.case_idx, payload, proto->data.variant.type);
    else
        out = east_variant_new(proto->data.variant.case_tag, payload, proto->data.variant.type);
    east_value_release(payload);
    return out;
}

static const char *tag_of(EastValue *v)
{
    return v->data.variant.case_tag ? v->data.variant.case_tag : east_variant_case_name(v);
}

static EastValue *retained(EastValue *v)
{
    east_value_retain(v);
    return v;
}

/* ------------------------------------------------------------------ */
/*  Type canonicalization: recursive ids renumbered per type value      */
/* ------------------------------------------------------------------ */

typedef struct {
    int64_t *old_ids;
    int64_t *new_ids;
    size_t n, cap;
    int64_t next;
} TypeCtx;

static void type_ctx_push(TypeCtx *c, int64_t old, int64_t new_)
{
    if (c->n >= c->cap) {
        size_t nc = c->cap ? c->cap * 2 : 8;
        c->old_ids = realloc(c->old_ids, nc * sizeof(int64_t));
        c->new_ids = realloc(c->new_ids, nc * sizeof(int64_t));
        c->cap = nc;
    }
    c->old_ids[c->n] = old;
    c->new_ids[c->n] = new_;
    c->n++;
}

static EastValue *norm_type_ctx(EastValue *t, TypeCtx *c);

static EastValue *norm_type_struct_children(EastValue *s, TypeCtx *c)
{
    /* A struct whose fields are types (Dict {key, value}, Function {inputs, output},
     * a Struct/Variant member {name, type}, a wrapper {id, inner}). */
    size_t n = s->data.struct_.num_fields;
    EastValue **vals = n ? malloc(n * sizeof(EastValue *)) : NULL;
    for (size_t i = 0; i < n; i++) {
        EastValue *f = s->data.struct_.field_values[i];
        const char *name = east_struct_field_name(s, i);
        if (strcmp(name, "name") == 0 || strcmp(name, "id") == 0) {
            vals[i] = retained(f);
        } else if (f->kind == EAST_VAL_ARRAY) {
            EastValue *arr = east_array_new(f->data.array.elem_type);
            for (size_t j = 0; j < f->data.array.len; j++) {
                EastValue *item = f->data.array.items[j];
                EastValue *ni = item->kind == EAST_VAL_STRUCT ? norm_type_struct_children(item, c)
                                                              : norm_type_ctx(item, c);
                east_array_push(arr, ni);
                east_value_release(ni);
            }
            vals[i] = arr;
        } else if (f->kind == EAST_VAL_VARIANT) {
            vals[i] = norm_type_ctx(f, c);
        } else {
            vals[i] = retained(f);
        }
    }
    EastValue *out = rebuild_struct(s, vals);
    free(vals);
    return out;
}

static EastValue *norm_type_ctx(EastValue *t, TypeCtx *c)
{
    if (!t || t->kind != EAST_VAL_VARIANT) return retained(t);
    const char *tag = tag_of(t);
    EastValue *p = t->data.variant.value;
    if (strcmp(tag, "Recursive") == 0) {
        const char *rtag = tag_of(p);
        EastValue *rp = p->data.variant.value;
        if (strcmp(rtag, "ref") == 0) {
            int64_t old = rp->data.integer;
            int64_t new_ = old;
            for (size_t i = c->n; i-- > 0;) {
                if (c->old_ids[i] == old) {
                    new_ = c->new_ids[i];
                    break;
                }
            }
            EastValue *id = east_integer(new_);
            EastValue *ref = rebuild_variant(p, id);
            return rebuild_variant(t, ref);
        }
        /* wrapper {id, inner} */
        int64_t old = fld(rp, "id")->data.integer;
        int64_t new_ = c->next++;
        type_ctx_push(c, old, new_);
        size_t n = rp->data.struct_.num_fields;
        EastValue **vals = malloc(n * sizeof(EastValue *));
        for (size_t i = 0; i < n; i++) {
            const char *name = east_struct_field_name(rp, i);
            if (strcmp(name, "id") == 0)
                vals[i] = east_integer(new_);
            else
                vals[i] = norm_type_ctx(rp->data.struct_.field_values[i], c);
        }
        c->n--;
        EastValue *ws = rebuild_struct(rp, vals);
        free(vals);
        EastValue *wv = rebuild_variant(p, ws);
        return rebuild_variant(t, wv);
    }
    if (!p) return retained(t);
    if (p->kind == EAST_VAL_NULL) return retained(t);
    if (p->kind == EAST_VAL_VARIANT) {
        /* Array/Set/Ref/Vector/Matrix: payload is a type */
        return rebuild_variant(t, norm_type_ctx(p, c));
    }
    if (p->kind == EAST_VAL_STRUCT) {
        return rebuild_variant(t, norm_type_struct_children(p, c));
    }
    if (p->kind == EAST_VAL_ARRAY) {
        /* Struct/Variant: array of {name, type} */
        EastValue *arr = east_array_new(p->data.array.elem_type);
        for (size_t j = 0; j < p->data.array.len; j++) {
            EastValue *ni = norm_type_struct_children(p->data.array.items[j], c);
            east_array_push(arr, ni);
            east_value_release(ni);
        }
        return rebuild_variant(t, arr);
    }
    return retained(t);
}

static EastValue *norm_type(EastValue *t)
{
    TypeCtx c = {0};
    EastValue *out = norm_type_ctx(t, &c);
    free(c.old_ids);
    free(c.new_ids);
    return out;
}

/* ------------------------------------------------------------------ */
/*  Renaming context                                                   */
/* ------------------------------------------------------------------ */

typedef struct {
    const char *old; /* the input's name (borrowed from the input tree) */
    char *new_;      /* the canonical name (owned by Norm.names) */
    EastValue *decl; /* the normalized binding Variable node (retained) */
} Bind;

typedef struct {
    const char *old;
    char *new_;
} LabelBind;

typedef struct Fn {
    struct Fn *parent;
    Bind *binds;
    size_t n_binds, cap_binds;
    LabelBind *labels;
    size_t n_labels, cap_labels;
    char **captures; /* new names, first-resolution order */
    size_t n_captures, cap_captures;
} Fn;

typedef struct {
    int64_t n_vars, n_loops;
    char **names; /* every minted name, freed at the end */
    size_t n_names, cap_names;
    char **captured; /* the set of captured new names */
    size_t n_captured, cap_captured;
    int failed;
} Norm;

static char *mint(Norm *n, int64_t *counter)
{
    char buf[32];
    snprintf(buf, sizeof(buf), "_%" PRId64, (*counter)++);
    char *s = strdup(buf);
    if (n->n_names >= n->cap_names) {
        n->cap_names = n->cap_names ? n->cap_names * 2 : 64;
        n->names = realloc(n->names, n->cap_names * sizeof(char *));
    }
    n->names[n->n_names++] = s;
    return s;
}

static void fn_push_bind(Fn *fn, const char *old, char *new_, EastValue *decl)
{
    if (fn->n_binds >= fn->cap_binds) {
        fn->cap_binds = fn->cap_binds ? fn->cap_binds * 2 : 16;
        fn->binds = realloc(fn->binds, fn->cap_binds * sizeof(Bind));
    }
    fn->binds[fn->n_binds].old = old;
    fn->binds[fn->n_binds].new_ = new_;
    fn->binds[fn->n_binds].decl = decl;
    east_value_retain(decl);
    fn->n_binds++;
}

static void fn_restore_binds(Fn *fn, size_t n)
{
    while (fn->n_binds > n) {
        fn->n_binds--;
        east_value_release(fn->binds[fn->n_binds].decl);
    }
}

static void fn_push_label(Fn *fn, const char *old, char *new_)
{
    if (fn->n_labels >= fn->cap_labels) {
        fn->cap_labels = fn->cap_labels ? fn->cap_labels * 2 : 8;
        fn->labels = realloc(fn->labels, fn->cap_labels * sizeof(LabelBind));
    }
    fn->labels[fn->n_labels].old = old;
    fn->labels[fn->n_labels].new_ = new_;
    fn->n_labels++;
}

static void fn_add_capture(Fn *fn, char *new_)
{
    for (size_t i = 0; i < fn->n_captures; i++)
        if (fn->captures[i] == new_) return;
    if (fn->n_captures >= fn->cap_captures) {
        fn->cap_captures = fn->cap_captures ? fn->cap_captures * 2 : 8;
        fn->captures = realloc(fn->captures, fn->cap_captures * sizeof(char *));
    }
    fn->captures[fn->n_captures++] = new_;
}

static void norm_mark_captured(Norm *n, char *new_)
{
    for (size_t i = 0; i < n->n_captured; i++)
        if (n->captured[i] == new_) return;
    if (n->n_captured >= n->cap_captured) {
        n->cap_captured = n->cap_captured ? n->cap_captured * 2 : 16;
        n->captured = realloc(n->captured, n->cap_captured * sizeof(char *));
    }
    n->captured[n->n_captured++] = new_;
}

static Bind *fn_find_bind(Fn *fn, const char *old)
{
    for (size_t i = fn->n_binds; i-- > 0;)
        if (strcmp(fn->binds[i].old, old) == 0) return &fn->binds[i];
    return NULL;
}

/* Resolve a variable reference: the canonical name, with capture
 * bookkeeping on every function between the reference and the binding
 * (TypeScript's captures propagate outward as each nested function
 * completes — the same membership, in the same first-use order). */
static Bind *resolve_var(Norm *n, Fn *fn, const char *old)
{
    for (Fn *f = fn; f; f = f->parent) {
        Bind *b = fn_find_bind(f, old);
        if (b) {
            if (f != fn) {
                for (Fn *g = fn; g != f; g = g->parent)
                    fn_add_capture(g, b->new_);
                norm_mark_captured(n, b->new_);
            }
            return b;
        }
    }
    return NULL;
}

static char *resolve_label(Fn *fn, const char *old)
{
    if (fn->n_labels == 0) return NULL;
    if (old[0] == '\0') return fn->labels[fn->n_labels - 1].new_;
    for (size_t i = fn->n_labels; i-- > 0;)
        if (strcmp(fn->labels[i].old, old) == 0) return fn->labels[i].new_;
    return NULL;
}

static void fn_free(Fn *fn)
{
    fn_restore_binds(fn, 0);
    free(fn->binds);
    free(fn->labels);
    free(fn->captures);
}

/* ------------------------------------------------------------------ */
/*  Node normalization                                                 */
/* ------------------------------------------------------------------ */

static EastValue *norm_node(Norm *n, Fn *fn, EastValue *node);

/* A Variable node rebuilt with `name` (a reference or a fresh binding),
 * loc_id 0, canonical type and captured=false (stamped later). */
static EastValue *variable_named(EastValue *var, const char *name)
{
    EastValue *p = var->data.variant.value;
    size_t nf = p->data.struct_.num_fields;
    EastValue **vals = malloc(nf * sizeof(EastValue *));
    for (size_t i = 0; i < nf; i++) {
        const char *f = east_struct_field_name(p, i);
        EastValue *v = p->data.struct_.field_values[i];
        if (strcmp(f, "loc_id") == 0)
            vals[i] = east_integer(0);
        else if (strcmp(f, "type") == 0)
            vals[i] = norm_type(v);
        else if (strcmp(f, "name") == 0)
            vals[i] = east_string(name);
        else if (strcmp(f, "captured") == 0)
            vals[i] = east_boolean(false);
        else
            vals[i] = retained(v);
    }
    EastValue *s = rebuild_struct(p, vals);
    free(vals);
    return rebuild_variant(var, s);
}

/* Mint a canonical name for a binding Variable node and bring it into scope. */
static EastValue *bind_variable(Norm *n, Fn *fn, EastValue *var)
{
    EastValue *p = var->data.variant.value;
    const char *old = fld(p, "name")->data.string.data;
    char *new_ = mint(n, &n->n_vars);
    EastValue *decl = variable_named(var, new_);
    fn_push_bind(fn, old, new_, decl);
    return decl;
}

static EastValue *reference_variable(Norm *n, Fn *fn, EastValue *var)
{
    EastValue *p = var->data.variant.value;
    const char *old = fld(p, "name")->data.string.data;
    Bind *b = resolve_var(n, fn, old);
    return variable_named(var, b ? b->new_ : old);
}

static EastValue *norm_label(Norm *n, Fn *fn, EastValue *label, bool bind)
{
    /* {name, loc_id} */
    const char *old = fld(label, "name")->data.string.data;
    char *new_;
    if (bind) {
        new_ = mint(n, &n->n_loops);
        fn_push_label(fn, old, new_);
    } else {
        new_ = resolve_label(fn, old);
    }
    size_t nf = label->data.struct_.num_fields;
    EastValue **vals = malloc(nf * sizeof(EastValue *));
    for (size_t i = 0; i < nf; i++) {
        const char *f = east_struct_field_name(label, i);
        if (strcmp(f, "loc_id") == 0)
            vals[i] = east_integer(0);
        else if (strcmp(f, "name") == 0)
            vals[i] = east_string(new_ ? new_ : old);
        else
            vals[i] = retained(label->data.struct_.field_values[i]);
    }
    EastValue *out = rebuild_struct(label, vals);
    free(vals);
    return out;
}

static EastValue *norm_nodes(Norm *n, Fn *fn, EastValue *arr)
{
    EastValue *out = east_array_new(arr->data.array.elem_type);
    for (size_t i = 0; i < arr->data.array.len; i++) {
        EastValue *ni = norm_node(n, fn, arr->data.array.items[i]);
        east_array_push(out, ni);
        east_value_release(ni);
    }
    return out;
}

static EastValue *norm_types(EastValue *arr)
{
    EastValue *out = east_array_new(arr->data.array.elem_type);
    for (size_t i = 0; i < arr->data.array.len; i++) {
        EastValue *ni = norm_type(arr->data.array.items[i]);
        east_array_push(out, ni);
        east_value_release(ni);
    }
    return out;
}

/* Struct-of-children arrays: Struct fields {name, value}, NewDict {key, value},
 * IfElse ifs {predicate, body}. Every child field is a node; `name` is kept. */
static EastValue *norm_entry_array(Norm *n, Fn *fn, EastValue *arr, const char *const *order,
                                   size_t n_order)
{
    EastValue *out = east_array_new(arr->data.array.elem_type);
    for (size_t i = 0; i < arr->data.array.len; i++) {
        EastValue *e = arr->data.array.items[i];
        size_t nf = e->data.struct_.num_fields;
        EastValue **vals = calloc(nf, sizeof(EastValue *));
        for (size_t k = 0; k < n_order; k++) {
            size_t idx = field_idx(e, order[k]);
            vals[idx] = norm_node(n, fn, e->data.struct_.field_values[idx]);
        }
        for (size_t j = 0; j < nf; j++)
            if (!vals[j]) vals[j] = retained(e->data.struct_.field_values[j]);
        EastValue *ne = rebuild_struct(e, vals);
        free(vals);
        east_array_push(out, ne);
        east_value_release(ne);
    }
    return out;
}

typedef struct {
    EastValue *proto;
    EastValue **vals;
    size_t n;
} Out;

static void out_init(Out *o, EastValue *proto)
{
    o->proto = proto;
    o->n = proto->data.struct_.num_fields;
    o->vals = calloc(o->n, sizeof(EastValue *));
}

static void out_set(Out *o, const char *name, EastValue *v)
{
    size_t i = field_idx(o->proto, name);
    if (i == SIZE_MAX) {
        east_value_release(v);
        return;
    }
    if (o->vals[i]) east_value_release(o->vals[i]);
    o->vals[i] = v;
}

static EastValue *out_finish(Out *o, EastValue *node)
{
    /* Common fields every node carries, then anything untouched is copied. */
    for (size_t i = 0; i < o->n; i++) {
        if (o->vals[i]) continue;
        const char *f = east_struct_field_name(o->proto, i);
        EastValue *v = o->proto->data.struct_.field_values[i];
        if (strcmp(f, "loc_id") == 0)
            o->vals[i] = east_integer(0);
        else if (strcmp(f, "type") == 0)
            o->vals[i] = norm_type(v);
        else if (strcmp(f, "type_parameters") == 0)
            o->vals[i] = norm_types(v);
        else
            o->vals[i] = retained(v);
    }
    EastValue *s = rebuild_struct(o->proto, o->vals);
    free(o->vals);
    return rebuild_variant(node, s);
}

static EastValue *norm_function(Norm *n, Fn *parent, EastValue *node)
{
    EastValue *p = node->data.variant.value;
    Fn fn = {0};
    fn.parent = parent;
    Out o;
    out_init(&o, p);

    /* parameters are minted at entry, in order */
    EastValue *params = fld(p, "parameters");
    EastValue *nparams = east_array_new(params->data.array.elem_type);
    for (size_t i = 0; i < params->data.array.len; i++) {
        EastValue *decl = bind_variable(n, &fn, params->data.array.items[i]);
        east_array_push(nparams, decl);
        east_value_release(decl);
    }
    out_set(&o, "parameters", nparams);
    out_set(&o, "body", norm_node(n, &fn, fld(p, "body")));

    /* captures: the outer variables the body resolved, first-use order,
     * each entry the binding's own normalized Variable node */
    EastValue *caps = fld(p, "captures");
    EastValue *ncaps = east_array_new(caps->data.array.elem_type);
    for (size_t i = 0; i < fn.n_captures; i++) {
        EastValue *decl = NULL;
        for (Fn *f = parent; f && !decl; f = f->parent) {
            for (size_t j = f->n_binds; j-- > 0;) {
                if (f->binds[j].new_ == fn.captures[i]) {
                    decl = f->binds[j].decl;
                    break;
                }
            }
        }
        if (decl) east_array_push(ncaps, decl);
    }
    out_set(&o, "captures", ncaps);
    fn_free(&fn);
    return out_finish(&o, node);
}

static EastValue *norm_node(Norm *n, Fn *fn, EastValue *node)
{
    if (!node || node->kind != EAST_VAL_VARIANT) return retained(node);
    const char *kind = tag_of(node);
    EastValue *p = node->data.variant.value;

    if (strcmp(kind, "Variable") == 0) return reference_variable(n, fn, node);
    if (strcmp(kind, "Function") == 0 || strcmp(kind, "AsyncFunction") == 0)
        return norm_function(n, fn, node);

    Out o;
    out_init(&o, p);

    if (strcmp(kind, "Value") == 0) {
        /* literal payload kept; type canonicalized by out_finish */
    } else if (strcmp(kind, "Let") == 0) {
        out_set(&o, "value", norm_node(n, fn, fld(p, "value")));
        EastValue *decl = bind_variable(n, fn, fld(p, "variable"));
        out_set(&o, "variable", decl);
    } else if (strcmp(kind, "Assign") == 0) {
        out_set(&o, "variable", reference_variable(n, fn, fld(p, "variable")));
        out_set(&o, "value", norm_node(n, fn, fld(p, "value")));
    } else if (strcmp(kind, "Block") == 0) {
        size_t mark = fn->n_binds;
        out_set(&o, "statements", norm_nodes(n, fn, fld(p, "statements")));
        fn_restore_binds(fn, mark);
    } else if (strcmp(kind, "As") == 0 || strcmp(kind, "WrapRecursive") == 0 ||
               strcmp(kind, "UnwrapRecursive") == 0 || strcmp(kind, "Return") == 0 ||
               strcmp(kind, "NewRef") == 0 || strcmp(kind, "Variant") == 0) {
        out_set(&o, "value", norm_node(n, fn, fld(p, "value")));
    } else if (strcmp(kind, "Error") == 0) {
        out_set(&o, "message", norm_node(n, fn, fld(p, "message")));
    } else if (strcmp(kind, "GetField") == 0) {
        out_set(&o, "struct", norm_node(n, fn, fld(p, "struct")));
    } else if (strcmp(kind, "Call") == 0 || strcmp(kind, "CallAsync") == 0) {
        out_set(&o, "function", norm_node(n, fn, fld(p, "function")));
        out_set(&o, "arguments", norm_nodes(n, fn, fld(p, "arguments")));
    } else if (strcmp(kind, "Builtin") == 0 || strcmp(kind, "Platform") == 0) {
        out_set(&o, "arguments", norm_nodes(n, fn, fld(p, "arguments")));
    } else if (strcmp(kind, "Struct") == 0) {
        static const char *const order[] = {"value"};
        out_set(&o, "fields", norm_entry_array(n, fn, fld(p, "fields"), order, 1));
    } else if (strcmp(kind, "NewArray") == 0 || strcmp(kind, "NewSet") == 0 ||
               strcmp(kind, "NewVector") == 0 || strcmp(kind, "NewMatrix") == 0) {
        out_set(&o, "values", norm_nodes(n, fn, fld(p, "values")));
    } else if (strcmp(kind, "NewDict") == 0) {
        static const char *const order[] = {"key", "value"};
        out_set(&o, "values", norm_entry_array(n, fn, fld(p, "values"), order, 2));
    } else if (strcmp(kind, "IfElse") == 0) {
        static const char *const order[] = {"predicate", "body"};
        out_set(&o, "ifs", norm_entry_array(n, fn, fld(p, "ifs"), order, 2));
        out_set(&o, "else_body", norm_node(n, fn, fld(p, "else_body")));
    } else if (strcmp(kind, "Match") == 0) {
        out_set(&o, "variant", norm_node(n, fn, fld(p, "variant")));
        EastValue *cases = fld(p, "cases");
        EastValue *ncases = east_array_new(cases->data.array.elem_type);
        for (size_t i = 0; i < cases->data.array.len; i++) {
            EastValue *c = cases->data.array.items[i];
            size_t nf = c->data.struct_.num_fields;
            EastValue **vals = calloc(nf, sizeof(EastValue *));
            size_t mark = fn->n_binds;
            vals[field_idx(c, "variable")] = bind_variable(n, fn, fld(c, "variable"));
            vals[field_idx(c, "body")] = norm_node(n, fn, fld(c, "body"));
            fn_restore_binds(fn, mark);
            for (size_t j = 0; j < nf; j++)
                if (!vals[j]) vals[j] = retained(c->data.struct_.field_values[j]);
            EastValue *nc = rebuild_struct(c, vals);
            free(vals);
            east_array_push(ncases, nc);
            east_value_release(nc);
        }
        out_set(&o, "cases", ncases);
    } else if (strcmp(kind, "While") == 0) {
        out_set(&o, "predicate", norm_node(n, fn, fld(p, "predicate")));
        size_t lmark = fn->n_labels;
        out_set(&o, "label", norm_label(n, fn, fld(p, "label"), true));
        out_set(&o, "body", norm_node(n, fn, fld(p, "body")));
        fn->n_labels = lmark;
    } else if (strcmp(kind, "ForArray") == 0 || strcmp(kind, "ForSet") == 0 ||
               strcmp(kind, "ForDict") == 0) {
        const char *src = strcmp(kind, "ForArray") == 0 ? "array"
                          : strcmp(kind, "ForSet") == 0 ? "set"
                                                        : "dict";
        out_set(&o, src, norm_node(n, fn, fld(p, src)));
        size_t lmark = fn->n_labels;
        size_t mark = fn->n_binds;
        out_set(&o, "label", norm_label(n, fn, fld(p, "label"), true));
        if (strcmp(kind, "ForSet") == 0) {
            out_set(&o, "key", bind_variable(n, fn, fld(p, "key")));
        } else {
            out_set(&o, "value", bind_variable(n, fn, fld(p, "value")));
            out_set(&o, "key", bind_variable(n, fn, fld(p, "key")));
        }
        out_set(&o, "body", norm_node(n, fn, fld(p, "body")));
        fn_restore_binds(fn, mark);
        fn->n_labels = lmark;
    } else if (strcmp(kind, "Break") == 0 || strcmp(kind, "Continue") == 0) {
        out_set(&o, "label", norm_label(n, fn, fld(p, "label"), false));
    } else if (strcmp(kind, "TryCatch") == 0) {
        out_set(&o, "try_body", norm_node(n, fn, fld(p, "try_body")));
        size_t mark = fn->n_binds;
        out_set(&o, "message", bind_variable(n, fn, fld(p, "message")));
        out_set(&o, "stack", bind_variable(n, fn, fld(p, "stack")));
        out_set(&o, "catch_body", norm_node(n, fn, fld(p, "catch_body")));
        fn_restore_binds(fn, mark);
        out_set(&o, "finally_body", norm_node(n, fn, fld(p, "finally_body")));
    } else {
        n->failed = 1;
    }
    return out_finish(&o, node);
}

/* ------------------------------------------------------------------ */
/*  Pass 2: the captured flag                                          */
/* ------------------------------------------------------------------ */

static bool is_captured(Norm *n, const char *name)
{
    for (size_t i = 0; i < n->n_captured; i++)
        if (strcmp(n->captured[i], name) == 0) return true;
    return false;
}

static EastValue *stamp(Norm *n, EastValue *v)
{
    if (!v) return NULL;
    if (v->kind == EAST_VAL_VARIANT) {
        EastValue *p = v->data.variant.value;
        if (p && p->kind == EAST_VAL_STRUCT && strcmp(tag_of(v), "Variable") == 0 &&
            fld(p, "captured")) {
            bool want = is_captured(n, fld(p, "name")->data.string.data);
            size_t nf = p->data.struct_.num_fields;
            EastValue **vals = malloc(nf * sizeof(EastValue *));
            for (size_t i = 0; i < nf; i++) {
                const char *f = east_struct_field_name(p, i);
                vals[i] = strcmp(f, "captured") == 0 ? east_boolean(want)
                                                     : retained(p->data.struct_.field_values[i]);
            }
            EastValue *s = rebuild_struct(p, vals);
            free(vals);
            return rebuild_variant(v, s);
        }
        /* type values (EastTypeType) have no Variable nodes below them:
         * only descend into IR payloads — structs and arrays of nodes */
        if (!p || (p->kind != EAST_VAL_STRUCT && p->kind != EAST_VAL_ARRAY)) return retained(v);
        return rebuild_variant(v, stamp(n, p));
    }
    if (v->kind == EAST_VAL_STRUCT) {
        size_t nf = v->data.struct_.num_fields;
        EastValue **vals = malloc(nf * sizeof(EastValue *));
        for (size_t i = 0; i < nf; i++) {
            const char *f = east_struct_field_name(v, i);
            EastValue *c = v->data.struct_.field_values[i];
            if (strcmp(f, "type") == 0 || strcmp(f, "type_parameters") == 0)
                vals[i] = retained(c);
            else
                vals[i] = stamp(n, c);
        }
        EastValue *s = rebuild_struct(v, vals);
        free(vals);
        return s;
    }
    if (v->kind == EAST_VAL_ARRAY) {
        EastValue *out = east_array_new(v->data.array.elem_type);
        for (size_t i = 0; i < v->data.array.len; i++) {
            EastValue *c = stamp(n, v->data.array.items[i]);
            east_array_push(out, c);
            east_value_release(c);
        }
        return out;
    }
    return retained(v);
}

EastValue *east_ir_normalize(EastValue *ir)
{
    if (!ir) return NULL;
    Norm n = {0};
    Fn root = {0};
    EastValue *renamed = norm_node(&n, &root, ir);
    fn_free(&root);
    EastValue *out = NULL;
    if (!n.failed) out = stamp(&n, renamed);
    east_value_release(renamed);
    for (size_t i = 0; i < n.n_names; i++)
        free(n.names[i]);
    free(n.names);
    free(n.captured);
    return out;
}

/* ------------------------------------------------------------------ */
/*  Structural diff                                                    */
/* ------------------------------------------------------------------ */

typedef struct {
    char *buf;
    size_t len, cap;
} Path;

static void path_push(Path *p, const char *fmt, const char *s, size_t idx)
{
    char tmp[512];
    if (s)
        snprintf(tmp, sizeof(tmp), fmt, s);
    else
        snprintf(tmp, sizeof(tmp), fmt, idx);
    size_t add = strlen(tmp);
    if (p->len + add + 1 > p->cap) {
        p->cap = (p->len + add + 1) * 2;
        p->buf = realloc(p->buf, p->cap);
    }
    memcpy(p->buf + p->len, tmp, add + 1);
    p->len += add;
}

static void path_pop(Path *p, size_t len)
{
    p->len = len;
    p->buf[len] = '\0';
}

static bool diff_walk(EastValue *a, EastValue *b, Path *p)
{
    if (a == b) return true;
    if (!a || !b || a->kind != b->kind) return false;
    switch (a->kind) {
    case EAST_VAL_STRUCT: {
        if (a->data.struct_.num_fields != b->data.struct_.num_fields) return false;
        for (size_t i = 0; i < a->data.struct_.num_fields; i++) {
            const char *fa = east_struct_field_name(a, i);
            const char *fb = east_struct_field_name(b, i);
            size_t mark = p->len;
            path_push(p, ".%s", fa, 0);
            if (strcmp(fa, fb) != 0) return false;
            if (!diff_walk(a->data.struct_.field_values[i], b->data.struct_.field_values[i], p))
                return false;
            path_pop(p, mark);
        }
        return true;
    }
    case EAST_VAL_VARIANT: {
        const char *ta = tag_of(a), *tb = tag_of(b);
        size_t mark = p->len;
        path_push(p, "(%s)", ta, 0);
        if (strcmp(ta, tb) != 0) return false;
        if (!diff_walk(a->data.variant.value, b->data.variant.value, p)) return false;
        path_pop(p, mark);
        return true;
    }
    case EAST_VAL_ARRAY: {
        if (a->data.array.len != b->data.array.len) {
            path_push(p, ".length", NULL, 0);
            return false;
        }
        for (size_t i = 0; i < a->data.array.len; i++) {
            size_t mark = p->len;
            path_push(p, "[%zu]", NULL, i);
            if (!diff_walk(a->data.array.items[i], b->data.array.items[i], p)) return false;
            path_pop(p, mark);
        }
        return true;
    }
    default:
        return east_value_equal(a, b);
    }
}

char *east_value_diff_path(EastValue *a, EastValue *b)
{
    Path p = {0};
    path_push(&p, "%s", "$", 0);
    if (diff_walk(a, b, &p)) {
        free(p.buf);
        return NULL;
    }
    return p.buf;
}

/* ------------------------------------------------------------------ */
/*  Source-map values and the JSON IR wrapper type                     */
/* ------------------------------------------------------------------ */

static EastType *location_type(void)
{
    return east_struct_type(
        (const char *[]){"filename", "line", "column"},
        (EastType *[]){&east_string_type, &east_integer_type, &east_integer_type}, 3);
}

EastType *east_source_map_value_type(void)
{
    EastType *stacks = east_array_type(east_array_type(location_type()));
    return east_struct_type((const char *[]){"stacks"}, (EastType *[]){stacks}, 1);
}

EastType *east_ir_wrapper_type(void)
{
    if (!east_ir_type) east_type_of_type_init();
    return east_struct_type((const char *[]){"ir", "source_map"},
                            (EastType *[]){east_ir_type, east_source_map_value_type()}, 2);
}

EastValue *east_source_map_to_value(const EastSourceMap *sm)
{
    EastType *loc_t = location_type();
    EastType *stack_t = east_array_type(loc_t);
    EastValue *stacks = east_array_new(stack_t);
    size_t n = sm ? sm->num_stacks : 0;
    for (size_t i = 0; i < n; i++) {
        EastValue *stack = east_array_new(loc_t);
        for (size_t j = 0; j < sm->stack_counts[i]; j++) {
            const EastLocation *l = &sm->stacks[i][j];
            EastValue *vals[3] = {east_string(l->filename ? l->filename : ""),
                                  east_integer(l->line), east_integer(l->column)};
            EastValue *frame =
                east_struct_new((const char *[]){"filename", "line", "column"}, vals, 3, loc_t);
            for (int k = 0; k < 3; k++)
                east_value_release(vals[k]);
            east_array_push(stack, frame);
            east_value_release(frame);
        }
        east_array_push(stacks, stack);
        east_value_release(stack);
    }
    EastValue *out =
        east_struct_new((const char *[]){"stacks"}, &stacks, 1, east_source_map_value_type());
    east_value_release(stacks);
    return out;
}
