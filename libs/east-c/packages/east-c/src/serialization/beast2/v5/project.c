/*
 * BEAST2 v5 column projection (issue #599, finishing #481 W3).
 *
 * A Beast2Projection is a validated plan mapping the WIRE type (what the
 * bytes hold) to a PROJECTED subset type (what the caller wants
 * materialized). Decoding walks the wire type byte-exactly — skipped struct
 * fields are parsed-and-hopped, never built into EastValues — and constructs
 * values of the projected type. Zero wire change: the same blob decodes
 * whole or projected, byte-identically.
 *
 * Two hard rules keep projection sound:
 *   - Dict keys and Set elements never project: they ORDER the container
 *     (b-tree inserts, strict-ascent checks, fences), and dropping a field
 *     changes East comparisons.
 *   - Skipped containers still register definitions (as B2V5_PROJ_SKIPPED),
 *     so REF backref deltas stay aligned with the encoder's numbering; a REF
 *     that crosses the projection boundary posts B2V5_PROJ_ALIAS_MSG and the
 *     caller falls back to a whole decode (wrong data is worse than no
 *     data).
 */

#include "internal_v5.h"

static const char b2v5_proj_skipped_marker;
const void *const B2V5_PROJ_SKIPPED = &b2v5_proj_skipped_marker;

/* ================================================================== */
/*  Plan construction + validation                                     */
/* ================================================================== */

static void proj_node_free(B2V5ProjNode *n)
{
    if (!n) return;
    for (size_t i = 0; i < n->n_children; i++)
        proj_node_free(n->children[i]);
    free(n->children);
    free(n->proj_idx);
    if (n->wire) east_type_release(n->wire);
    if (n->proj) east_type_release(n->proj);
    free(n);
}

static B2V5ProjNode *proj_node_new(EastType *wire, EastType *proj, int mode, size_t n_children)
{
    B2V5ProjNode *n = calloc(1, sizeof(*n));
    if (!n) return NULL;
    n->wire = wire;
    east_type_retain(wire);
    n->proj = proj;
    east_type_retain(proj);
    n->mode = mode;
    if (n_children) {
        n->children = calloc(n_children, sizeof(*n->children));
        if (!n->children) {
            proj_node_free(n);
            return NULL;
        }
        n->n_children = n_children;
    }
    return n;
}

/* Post an error that names both types (AC: validation errors name the
 * offending field and the wire type's fields). */
static void proj_type_error(const char *what, EastType *wire, EastType *proj)
{
    char *ws = east_print_type(wire);
    char *ps = east_print_type(proj);
    char msg[512];
    snprintf(msg, sizeof(msg), "beast2 v5 projection: %s — projected %s, wire %s", what,
             ps ? ps : "<type>", ws ? ws : "<type>");
    free(ws);
    free(ps);
    east_builtin_error(msg);
}

static void proj_missing_field_error(const char *field, EastType *wire)
{
    char fields[320];
    size_t off = 0;
    fields[0] = '\0';
    for (size_t i = 0; i < wire->data.struct_.num_fields && off + 6 < sizeof(fields); i++) {
        int wrote = snprintf(fields + off, sizeof(fields) - off, "%s%s", i ? ", " : "",
                             wire->data.struct_.fields[i].name);
        if (wrote < 0) break;
        off += (size_t)wrote;
        if (off >= sizeof(fields) - 6) {
            snprintf(fields + off, sizeof(fields) - off, "%s", ", ...");
            break;
        }
    }
    char msg[512];
    snprintf(msg, sizeof(msg),
             "beast2 v5 projection: field '%s' is not in the wire type — wire fields: %s", field,
             fields);
    east_builtin_error(msg);
}

/* Whether `t` contains a Function/AsyncFunction anywhere. Skipping a
 * function value means byte-walking an IR tree plus captures; that is a
 * decode in all but the allocation, so a plan that would skip one refuses
 * and the caller decodes whole instead. Depth-capped for recursive types. */
static bool type_contains_function(const EastType *t, int depth)
{
    if (!t || depth > 256) return false;
    switch (t->kind) {
    case EAST_TYPE_FUNCTION:
    case EAST_TYPE_ASYNC_FUNCTION:
        return true;
    case EAST_TYPE_ARRAY:
    case EAST_TYPE_SET:
    case EAST_TYPE_REF:
    case EAST_TYPE_VECTOR:
    case EAST_TYPE_MATRIX:
        return type_contains_function(t->data.element, depth + 1);
    case EAST_TYPE_DICT:
        return type_contains_function(t->data.dict.key, depth + 1) ||
               type_contains_function(t->data.dict.value, depth + 1);
    case EAST_TYPE_STRUCT:
        for (size_t i = 0; i < t->data.struct_.num_fields; i++)
            if (type_contains_function(t->data.struct_.fields[i].type, depth + 1)) return true;
        return false;
    case EAST_TYPE_VARIANT:
        for (size_t i = 0; i < t->data.variant.num_cases; i++)
            if (type_contains_function(t->data.variant.cases[i].type, depth + 1)) return true;
        return false;
    case EAST_TYPE_RECURSIVE:
        /* A recursive node's cycle is depth-capped above. */
        return type_contains_function(t->data.recursive.node, depth + 1);
    default:
        return false;
    }
}

static B2V5ProjNode *proj_build(EastType *wire, EastType *proj, int depth)
{
    if (!wire || !proj) return NULL;
    if (depth > BEAST2_MAX_DEPTH) {
        east_builtin_error("beast2 v5 projection: type nesting too deep");
        return NULL;
    }
    if (east_type_equal(wire, proj)) return proj_node_new(wire, proj, B2V5_PROJ_WHOLE, 0);

    if (wire->kind != proj->kind) {
        proj_type_error("projected type kind does not match the wire type", wire, proj);
        return NULL;
    }

    switch (wire->kind) {
    case EAST_TYPE_STRUCT: {
        size_t nf_wire = wire->data.struct_.num_fields;
        size_t nf_proj = proj->data.struct_.num_fields;
        B2V5ProjNode *n = proj_node_new(wire, proj, B2V5_PROJ_NARROW, nf_wire);
        if (!n) return NULL;
        n->proj_idx = malloc((nf_wire ? nf_wire : 1) * sizeof(int));
        if (!n->proj_idx) {
            proj_node_free(n);
            return NULL;
        }
        for (size_t i = 0; i < nf_wire; i++)
            n->proj_idx[i] = -1;
        for (size_t pi = 0; pi < nf_proj; pi++) {
            const char *name = proj->data.struct_.fields[pi].name;
            size_t wi = nf_wire;
            for (size_t i = 0; i < nf_wire; i++) {
                if (strcmp(wire->data.struct_.fields[i].name, name) == 0) {
                    wi = i;
                    break;
                }
            }
            if (wi == nf_wire) {
                proj_missing_field_error(name, wire);
                proj_node_free(n);
                return NULL;
            }
            if (n->proj_idx[wi] != -1) {
                proj_missing_field_error(name, wire); /* duplicate → same shape of error */
                proj_node_free(n);
                return NULL;
            }
            n->children[wi] = proj_build(wire->data.struct_.fields[wi].type,
                                         proj->data.struct_.fields[pi].type, depth + 1);
            if (!n->children[wi]) {
                proj_node_free(n);
                return NULL;
            }
            n->proj_idx[wi] = (int)pi;
        }
        for (size_t i = 0; i < nf_wire; i++) {
            if (n->children[i]) continue;
            if (type_contains_function(wire->data.struct_.fields[i].type, 0)) {
                char msg[256];
                snprintf(msg, sizeof(msg),
                         "beast2 v5 projection: cannot project away function-typed field '%s' — "
                         "function values must decode whole",
                         wire->data.struct_.fields[i].name);
                east_builtin_error(msg);
                proj_node_free(n);
                return NULL;
            }
        }
        return n;
    }

    case EAST_TYPE_VARIANT: {
        size_t nc = wire->data.variant.num_cases;
        if (proj->data.variant.num_cases != nc) {
            proj_type_error("variant case lists must match exactly (the wire encodes case "
                            "indices); case payloads may project",
                            wire, proj);
            return NULL;
        }
        for (size_t i = 0; i < nc; i++) {
            if (strcmp(wire->data.variant.cases[i].name, proj->data.variant.cases[i].name) != 0) {
                proj_type_error("variant case lists must match exactly (the wire encodes case "
                                "indices); case payloads may project",
                                wire, proj);
                return NULL;
            }
        }
        B2V5ProjNode *n = proj_node_new(wire, proj, B2V5_PROJ_NARROW, nc);
        if (!n) return NULL;
        for (size_t i = 0; i < nc; i++) {
            n->children[i] = proj_build(wire->data.variant.cases[i].type,
                                        proj->data.variant.cases[i].type, depth + 1);
            if (!n->children[i]) {
                proj_node_free(n);
                return NULL;
            }
        }
        return n;
    }

    case EAST_TYPE_ARRAY:
    case EAST_TYPE_REF: {
        B2V5ProjNode *n = proj_node_new(wire, proj, B2V5_PROJ_NARROW, 1);
        if (!n) return NULL;
        n->children[0] = proj_build(wire->data.element, proj->data.element, depth + 1);
        if (!n->children[0]) {
            proj_node_free(n);
            return NULL;
        }
        return n;
    }

    case EAST_TYPE_SET:
        proj_type_error("Set elements cannot project — they are the container's keys "
                        "(element order and identity would change)",
                        wire, proj);
        return NULL;

    case EAST_TYPE_DICT: {
        if (!east_type_equal(wire->data.dict.key, proj->data.dict.key)) {
            proj_type_error("Dict keys cannot project — they order the container; the projected "
                            "key type must equal the wire key type",
                            wire, proj);
            return NULL;
        }
        B2V5ProjNode *n = proj_node_new(wire, proj, B2V5_PROJ_NARROW, 1);
        if (!n) return NULL;
        n->children[0] = proj_build(wire->data.dict.value, proj->data.dict.value, depth + 1);
        if (!n->children[0]) {
            proj_node_free(n);
            return NULL;
        }
        return n;
    }

    default:
        /* Primitives, Blob, DateTime, Vector, Matrix, Function, Recursive:
         * the projected type must be identical (checked above). */
        proj_type_error("this type must be identical to the wire type to decode (only struct "
                        "fields subset; variant payloads, array elements and dict values may "
                        "project within)",
                        wire, proj);
        return NULL;
    }
}

Beast2Projection *east_beast2_projection_new(EastType *wire, EastType *proj)
{
    if (!wire || !proj) {
        east_builtin_error("beast2 v5 projection: needs a wire type and a projected type");
        return NULL;
    }
    B2V5ProjNode *root = proj_build(wire, proj, 0);
    if (!root) return NULL;
    Beast2Projection *pr = calloc(1, sizeof(*pr));
    if (!pr) {
        proj_node_free(root);
        return NULL;
    }
    pr->root = root;
    return pr;
}

void east_beast2_projection_free(Beast2Projection *pr)
{
    if (!pr) return;
    proj_node_free(pr->root);
    free(pr);
}

EastType *east_beast2_projection_wire_type(Beast2Projection *pr)
{
    return pr ? pr->root->wire : NULL;
}

EastType *east_beast2_projection_root_type(Beast2Projection *pr)
{
    return pr ? pr->root->proj : NULL;
}

bool east_beast2_projection_is_identity(Beast2Projection *pr)
{
    return pr && pr->root->mode == B2V5_PROJ_WHOLE;
}

/* ================================================================== */
/*  Paged for-loop inference (task inputs, #599)                       */
/* ================================================================== */
/*
 * A compiled body iterating a paged input (`for el in input: ...`) knows —
 * in its IR — exactly which struct fields it reads from the loop variable.
 * Derive the mask by walking the body for the maximal GetField chains
 * rooted at the variable; any other use (the variable escaping whole, a
 * shadowing binder, a node kind this walker has not been taught) declines,
 * and the loop decodes whole exactly as before. The observability contract
 * (an inferred optimisation must be visible when it stops applying) is the
 * pair of thread-local counters surfaced through eager_stats().
 */

static _Thread_local size_t g_paged_loop_projected = 0;
static _Thread_local size_t g_paged_loop_whole = 0;

void east_beast2_paged_loop_count(bool projected)
{
    if (projected)
        g_paged_loop_projected++;
    else
        g_paged_loop_whole++;
}

void east_beast2_paged_loop_stats(size_t *projected, size_t *whole)
{
    if (projected) *projected = g_paged_loop_projected;
    if (whole) *whole = g_paged_loop_whole;
}

/* A mask tree over a struct row: names borrowed from the IR (which outlives
 * the loop); whole == true marks a subtree needed in full. */
typedef struct PagedMask {
    bool whole;
    size_t n, cap;
    const char **names;
    struct PagedMask **sub;
} PagedMask;

static PagedMask *mask_new(void)
{
    return calloc(1, sizeof(PagedMask));
}

static void mask_free(PagedMask *m)
{
    if (!m) return;
    for (size_t i = 0; i < m->n; i++)
        mask_free(m->sub[i]);
    free(m->names);
    free(m->sub);
    free(m);
}

static PagedMask *mask_child(PagedMask *m, const char *name)
{
    for (size_t i = 0; i < m->n; i++)
        if (strcmp(m->names[i], name) == 0) return m->sub[i];
    if (m->n == m->cap) {
        size_t cap = m->cap ? m->cap * 2 : 4;
        const char **names = realloc(m->names, cap * sizeof(*names));
        if (!names) return NULL;
        m->names = names;
        PagedMask **sub = realloc(m->sub, cap * sizeof(*sub));
        if (!sub) return NULL;
        m->sub = sub;
        m->cap = cap;
    }
    PagedMask *child = mask_new();
    if (!child) return NULL;
    m->names[m->n] = name;
    m->sub[m->n] = child;
    m->n++;
    return child;
}

static bool mask_insert_path(PagedMask *m, const char **path, size_t n)
{
    if (m->whole) return true;
    if (n == 0) {
        m->whole = true;
        return true;
    }
    PagedMask *child = mask_child(m, path[0]);
    if (!child) return false;
    return mask_insert_path(child, path + 1, n - 1);
}

#define PAGED_MASK_MAX_PATH 64

/* Walk `node` collecting the mask for `target`. Returns false when the
 * variable escapes whole, a binder shadows it, or anything is not
 * positively recognized — the caller then declines the projection. */
static bool paged_mask_walk(const IRNode *node, const char *target, PagedMask *mask)
{
    if (!node) return true;

    switch (node->kind) {
    case IR_VALUE:
        return true;

    case IR_VARIABLE:
        return strcmp(node->data.variable.name, target) != 0;

    case IR_GET_FIELD: {
        const char *path[PAGED_MASK_MAX_PATH];
        size_t depth = 0;
        const IRNode *cur = node;
        while (cur->kind == IR_GET_FIELD) {
            if (depth == PAGED_MASK_MAX_PATH) return false;
            path[depth++] = cur->data.get_field.field_name;
            cur = cur->data.get_field.expr;
        }
        if (cur->kind == IR_VARIABLE && strcmp(cur->data.variable.name, target) == 0) {
            /* reverse in place: outermost access is deepest in the chain */
            for (size_t i = 0; i < depth / 2; i++) {
                const char *t = path[i];
                path[i] = path[depth - 1 - i];
                path[depth - 1 - i] = t;
            }
            return mask_insert_path(mask, path, depth);
        }
        return paged_mask_walk(cur, target, mask);
    }

    case IR_LET:
        if (strcmp(node->data.let.var.name, target) == 0) return false;
        return paged_mask_walk(node->data.let.value, target, mask);

    case IR_ASSIGN:
        if (strcmp(node->data.assign.var.name, target) == 0) return false;
        return paged_mask_walk(node->data.assign.value, target, mask);

    case IR_BLOCK:
        for (size_t i = 0; i < node->data.block.num_stmts; i++)
            if (!paged_mask_walk(node->data.block.stmts[i], target, mask)) return false;
        return true;

    case IR_IF_ELSE:
        return paged_mask_walk(node->data.if_else.cond, target, mask) &&
               paged_mask_walk(node->data.if_else.then_branch, target, mask) &&
               paged_mask_walk(node->data.if_else.else_branch, target, mask);

    case IR_MATCH:
        if (!paged_mask_walk(node->data.match.expr, target, mask)) return false;
        for (size_t i = 0; i < node->data.match.num_cases; i++) {
            IRMatchCase *mc = &node->data.match.cases[i];
            if (mc->bind.name && strcmp(mc->bind.name, target) == 0) return false;
            if (!paged_mask_walk(mc->body, target, mask)) return false;
        }
        return true;

    case IR_WHILE:
        return paged_mask_walk(node->data.while_.cond, target, mask) &&
               paged_mask_walk(node->data.while_.body, target, mask);

    case IR_FOR_ARRAY:
        if (strcmp(node->data.for_array.var.name, target) == 0) return false;
        if (node->data.for_array.index_var.name &&
            strcmp(node->data.for_array.index_var.name, target) == 0)
            return false;
        return paged_mask_walk(node->data.for_array.array, target, mask) &&
               paged_mask_walk(node->data.for_array.body, target, mask);

    case IR_FOR_SET:
        if (strcmp(node->data.for_set.var.name, target) == 0) return false;
        return paged_mask_walk(node->data.for_set.set, target, mask) &&
               paged_mask_walk(node->data.for_set.body, target, mask);

    case IR_FOR_DICT:
        if (strcmp(node->data.for_dict.key.name, target) == 0 ||
            strcmp(node->data.for_dict.val.name, target) == 0)
            return false;
        return paged_mask_walk(node->data.for_dict.dict, target, mask) &&
               paged_mask_walk(node->data.for_dict.body, target, mask);

    case IR_FUNCTION:
    case IR_ASYNC_FUNCTION:
        /* Parameter shadowing hides the target; captures are declarations
         * (the body's uses are what count). */
        for (size_t i = 0; i < node->data.function.num_params; i++)
            if (strcmp(node->data.function.params[i].name, target) == 0) return false;
        return paged_mask_walk(node->data.function.body, target, mask);

    case IR_CALL:
    case IR_CALL_ASYNC:
        if (!paged_mask_walk(node->data.call.func, target, mask)) return false;
        for (size_t i = 0; i < node->data.call.num_args; i++)
            if (!paged_mask_walk(node->data.call.args[i], target, mask)) return false;
        return true;

    case IR_PLATFORM:
        for (size_t i = 0; i < node->data.platform.num_args; i++)
            if (!paged_mask_walk(node->data.platform.args[i], target, mask)) return false;
        return true;

    case IR_BUILTIN:
        for (size_t i = 0; i < node->data.builtin.num_args; i++)
            if (!paged_mask_walk(node->data.builtin.args[i], target, mask)) return false;
        return true;

    case IR_RETURN:
        return paged_mask_walk(node->data.return_.value, target, mask);

    case IR_BREAK:
    case IR_CONTINUE:
        return true;

    case IR_ERROR:
        return paged_mask_walk(node->data.error.message, target, mask);

    case IR_TRY_CATCH:
        if ((node->data.try_catch.message_var.name &&
             strcmp(node->data.try_catch.message_var.name, target) == 0) ||
            (node->data.try_catch.stack_var.name &&
             strcmp(node->data.try_catch.stack_var.name, target) == 0))
            return false;
        return paged_mask_walk(node->data.try_catch.try_body, target, mask) &&
               paged_mask_walk(node->data.try_catch.catch_body, target, mask) &&
               paged_mask_walk(node->data.try_catch.finally_body, target, mask);

    case IR_NEW_ARRAY:
    case IR_NEW_SET:
        for (size_t i = 0; i < node->data.new_collection.num_items; i++)
            if (!paged_mask_walk(node->data.new_collection.items[i], target, mask)) return false;
        return true;

    case IR_NEW_DICT:
        for (size_t i = 0; i < node->data.new_dict.num_pairs; i++) {
            if (!paged_mask_walk(node->data.new_dict.keys[i], target, mask)) return false;
            if (!paged_mask_walk(node->data.new_dict.values[i], target, mask)) return false;
        }
        return true;

    case IR_NEW_REF:
        return paged_mask_walk(node->data.new_ref.value, target, mask);

    case IR_NEW_VECTOR:
        for (size_t i = 0; i < node->data.new_vector.num_items; i++)
            if (!paged_mask_walk(node->data.new_vector.items[i], target, mask)) return false;
        return true;

    case IR_NEW_MATRIX:
        for (size_t i = 0; i < node->data.new_matrix.num_items; i++)
            if (!paged_mask_walk(node->data.new_matrix.items[i], target, mask)) return false;
        return true;

    case IR_STRUCT:
        for (size_t i = 0; i < node->data.struct_.num_fields; i++)
            if (!paged_mask_walk(node->data.struct_.field_values[i], target, mask)) return false;
        return true;

    case IR_VARIANT:
        return paged_mask_walk(node->data.variant.value, target, mask);

    case IR_WRAP_RECURSIVE:
    case IR_UNWRAP_RECURSIVE:
        return paged_mask_walk(node->data.recursive.value, target, mask);
    }

    return false; /* a kind this walker has not been taught: decline */
}

/* The subset type `mask` keeps of `wire` (wire field order). Interned type
 * constructors — nothing to release. */
static EastType *mask_to_type(EastType *wire, const PagedMask *m)
{
    if (m->whole || wire->kind != EAST_TYPE_STRUCT) return wire;
    size_t nf = wire->data.struct_.num_fields;
    const char **names = malloc((nf ? nf : 1) * sizeof(*names));
    EastType **types = malloc((nf ? nf : 1) * sizeof(*types));
    if (!names || !types) {
        free(names);
        free(types);
        return wire;
    }
    size_t kept = 0;
    for (size_t i = 0; i < nf; i++) {
        const char *fname = wire->data.struct_.fields[i].name;
        for (size_t j = 0; j < m->n; j++) {
            if (strcmp(m->names[j], fname) == 0) {
                names[kept] = fname;
                types[kept] = mask_to_type(wire->data.struct_.fields[i].type, m->sub[j]);
                kept++;
                break;
            }
        }
    }
    EastType *narrow = east_struct_type(names, types, kept);
    free(names);
    free(types);
    return narrow ? narrow : wire;
}

Beast2Projection *east_beast2_projection_for_loop(const IRNode *body, const char *target,
                                                  EastType *root_type)
{
    if (!body || !target || !root_type) return NULL;
    EastType *row;
    if (root_type->kind == EAST_TYPE_ARRAY) {
        row = root_type->data.element;
    } else if (root_type->kind == EAST_TYPE_DICT) {
        row = root_type->data.dict.value;
    } else {
        return NULL; /* Set elements are keys — never narrow */
    }
    if (!row || row->kind != EAST_TYPE_STRUCT) return NULL;

    PagedMask *mask = mask_new();
    if (!mask) return NULL;
    if (!paged_mask_walk(body, target, mask) || mask->whole) {
        mask_free(mask);
        return NULL;
    }
    EastType *narrow_row = mask_to_type(row, mask);
    mask_free(mask);
    if (east_type_equal(narrow_row, row)) return NULL; /* every field read */

    EastType *narrow_root = root_type->kind == EAST_TYPE_ARRAY
                                ? east_array_type(narrow_row)
                                : east_dict_type(root_type->data.dict.key, narrow_row);
    Beast2Projection *pr = east_beast2_projection_new(root_type, narrow_root);
    if (!pr) {
        /* A plan the validator refuses (a skipped function field): decode
         * whole; the posted error must not leak into the loop's own. */
        free(east_builtin_get_error());
        return NULL;
    }
    return pr;
}

/* ================================================================== */
/*  Parse-and-skip                                                     */
/* ================================================================== */

static bool b2v5_skip_inner(const uint8_t *data, size_t len, size_t *offset, EastType *type,
                            B2V5DecodeCtx *ctx);

/* Skip one value of `type`. Sets the SKIPPED shape for the whole walk so
 * every container definition met inside records B2V5_PROJ_SKIPPED. */
static bool b2v5_skip_value(const uint8_t *data, size_t len, size_t *offset, EastType *type,
                            B2V5DecodeCtx *ctx)
{
    const void *save = ctx->cur_shape;
    ctx->cur_shape = B2V5_PROJ_SKIPPED;
    bool ok = b2v5_skip_inner(data, len, offset, type, ctx);
    ctx->cur_shape = save;
    return ok;
}

static bool b2v5_skip_inner(const uint8_t *data, size_t len, size_t *offset, EastType *type,
                            B2V5DecodeCtx *ctx)
{
    if (!type) return false;
    if (ctx->depth >= BEAST2_MAX_DEPTH) return false;
    ctx->depth++;
    bool ok = false;

    switch (type->kind) {
    case EAST_TYPE_NEVER:
    case EAST_TYPE_NULL:
        ok = true;
        break;

    case EAST_TYPE_BOOLEAN:
        ok = *offset < len;
        if (ok) (*offset)++;
        break;

    case EAST_TYPE_INTEGER:
    case EAST_TYPE_DATETIME: {
        int64_t v;
        ok = read_zigzag_checked(data, len, offset, &v);
        break;
    }

    case EAST_TYPE_FLOAT:
        ok = *offset + 8 <= len;
        if (ok) *offset += 8;
        break;

    case EAST_TYPE_STRING:
    case EAST_TYPE_BLOB: {
        uint64_t n;
        if (!read_varint_checked(data, len, offset, &n)) break;
        if (n > len - *offset) break;
        *offset += (size_t)n;
        ok = true;
        break;
    }

    case EAST_TYPE_VECTOR: {
        uint64_t n;
        if (!read_varint_checked(data, len, offset, &n)) break;
        size_t esz = type->data.element->kind == EAST_TYPE_BOOLEAN ? sizeof(bool) : sizeof(int64_t);
        if (n > (len - *offset) / esz) break;
        *offset += (size_t)n * esz;
        ok = true;
        break;
    }

    case EAST_TYPE_MATRIX: {
        uint64_t rows, cols;
        if (!read_varint_checked(data, len, offset, &rows)) break;
        if (!read_varint_checked(data, len, offset, &cols)) break;
        size_t esz = type->data.element->kind == EAST_TYPE_BOOLEAN ? sizeof(bool) : sizeof(int64_t);
        size_t max_elems = (len - *offset) / esz;
        if (rows > 0 && cols > max_elems / rows) break;
        *offset += (size_t)rows * (size_t)cols * esz;
        ok = true;
        break;
    }

    case EAST_TYPE_STRUCT: {
        ok = true;
        for (size_t i = 0; i < type->data.struct_.num_fields && ok; i++)
            ok = b2v5_skip_inner(data, len, offset, type->data.struct_.fields[i].type, ctx);
        break;
    }

    case EAST_TYPE_VARIANT: {
        uint64_t ci;
        if (!read_varint_checked(data, len, offset, &ci)) break;
        if (ci >= type->data.variant.num_cases) break;
        ok = b2v5_skip_inner(data, len, offset, type->data.variant.cases[ci].type, ctx);
        break;
    }

    case EAST_TYPE_ARRAY:
    case EAST_TYPE_SET:
    case EAST_TYPE_DICT:
    case EAST_TYPE_REF: {
        if (*offset >= len) break;
        uint8_t tag = data[(*offset)++];
        if (tag == B2V5_TAG_REF) {
            uint64_t delta;
            if (!read_varint_checked(data, len, offset, &delta)) break;
            ok = delta >= 1 && delta <= ctx->def_count;
            break;
        }
        if (tag != B2V5_TAG_NEW) break;
        /* The definition numbering must match the encoder's, so a skipped
         * container still consumes a definition slot — marked so a kept REF
         * reaching it fails loudly instead of resolving to nothing. */
        if (!b2v5_dec_ctx_push(ctx, NULL)) break;
        if (type->kind == EAST_TYPE_REF) {
            ok = b2v5_skip_inner(data, len, offset, type->data.element, ctx);
            break;
        }
        ok = true;
        for (;;) {
            uint64_t n;
            if (!read_varint_checked(data, len, offset, &n)) {
                ok = false;
                break;
            }
            if (n == 0) break;
            if (!b2_container_count_within_bounds(n, type, len - *offset)) {
                ok = false;
                break;
            }
            for (uint64_t j = 0; j < n && ok; j++) {
                if (type->kind == EAST_TYPE_DICT) {
                    ok = b2v5_skip_inner(data, len, offset, type->data.dict.key, ctx) &&
                         b2v5_skip_inner(data, len, offset, type->data.dict.value, ctx);
                } else {
                    ok = b2v5_skip_inner(data, len, offset, type->data.element, ctx);
                }
            }
            if (!ok) break;
        }
        break;
    }

    case EAST_TYPE_RECURSIVE:
        if (type->data.recursive.node)
            ok = b2v5_skip_inner(data, len, offset, type->data.recursive.node, ctx);
        break;

    case EAST_TYPE_FUNCTION:
    case EAST_TYPE_ASYNC_FUNCTION:
        /* Validation refuses plans that skip function-bearing fields. */
        east_builtin_error("beast2 v5 projection: cannot skip a function value");
        break;
    }

    ctx->depth--;
    return ok;
}

/* ================================================================== */
/*  Projected decode                                                   */
/* ================================================================== */

static bool proj_decode_container_content(EastValue *container, const B2V5ProjNode *node,
                                          const uint8_t *data, size_t len, size_t *offset,
                                          B2V5DecodeCtx *ctx);

EastValue *b2v5_decode_value_projected(const uint8_t *data, size_t len, size_t *offset,
                                       const B2V5ProjNode *node, B2V5DecodeCtx *ctx)
{
    if (!node) return NULL;
    if (node->mode == B2V5_PROJ_WHOLE) {
        /* A whole subtree decodes wire-shaped: NULL is its shape marker. */
        const void *save = ctx->cur_shape;
        ctx->cur_shape = NULL;
        EastValue *v = b2v5_decode_value(data, len, offset, node->wire, ctx);
        ctx->cur_shape = save;
        return v;
    }

    if (ctx->depth >= BEAST2_MAX_DEPTH) return NULL;
    ctx->depth++;
    EastValue *result = NULL;

    switch (node->wire->kind) {
    case EAST_TYPE_STRUCT: {
        size_t nf_wire = node->wire->data.struct_.num_fields;
        size_t nf_proj = node->proj->data.struct_.num_fields;
        const char **names = NULL;
        EastValue **values = NULL;
        if (nf_proj) {
            names = malloc(nf_proj * sizeof(char *));
            values = calloc(nf_proj, sizeof(EastValue *));
            if (!names || !values) {
                free(names);
                free(values);
                break;
            }
        }
        bool ok = true;
        for (size_t i = 0; i < nf_wire && ok; i++) {
            const B2V5ProjNode *child = node->children[i];
            if (!child) {
                ok = b2v5_skip_value(data, len, offset, node->wire->data.struct_.fields[i].type,
                                     ctx);
                continue;
            }
            EastValue *v = b2v5_decode_value_projected(data, len, offset, child, ctx);
            if (!v) {
                ok = false;
                break;
            }
            int pi = node->proj_idx[i];
            names[pi] = node->proj->data.struct_.fields[pi].name;
            values[pi] = v;
        }
        if (ok) result = east_struct_new(names, values, nf_proj, node->proj);
        for (size_t i = 0; i < nf_proj; i++)
            if (values && values[i]) east_value_release(values[i]);
        free(names);
        free(values);
        break;
    }

    case EAST_TYPE_VARIANT: {
        uint64_t ci;
        if (!read_varint_checked(data, len, offset, &ci)) break;
        if (ci >= node->wire->data.variant.num_cases) break;
        EastValue *payload =
            b2v5_decode_value_projected(data, len, offset, node->children[ci], ctx);
        if (!payload) break;
        result = east_variant_new_idx((size_t)ci, payload, node->proj);
        east_value_release(payload);
        break;
    }

    case EAST_TYPE_ARRAY:
    case EAST_TYPE_DICT: {
        ctx->cur_shape = (const void *)node;
        EastValue *aliased;
        int tag = b2v5_read_container_tag(data, len, offset, ctx, &aliased);
        if (tag < 0) break;
        if (tag == 1) {
            result = aliased;
            break;
        }
        EastValue *container =
            node->wire->kind == EAST_TYPE_ARRAY
                ? east_array_new(node->proj->data.element)
                : east_dict_new(node->proj->data.dict.key, node->proj->data.dict.value);
        if (!container) break;
        if (ctx->frozen) east_value_set_frozen(container);
        if (!b2v5_dec_ctx_push(ctx, container)) {
            east_value_release(container);
            break;
        }
        if (!proj_decode_container_content(container, node, data, len, offset, ctx)) {
            east_value_release(container);
            break;
        }
        result = container;
        break;
    }

    case EAST_TYPE_REF: {
        ctx->cur_shape = (const void *)node;
        EastValue *aliased;
        int tag = b2v5_read_container_tag(data, len, offset, ctx, &aliased);
        if (tag < 0) break;
        if (tag == 1) {
            result = aliased;
            break;
        }
        EastValue *cell = east_ref_new(east_null());
        if (!cell) break;
        if (ctx->frozen) east_value_set_frozen(cell);
        if (!b2v5_dec_ctx_push(ctx, cell)) {
            east_value_release(cell);
            break;
        }
        EastValue *inner = b2v5_decode_value_projected(data, len, offset, node->children[0], ctx);
        if (!inner) {
            east_value_release(cell);
            break;
        }
        east_ref_set(cell, inner);
        east_value_release(inner);
        result = cell;
        break;
    }

    default:
        /* Validation admits no other NARROW kinds. */
        break;
    }

    ctx->depth--;
    return result;
}

/* Segment-terminated content of a NARROW Array/Dict container. Dict keys
 * decode wire-shaped and whole (they never project); values through the
 * plan. The strict-ascent check runs on the (whole) keys exactly as in the
 * unprojected path. */
static bool proj_decode_container_content(EastValue *container, const B2V5ProjNode *node,
                                          const uint8_t *data, size_t len, size_t *offset,
                                          B2V5DecodeCtx *ctx)
{
    B2V5OrderCheck order = {0};
    B2V5OrderCheck *op = node->wire->kind == EAST_TYPE_DICT ? &order : NULL;
    bool ok = true;
    for (;;) {
        uint64_t n;
        if (!read_varint_checked(data, len, offset, &n)) {
            ok = false;
            break;
        }
        if (n == 0) break;
        if (!b2_container_count_within_bounds(n, node->wire, len - *offset)) {
            ok = false;
            break;
        }
        if (!b2v5_decode_elements_into_projected(container, node, n, data, len, offset, ctx, op)) {
            ok = false;
            break;
        }
    }
    b2v5_order_check_dispose(&order);
    return ok;
}

bool b2v5_decode_elements_into_projected(EastValue *container, const B2V5ProjNode *root, uint64_t n,
                                         const uint8_t *data, size_t len, size_t *offset,
                                         B2V5DecodeCtx *ctx, B2V5OrderCheck *order)
{
    switch (root->wire->kind) {
    case EAST_TYPE_ARRAY: {
        const B2V5ProjNode *elem = root->children[0];
        for (uint64_t j = 0; j < n; j++) {
            EastValue *val = b2v5_decode_value_projected(data, len, offset, elem, ctx);
            if (!val) return false;
            east_array_push(container, val);
            east_value_release(val);
        }
        return true;
    }
    case EAST_TYPE_DICT: {
        EastType *kt = root->wire->data.dict.key;
        const B2V5ProjNode *vnode = root->children[0];
        for (uint64_t j = 0; j < n; j++) {
            const void *save = ctx->cur_shape;
            ctx->cur_shape = NULL; /* keys decode wire-shaped */
            EastValue *k = b2v5_decode_value(data, len, offset, kt, ctx);
            ctx->cur_shape = save;
            if (!k) return false;
            if (order && !b2v5_order_accept(order, k, true)) {
                east_value_release(k);
                return false;
            }
            EastValue *v = b2v5_decode_value_projected(data, len, offset, vnode, ctx);
            if (!v) {
                east_value_release(k);
                return false;
            }
            east_dict_set(container, k, v);
            east_value_release(k);
            east_value_release(v);
        }
        return true;
    }
    default:
        return false;
    }
}
