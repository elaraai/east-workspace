#include "internal.h"

/*  Direct Beast2 → IRNode decoder                                     */
/*                                                                     */
/*  Decodes beast2 IR binary directly into IRNode tree, bypassing the  */
/*  EastValue intermediate.  The IR variant layout (34 cases) is       */
/*  hardcoded — each case reads its fields in schema order and calls   */
/*  the corresponding ir_*() constructor directly.                     */
/*                                                                     */
/*  IR case indices (alphabetical — VariantType sorts cases by name):   */
/*   0:As          1:Assign      2:AsyncFn     3:Block                 */
/*   4:Break       5:Builtin     6:Call        7:CallAsync             */
/*   8:Continue    9:Error      10:ForArray   11:ForDict               */
/*  12:ForSet     13:Function   14:GetField   15:IfElse                */
/*  16:Let        17:Match      18:NewArray   19:NewDict               */
/*  20:NewMatrix  21:NewRef     22:NewSet     23:NewVector             */
/*  24:Platform   25:Return     26:Struct     27:TryCatch              */
/*  28:UnwrapRecursive 29:Value 30:Variable   31:Variant               */
/*  32:While      33:WrapRecursive                                     */
/*                                                                     */
/*  LiteralValue case indices (alphabetical):                          */
/*   0:Blob  1:Boolean  2:DateTime  3:Float  4:Integer  5:Null  6:String */
/* ================================================================== */

/* Forward declaration */
IRNode *b2ir_decode_node(const uint8_t *data, size_t len, size_t *offset,
                                EastType **types, size_t type_count,
                                Beast2StringTableDec *st);

/* ---- Helpers ---- */

static EastType *b2ir_read_type(const uint8_t *data, size_t *offset,
                                EastType **types, size_t type_count)
{
    uint64_t idx = read_varint(data, offset);
    if (idx < type_count && types[idx]) {
        east_type_retain(types[idx]);
        return types[idx];
    }
    return NULL;
}

static char *b2ir_read_string(const uint8_t *data, size_t len, size_t *offset,
                              Beast2StringTableDec *st)
{
    if (st) {
        uint64_t idx = read_varint(data, offset);
        if (idx < st->count) return strdup(st->strings[idx]);
        return strdup("");
    }
    size_t slen;
    char *s = b2_read_string_varint(data, len, offset, &slen);
    if (!s) return strdup("");
    char *dup = strdup(s);
    free(s);
    return dup;
}

static void b2ir_read_locations(const uint8_t *data, size_t len, size_t *offset,
                                Beast2StringTableDec *st,
                                IRNode *node)
{
    /* Location field is Array(Struct({filename, line, column})).
     * Array protocol: varint(distance), if 0 → varint(count) + elements. */
    uint64_t distance = read_varint(data, offset);
    if (distance > 0) return;  /* backref — skip locations for now */
    uint64_t count = read_varint(data, offset);
    if (count == 0) return;

    EastLocation *locs = calloc((size_t)count, sizeof(EastLocation));
    for (uint64_t i = 0; i < count; i++) {
        /* Each location struct: filename(String), line(Integer), column(Integer) */
        locs[i].filename = b2ir_read_string(data, len, offset, st);
        locs[i].line = read_zigzag(data, offset);
        locs[i].column = read_zigzag(data, offset);
    }
    node->locations = locs;
    node->num_locations = (size_t)count;
}

/* Read an array of IR nodes.  Caller must ir_node_release each + free the array. */
static IRNode **b2ir_read_ir_array(const uint8_t *data, size_t len, size_t *offset,
                                   EastType **types, size_t type_count,
                                   Beast2StringTableDec *st, size_t *out_n)
{
    uint64_t distance = read_varint(data, offset);
    if (distance > 0) { *out_n = 0; return NULL; }  /* backref — empty fallback */
    uint64_t count = read_varint(data, offset);
    *out_n = (size_t)count;
    if (count == 0) return NULL;

    IRNode **nodes = calloc((size_t)count, sizeof(IRNode *));
    for (uint64_t i = 0; i < count; i++) {
        nodes[i] = b2ir_decode_node(data, len, offset, types, type_count, st);
    }
    return nodes;
}

static EastType **b2ir_read_type_array(const uint8_t *data, size_t len, size_t *offset,
                                       EastType **types, size_t type_count,
                                       size_t *out_n)
{
    uint64_t distance = read_varint(data, offset);
    if (distance > 0) { *out_n = 0; return NULL; }
    uint64_t count = read_varint(data, offset);
    *out_n = (size_t)count;
    if (count == 0) return NULL;

    EastType **arr = calloc((size_t)count, sizeof(EastType *));
    for (uint64_t i = 0; i < count; i++) {
        arr[i] = b2ir_read_type(data, offset, types, type_count);
    }
    return arr;
}

/* Read a label struct: { name: String, location: [Location] } → just the name */
static char *b2ir_read_label(const uint8_t *data, size_t len, size_t *offset,
                             Beast2StringTableDec *st)
{
    char *name = b2ir_read_string(data, len, offset, st);
    /* Skip location array */
    uint64_t dist = read_varint(data, offset);
    if (dist == 0) {
        uint64_t loc_count = read_varint(data, offset);
        for (uint64_t i = 0; i < loc_count; i++) {
            /* Skip filename, line, column */
            if (st) read_varint(data, offset); else { size_t slen; char *s = b2_read_string_varint(data, len, offset, &slen); free(s); }
            read_zigzag(data, offset);
            read_zigzag(data, offset);
        }
    }
    return name;
}

/* Read a LiteralValue variant → EastValue* */
static EastValue *b2ir_read_literal(const uint8_t *data, size_t len, size_t *offset,
                                    Beast2StringTableDec *st)
{
    uint64_t case_idx = read_varint(data, offset);
    switch (case_idx) {
    case 0: /* Blob */ {
        uint64_t blen = read_varint(data, offset);
        EastValue *v = east_blob(data + *offset, (size_t)blen);
        *offset += (size_t)blen;
        return v;
    }
    case 1: /* Boolean */ return east_boolean(data[(*offset)++] != 0);
    case 2: /* DateTime */ return east_datetime(read_zigzag(data, offset));
    case 3: /* Float */   return east_float(b2_read_float64_le(data, offset));
    case 4: /* Integer */ return east_integer(read_zigzag(data, offset));
    case 5: /* Null */    return east_null();
    case 6: /* String */ {
        if (st) {
            uint64_t idx = read_varint(data, offset);
            if (idx < st->count) return east_string_len(st->strings[idx], st->lens[idx]);
            return east_string("");
        }
        size_t slen; char *s = b2_read_string_varint(data, len, offset, &slen);
        EastValue *v = east_string_len(s, slen); free(s); return v;
    }
    }
    return east_null();
}

/* Read a Variable IR node (case 3) → IRVariable + type.
 * Reads: type(EastTypeType), location([Location]), name(String), mutable(Bool), captured(Bool) */
typedef struct { IRVariable var; EastType *type; } B2IRVarWithType;

static B2IRVarWithType b2ir_read_variable(const uint8_t *data, size_t len,
                                          size_t *offset, EastType **types,
                                          size_t type_count, Beast2StringTableDec *st)
{
    B2IRVarWithType result = {0};
    result.type = b2ir_read_type(data, offset, types, type_count);
    /* Skip location */
    uint64_t dist = read_varint(data, offset);
    if (dist == 0) {
        uint64_t lc = read_varint(data, offset);
        for (uint64_t i = 0; i < lc; i++) {
            if (st) read_varint(data, offset); else { size_t slen; char *s = b2_read_string_varint(data, len, offset, &slen); free(s); }
            read_zigzag(data, offset);
            read_zigzag(data, offset);
        }
    }
    result.var.name = b2ir_read_string(data, len, offset, st);
    result.var.mutable = (data[(*offset)++] != 0);
    result.var.captured = (data[(*offset)++] != 0);
    return result;
}

/* Helper: free an IR node array (release each + free array) */
static void b2ir_free_nodes(IRNode **nodes, size_t n) {
    if (!nodes) return;
    for (size_t i = 0; i < n; i++) { if (nodes[i]) ir_node_release(nodes[i]); }
    free(nodes);
}

/* ---- Main direct decoder ---- */

IRNode *b2ir_decode_node(const uint8_t *data, size_t len, size_t *offset,
                                EastType **types, size_t type_count,
                                Beast2StringTableDec *st)
{
    /* IR is a recursive variant: varint(case_idx) + struct fields */
    uint64_t case_idx = read_varint(data, offset);

    /* All cases start with: type(EastTypeType), location([Location]) */
    EastType *type = b2ir_read_type(data, offset, types, type_count);

    /* Read location array into temp storage — applied to node after creation */
    size_t num_locs = 0;
    EastLocation *locs = NULL;
    {
        uint64_t dist = read_varint(data, offset);
        if (dist == 0) {
            uint64_t lc = read_varint(data, offset);
            if (lc > 0) {
                num_locs = (size_t)lc;
                locs = calloc(num_locs, sizeof(EastLocation));
                for (uint64_t i = 0; i < lc; i++) {
                    locs[i].filename = b2ir_read_string(data, len, offset, st);
                    locs[i].line = read_zigzag(data, offset);
                    locs[i].column = read_zigzag(data, offset);
                }
            }
        }
    }

    IRNode *result = NULL;

    switch (case_idx) {

    case 0: { /* As: value:IR */
        result = b2ir_decode_node(data, len, offset, types, type_count, st);
        if (result && type) {
            if (result->type) east_type_release(result->type);
            result->type = type;
            east_type_retain(type);
        }
        break;
    }

    case 1: { /* Assign: variable:IR, value:IR */
        IRNode *var_node = b2ir_decode_node(data, len, offset, types, type_count, st);
        IRNode *val = b2ir_decode_node(data, len, offset, types, type_count, st);
        char *name = var_node && var_node->kind == IR_VARIABLE
            ? var_node->data.variable.name : "";
        result = ir_assign(type, name, val);
        if (var_node) ir_node_release(var_node);
        if (val) ir_node_release(val);
        break;
    }

    case 2:    /* AsyncFunction: captures:[IR], parameters:[IR], body:IR */
    case 13: { /* Function: same layout */
        size_t nc, np;
        IRNode **cap_nodes = b2ir_read_ir_array(data, len, offset, types, type_count, st, &nc);
        IRNode **par_nodes = b2ir_read_ir_array(data, len, offset, types, type_count, st, &np);
        IRNode *body = b2ir_decode_node(data, len, offset, types, type_count, st);

        IRVariable *captures = nc > 0 ? calloc(nc, sizeof(IRVariable)) : NULL;
        EastType **cap_types = nc > 0 ? calloc(nc, sizeof(EastType *)) : NULL;
        IRVariable *params   = np > 0 ? calloc(np, sizeof(IRVariable)) : NULL;
        for (size_t i = 0; i < nc; i++) {
            if (cap_nodes[i] && cap_nodes[i]->kind == IR_VARIABLE) {
                captures[i].name = strdup(cap_nodes[i]->data.variable.name);
                captures[i].mutable = cap_nodes[i]->data.variable.mutable;
                captures[i].captured = cap_nodes[i]->data.variable.captured;
                if (cap_nodes[i]->type) {
                    cap_types[i] = cap_nodes[i]->type;
                    east_type_retain(cap_types[i]);
                }
            }
        }
        for (size_t i = 0; i < np; i++) {
            if (par_nodes[i] && par_nodes[i]->kind == IR_VARIABLE) {
                params[i].name = strdup(par_nodes[i]->data.variable.name);
                params[i].mutable = par_nodes[i]->data.variable.mutable;
                params[i].captured = par_nodes[i]->data.variable.captured;
            }
        }

        result = (case_idx == 2)
            ? ir_async_function(type, captures, nc, params, np, body)
            : ir_function(type, captures, nc, params, np, body);

        /* Store capture types on the IRNode for beast2 closure decode */
        if (result) result->data.function.capture_types = cap_types;
        else { for (size_t i = 0; i < nc; i++) if (cap_types[i]) east_type_release(cap_types[i]); free(cap_types); }

        for (size_t i = 0; i < nc; i++) free(captures[i].name);
        free(captures);
        for (size_t i = 0; i < np; i++) free(params[i].name);
        free(params);
        b2ir_free_nodes(cap_nodes, nc);
        b2ir_free_nodes(par_nodes, np);
        if (body) ir_node_release(body);
        break;
    }

    case 3: { /* Block: statements:[IR] */
        size_t n;
        IRNode **stmts = b2ir_read_ir_array(data, len, offset, types, type_count, st, &n);
        result = ir_block(type, stmts, n);
        b2ir_free_nodes(stmts, n);
        break;
    }

    case 4: { /* Break: label:Label */
        char *label = b2ir_read_label(data, len, offset, st);
        result = ir_break(label);
        if (type) { result->type = type; east_type_retain(type); }
        free(label);
        break;
    }

    case 5: { /* Builtin: builtin:String, type_parameters:[Type], arguments:[IR] */
        char *name = b2ir_read_string(data, len, offset, st);
        size_t ntp;
        EastType **tps = b2ir_read_type_array(data, len, offset, types, type_count, &ntp);
        size_t nargs;
        IRNode **args = b2ir_read_ir_array(data, len, offset, types, type_count, st, &nargs);
        result = ir_builtin(type, name, tps, ntp, args, nargs);
        free(name);
        for (size_t i = 0; i < ntp; i++) { if (tps[i]) east_type_release(tps[i]); }
        free(tps);
        b2ir_free_nodes(args, nargs);
        break;
    }

    case 6: { /* Call: function:IR, arguments:[IR] */
        IRNode *func = b2ir_decode_node(data, len, offset, types, type_count, st);
        size_t nargs;
        IRNode **args = b2ir_read_ir_array(data, len, offset, types, type_count, st, &nargs);
        result = ir_call(type, func, args, nargs);
        if (func) ir_node_release(func);
        b2ir_free_nodes(args, nargs);
        break;
    }

    case 7: { /* CallAsync: function:IR, arguments:[IR] */
        IRNode *func = b2ir_decode_node(data, len, offset, types, type_count, st);
        size_t nargs;
        IRNode **args = b2ir_read_ir_array(data, len, offset, types, type_count, st, &nargs);
        result = ir_call_async(type, func, args, nargs);
        if (func) ir_node_release(func);
        b2ir_free_nodes(args, nargs);
        break;
    }

    case 8: { /* Continue: label:Label */
        char *label = b2ir_read_label(data, len, offset, st);
        result = ir_continue(label);
        if (type) { result->type = type; east_type_retain(type); }
        free(label);
        break;
    }

    case 9: { /* Error: message:IR */
        IRNode *msg = b2ir_decode_node(data, len, offset, types, type_count, st);
        result = ir_error(type, msg);
        if (msg) ir_node_release(msg);
        break;
    }

    case 10: { /* ForArray: array:IR, label:Label, key:IR, value:IR, body:IR */
        IRNode *arr = b2ir_decode_node(data, len, offset, types, type_count, st);
        char *label = b2ir_read_label(data, len, offset, st);
        IRNode *key_node = b2ir_decode_node(data, len, offset, types, type_count, st);
        IRNode *val_node = b2ir_decode_node(data, len, offset, types, type_count, st);
        IRNode *body = b2ir_decode_node(data, len, offset, types, type_count, st);
        char *val_name = val_node && val_node->kind == IR_VARIABLE
            ? val_node->data.variable.name : "";
        char *idx_name = key_node && key_node->kind == IR_VARIABLE
            ? key_node->data.variable.name : NULL;
        result = ir_for_array(type, val_name, idx_name, arr, body, label);
        free(label);
        if (arr) ir_node_release(arr);
        if (key_node) ir_node_release(key_node);
        if (val_node) ir_node_release(val_node);
        if (body) ir_node_release(body);
        break;
    }

    case 11: { /* ForDict: dict:IR, label:Label, key:IR, value:IR, body:IR */
        IRNode *dict = b2ir_decode_node(data, len, offset, types, type_count, st);
        char *label = b2ir_read_label(data, len, offset, st);
        IRNode *key_node = b2ir_decode_node(data, len, offset, types, type_count, st);
        IRNode *val_node = b2ir_decode_node(data, len, offset, types, type_count, st);
        IRNode *body = b2ir_decode_node(data, len, offset, types, type_count, st);
        char *key_name = key_node && key_node->kind == IR_VARIABLE
            ? key_node->data.variable.name : "";
        char *val_name = val_node && val_node->kind == IR_VARIABLE
            ? val_node->data.variable.name : "";
        result = ir_for_dict(type, key_name, val_name, dict, body, label);
        free(label);
        if (dict) ir_node_release(dict);
        if (key_node) ir_node_release(key_node);
        if (val_node) ir_node_release(val_node);
        if (body) ir_node_release(body);
        break;
    }

    case 12: { /* ForSet: set:IR, label:Label, key:IR, body:IR */
        IRNode *set = b2ir_decode_node(data, len, offset, types, type_count, st);
        char *label = b2ir_read_label(data, len, offset, st);
        IRNode *key_node = b2ir_decode_node(data, len, offset, types, type_count, st);
        IRNode *body = b2ir_decode_node(data, len, offset, types, type_count, st);
        char *var_name = key_node && key_node->kind == IR_VARIABLE
            ? key_node->data.variable.name : "";
        result = ir_for_set(type, var_name, set, body, label);
        free(label);
        if (set) ir_node_release(set);
        if (key_node) ir_node_release(key_node);
        if (body) ir_node_release(body);
        break;
    }

    /* case 13 (Function) handled above with case 2 (AsyncFunction) */

    case 14: { /* GetField: field:String, struct:IR */
        char *field = b2ir_read_string(data, len, offset, st);
        IRNode *expr = b2ir_decode_node(data, len, offset, types, type_count, st);
        result = ir_get_field(type, expr, field);
        free(field);
        if (expr) ir_node_release(expr);
        break;
    }

    case 15: { /* IfElse: ifs:[{predicate:IR, body:IR}], else_body:IR */
        uint64_t dist = read_varint(data, offset);
        if (dist == 0) {
            uint64_t count = read_varint(data, offset);
            IRNode **preds = calloc((size_t)count, sizeof(IRNode *));
            IRNode **bodies = calloc((size_t)count, sizeof(IRNode *));
            for (uint64_t i = 0; i < count; i++) {
                preds[i] = b2ir_decode_node(data, len, offset, types, type_count, st);
                bodies[i] = b2ir_decode_node(data, len, offset, types, type_count, st);
            }
            IRNode *else_b = b2ir_decode_node(data, len, offset, types, type_count, st);

            /* Build from last to first (nested if-else chain) */
            IRNode *chain = else_b;
            for (int64_t i = (int64_t)count - 1; i >= 0; i--) {
                IRNode *node = ir_if_else(type, preds[i], bodies[i], chain);
                if (preds[i]) ir_node_release(preds[i]);
                if (bodies[i]) ir_node_release(bodies[i]);
                if (chain && chain != else_b) ir_node_release(chain);
                chain = node;
            }
            if (else_b) ir_node_release(else_b);
            free(preds);
            free(bodies);
            result = chain;
        }
        break;
    }

    case 16: { /* Let: variable:IR, value:IR */
        IRNode *var_node = b2ir_decode_node(data, len, offset, types, type_count, st);
        IRNode *val = b2ir_decode_node(data, len, offset, types, type_count, st);
        char *vname = var_node && var_node->kind == IR_VARIABLE
            ? var_node->data.variable.name : "";
        bool vmut = var_node && var_node->kind == IR_VARIABLE
            ? var_node->data.variable.mutable : false;
        bool vcap = var_node && var_node->kind == IR_VARIABLE
            ? var_node->data.variable.captured : false;
        result = ir_let(type, vname, vmut, vcap, val);
        if (var_node) ir_node_release(var_node);
        if (val) ir_node_release(val);
        break;
    }

    case 17: { /* Match: variant:IR, cases:[{case:String, variable:IR, body:IR}] */
        IRNode *expr = b2ir_decode_node(data, len, offset, types, type_count, st);
        uint64_t dist = read_varint(data, offset);
        size_t nc = 0;
        IRMatchCase *cases = NULL;
        if (dist == 0) {
            uint64_t count = read_varint(data, offset);
            nc = (size_t)count;
            cases = calloc(nc, sizeof(IRMatchCase));
            for (size_t i = 0; i < nc; i++) {
                cases[i].case_name = b2ir_read_string(data, len, offset, st);
                IRNode *var_node = b2ir_decode_node(data, len, offset, types, type_count, st);
                cases[i].bind_name = (var_node && var_node->kind == IR_VARIABLE)
                    ? strdup(var_node->data.variable.name) : strdup("");
                if (var_node) ir_node_release(var_node);
                IRNode *body = b2ir_decode_node(data, len, offset, types, type_count, st);
                cases[i].body = body;
                if (body) ir_node_retain(body);
                if (body) ir_node_release(body);
            }
        }
        result = ir_match(type, expr, cases, nc);
        if (expr) ir_node_release(expr);
        for (size_t i = 0; i < nc; i++) {
            free(cases[i].case_name);
            free(cases[i].bind_name);
            if (cases[i].body) ir_node_release(cases[i].body);
        }
        free(cases);
        break;
    }

    case 18: { /* NewArray: values:[IR] */
        size_t n;
        IRNode **items = b2ir_read_ir_array(data, len, offset, types, type_count, st, &n);
        result = ir_new_array(type, items, n);
        b2ir_free_nodes(items, n);
        break;
    }

    case 19: { /* NewDict: values:[{key:IR, value:IR}] */
        uint64_t dist = read_varint(data, offset);
        size_t n = 0;
        IRNode **keys = NULL, **vals = NULL;
        if (dist == 0) {
            uint64_t count = read_varint(data, offset);
            n = (size_t)count;
            if (n > 0) {
                keys = calloc(n, sizeof(IRNode *));
                vals = calloc(n, sizeof(IRNode *));
                for (size_t i = 0; i < n; i++) {
                    keys[i] = b2ir_decode_node(data, len, offset, types, type_count, st);
                    vals[i] = b2ir_decode_node(data, len, offset, types, type_count, st);
                }
            }
        }
        result = ir_new_dict(type, keys, vals, n);
        b2ir_free_nodes(keys, n);
        b2ir_free_nodes(vals, n);
        break;
    }

    case 20: { /* NewMatrix: values:[IR], rows:Integer, cols:Integer */
        size_t n;
        IRNode **items = b2ir_read_ir_array(data, len, offset, types, type_count, st, &n);
        int64_t rows = read_zigzag(data, offset);
        int64_t cols = read_zigzag(data, offset);
        result = ir_new_matrix(type, items, n, (size_t)rows, (size_t)cols);
        b2ir_free_nodes(items, n);
        break;
    }

    case 21: { /* NewRef: value:IR */
        IRNode *val = b2ir_decode_node(data, len, offset, types, type_count, st);
        result = ir_new_ref(type, val);
        if (val) ir_node_release(val);
        break;
    }

    case 22: { /* NewSet: values:[IR] */
        size_t n;
        IRNode **items = b2ir_read_ir_array(data, len, offset, types, type_count, st, &n);
        result = ir_new_set(type, items, n);
        b2ir_free_nodes(items, n);
        break;
    }

    case 23: { /* NewVector: values:[IR] */
        size_t n;
        IRNode **items = b2ir_read_ir_array(data, len, offset, types, type_count, st, &n);
        result = ir_new_vector(type, items, n);
        b2ir_free_nodes(items, n);
        break;
    }

    case 24: { /* Platform: name:String, type_parameters:[Type], arguments:[IR], async:Bool, optional:Bool */
        char *name = b2ir_read_string(data, len, offset, st);
        size_t ntp;
        EastType **tps = b2ir_read_type_array(data, len, offset, types, type_count, &ntp);
        size_t nargs;
        IRNode **args = b2ir_read_ir_array(data, len, offset, types, type_count, st, &nargs);
        bool is_async = (data[(*offset)++] != 0);
        bool optional = (data[(*offset)++] != 0);
        result = ir_platform(type, name, tps, ntp, args, nargs, is_async, optional);
        free(name);
        for (size_t i = 0; i < ntp; i++) { if (tps[i]) east_type_release(tps[i]); }
        free(tps);
        b2ir_free_nodes(args, nargs);
        break;
    }

    case 25: { /* Return: value:IR */
        IRNode *val = b2ir_decode_node(data, len, offset, types, type_count, st);
        result = ir_return(type, val);
        if (val) ir_node_release(val);
        break;
    }

    case 26: { /* Struct: fields:[{name:String, value:IR}] */
        uint64_t dist = read_varint(data, offset);
        size_t nf = 0;
        char **names = NULL;
        IRNode **values = NULL;
        if (dist == 0) {
            uint64_t count = read_varint(data, offset);
            nf = (size_t)count;
            if (nf > 0) {
                names = calloc(nf, sizeof(char *));
                values = calloc(nf, sizeof(IRNode *));
                for (size_t i = 0; i < nf; i++) {
                    names[i] = b2ir_read_string(data, len, offset, st);
                    values[i] = b2ir_decode_node(data, len, offset, types, type_count, st);
                }
            }
        }
        result = ir_struct(type, names, values, nf);
        for (size_t i = 0; i < nf; i++) free(names[i]);
        free(names);
        b2ir_free_nodes(values, nf);
        break;
    }

    case 27: { /* TryCatch: try_body:IR, catch_body:IR, message:IR, stack:IR, finally_body:IR */
        IRNode *try_b = b2ir_decode_node(data, len, offset, types, type_count, st);
        IRNode *catch_b = b2ir_decode_node(data, len, offset, types, type_count, st);
        IRNode *msg_node = b2ir_decode_node(data, len, offset, types, type_count, st);
        IRNode *stk_node = b2ir_decode_node(data, len, offset, types, type_count, st);
        char *msg_var = msg_node && msg_node->kind == IR_VARIABLE
            ? strdup(msg_node->data.variable.name) : strdup("");
        char *stk_var = stk_node && stk_node->kind == IR_VARIABLE
            ? strdup(stk_node->data.variable.name) : strdup("");
        IRNode *finally_b = b2ir_decode_node(data, len, offset, types, type_count, st);
        result = ir_try_catch(type, try_b, msg_var, stk_var, catch_b, finally_b);
        free(msg_var); free(stk_var);
        if (try_b) ir_node_release(try_b);
        if (catch_b) ir_node_release(catch_b);
        if (msg_node) ir_node_release(msg_node);
        if (stk_node) ir_node_release(stk_node);
        if (finally_b) ir_node_release(finally_b);
        break;
    }

    case 28: { /* UnwrapRecursive: value:IR */
        IRNode *val = b2ir_decode_node(data, len, offset, types, type_count, st);
        result = ir_unwrap_recursive(type, val);
        if (val) ir_node_release(val);
        break;
    }

    case 29: { /* Value: value:LiteralValue */
        EastValue *val = b2ir_read_literal(data, len, offset, st);
        result = ir_value(type, val);
        east_value_release(val);
        break;
    }

    case 30: { /* Variable: name:String, mutable:Bool, captured:Bool */
        char *name = b2ir_read_string(data, len, offset, st);
        bool mut = (data[(*offset)++] != 0);
        bool cap = (data[(*offset)++] != 0);
        result = ir_variable(type, name, mut, cap);
        free(name);
        break;
    }

    case 31: { /* Variant: case:String, value:IR */
        char *case_name = b2ir_read_string(data, len, offset, st);
        IRNode *val = b2ir_decode_node(data, len, offset, types, type_count, st);
        result = ir_variant(type, case_name, val);
        free(case_name);
        if (val) ir_node_release(val);
        break;
    }

    case 32: { /* While: predicate:IR, label:Label, body:IR */
        IRNode *pred = b2ir_decode_node(data, len, offset, types, type_count, st);
        char *label = b2ir_read_label(data, len, offset, st);
        IRNode *body = b2ir_decode_node(data, len, offset, types, type_count, st);
        result = ir_while(type, pred, body, label);
        free(label);
        if (pred) ir_node_release(pred);
        if (body) ir_node_release(body);
        break;
    }

    case 33: { /* WrapRecursive: value:IR */
        IRNode *val = b2ir_decode_node(data, len, offset, types, type_count, st);
        result = ir_wrap_recursive(type, val);
        if (val) ir_node_release(val);
        break;
    }

    default:
        fprintf(stderr, "beast2_decode_ir_node: unknown IR case %llu\n",
                (unsigned long long)case_idx);
        break;
    }

    /* Apply locations */
    if (result && locs) {
        result->locations = locs;
        result->num_locations = num_locs;
    } else {
        /* Free locations if node creation failed */
        for (size_t i = 0; i < num_locs; i++) free(locs[i].filename);
        free(locs);
    }

    if (type) east_type_release(type);
    return result;
}

/* ================================================================== */
