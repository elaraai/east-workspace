#include "internal.h"

/*  BEAST2 IR Encoder: IRNode* → beast2 bytes                         */
/*                                                                     */
/*  Inverse of b2ir_decode_node. Each IR case writes:                  */
/*    varint(case_idx) + type + location + case-specific fields        */
/* ================================================================== */

/* Forward declaration */
void b2ir_encode_node(ByteBuffer *buf, IRNode *node, Beast2EncodeCtx *ctx);

/* Write a type reference as varint index into flat_type_table */
static void b2ir_write_type(ByteBuffer *buf, EastType *type, Beast2EncodeCtx *ctx) {
    if (!type || !ctx->flat_type_table) {
        write_varint(buf, 0);
        return;
    }
    int existing = flat_tt_et_find(ctx->flat_type_table, type);
    size_t idx;
    if (existing >= 0) {
        idx = (size_t)existing;
    } else {
        idx = flat_tt_add_et(ctx->flat_type_table, type);
    }
    write_varint(buf, (uint64_t)idx);
}

/* Write a string via string table */
static void b2ir_write_string(ByteBuffer *buf, const char *str, Beast2EncodeCtx *ctx) {
    if (!str) str = "";
    size_t slen = strlen(str);
    if (ctx->string_table) {
        size_t idx = string_table_enc_add(ctx->string_table, str, slen);
        write_varint(buf, (uint64_t)idx);
    } else {
        write_varint(buf, (uint64_t)slen);
        byte_buffer_write_bytes(buf, (const uint8_t *)str, slen);
    }
}

/* Write an array of IR nodes: varint(0) + varint(count) + each node */
static void b2ir_write_ir_array(ByteBuffer *buf, IRNode **nodes, size_t count,
                                Beast2EncodeCtx *ctx) {
    write_varint(buf, 0);  /* inline (distance=0, not a backreference) */
    write_varint(buf, (uint64_t)count);
    for (size_t i = 0; i < count; i++) {
        b2ir_encode_node(buf, nodes[i], ctx);
    }
}

/* Write a type array: varint(0) + varint(count) + each type index */
static void b2ir_write_type_array(ByteBuffer *buf, EastType **types, size_t count,
                                  Beast2EncodeCtx *ctx) {
    write_varint(buf, 0);  /* inline */
    write_varint(buf, (uint64_t)count);
    for (size_t i = 0; i < count; i++) {
        b2ir_write_type(buf, types[i], ctx);
    }
}

/* Write a label: { name: String, location: [Location] }
 * Location is always empty in the encoder. */
static void b2ir_write_label(ByteBuffer *buf, const char *label, Beast2EncodeCtx *ctx) {
    b2ir_write_string(buf, label ? label : "", ctx);
    /* Empty location array */
    write_varint(buf, 0);  /* distance=0 (inline) */
    write_varint(buf, 0);  /* count=0 */
}

/* Write locations: varint(0) + varint(count) + each {filename, line, column} */
static void b2ir_write_locations(ByteBuffer *buf, IRNode *node, Beast2EncodeCtx *ctx) {
    write_varint(buf, 0);  /* distance=0 (inline) */
    write_varint(buf, (uint64_t)node->num_locations);
    for (size_t i = 0; i < node->num_locations; i++) {
        b2ir_write_string(buf, node->locations[i].filename, ctx);
        write_zigzag(buf, node->locations[i].line);
        write_zigzag(buf, node->locations[i].column);
    }
}

/* Write a LiteralValue (inverse of b2ir_read_literal).
 * Sorted cases: 0:Blob, 1:Boolean, 2:DateTime, 3:Float, 4:Integer, 5:Null, 6:String */
static void b2ir_write_literal(ByteBuffer *buf, EastValue *val, Beast2EncodeCtx *ctx) {
    if (!val) {
        write_varint(buf, 5); /* Null */
        return;
    }
    switch (val->kind) {
    case EAST_VAL_BLOB:
        write_varint(buf, 0);
        write_varint(buf, (uint64_t)val->data.blob.len);
        byte_buffer_write_bytes(buf, val->data.blob.data, val->data.blob.len);
        break;
    case EAST_VAL_BOOLEAN:
        write_varint(buf, 1);
        byte_buffer_write_u8(buf, val->data.boolean ? 1 : 0);
        break;
    case EAST_VAL_DATETIME:
        write_varint(buf, 2);
        write_zigzag(buf, val->data.datetime);
        break;
    case EAST_VAL_FLOAT:
        write_varint(buf, 3);
        b2_write_float64_le(buf, val->data.float64);
        break;
    case EAST_VAL_INTEGER:
        write_varint(buf, 4);
        write_zigzag(buf, val->data.integer);
        break;
    case EAST_VAL_NULL:
        write_varint(buf, 5);
        break;
    case EAST_VAL_STRING:
        write_varint(buf, 6);
        if (ctx->string_table) {
            size_t idx = string_table_enc_add(ctx->string_table,
                val->data.string.data, val->data.string.len);
            write_varint(buf, (uint64_t)idx);
        } else {
            write_varint(buf, (uint64_t)val->data.string.len);
            byte_buffer_write_bytes(buf, (const uint8_t *)val->data.string.data,
                                    val->data.string.len);
        }
        break;
    default:
        /* Non-literal value types shouldn't appear here; encode as null */
        write_varint(buf, 5);
        break;
    }
}

/* Encode a Variable IR node as its own IR node (case 30).
 * Used when Assign/Let/Match/ForArray/ForDict/ForSet/TryCatch embed variables. */
static void b2ir_encode_variable_node(ByteBuffer *buf, const char *name, bool mutable,
                                      bool captured, EastType *type, Beast2EncodeCtx *ctx) {
    write_varint(buf, 30);  /* Variable case index */
    b2ir_write_type(buf, type, ctx);
    /* Empty location array */
    write_varint(buf, 0);
    write_varint(buf, 0);
    /* Variable fields: name, mutable, captured */
    b2ir_write_string(buf, name, ctx);
    byte_buffer_write_u8(buf, mutable ? 1 : 0);
    byte_buffer_write_u8(buf, captured ? 1 : 0);
}

/* ---- Main direct encoder ---- */

void b2ir_encode_node(ByteBuffer *buf, IRNode *node, Beast2EncodeCtx *ctx)
{
    if (!node) {
        /* Encode a null/missing node as a Value(Null) with null type */
        write_varint(buf, 29); /* Value */
        b2ir_write_type(buf, NULL, ctx);
        write_varint(buf, 0); write_varint(buf, 0); /* empty locations */
        write_varint(buf, 5); /* Null literal */
        return;
    }

    switch (node->kind) {

    /* Note: There is no IR_AS kind in the C IR. The decoder's case 0 (As)
     * just re-types the inner node. If we ever need to emit As, the caller
     * would need to track the original vs current type. For now, all nodes
     * encode using their native kind. */

    case IR_ASSIGN: { /* case 1: variable:IR, value:IR */
        write_varint(buf, 1);
        b2ir_write_type(buf, node->type, ctx);
        b2ir_write_locations(buf, node, ctx);
        /* Write variable sub-node (Variable IR node for the target) */
        b2ir_encode_variable_node(buf, node->data.assign.name, false, false,
                                  node->type, ctx);
        b2ir_encode_node(buf, node->data.assign.value, ctx);
        break;
    }

    case IR_ASYNC_FUNCTION: /* case 2: captures:[IR], parameters:[IR], body:IR */
    case IR_FUNCTION: {     /* case 13: same layout */
        write_varint(buf, node->kind == IR_ASYNC_FUNCTION ? 2 : 13);
        b2ir_write_type(buf, node->type, ctx);
        b2ir_write_locations(buf, node, ctx);

        /* Captures as array of Variable IR nodes */
        size_t nc = node->data.function.num_captures;
        write_varint(buf, 0);  /* inline */
        write_varint(buf, (uint64_t)nc);
        for (size_t i = 0; i < nc; i++) {
            EastType *cap_type = (node->data.function.capture_types &&
                                  node->data.function.capture_types[i])
                ? node->data.function.capture_types[i] : NULL;
            b2ir_encode_variable_node(buf,
                node->data.function.captures[i].name,
                node->data.function.captures[i].mutable,
                node->data.function.captures[i].captured,
                cap_type, ctx);
        }

        /* Parameters as array of Variable IR nodes */
        size_t np = node->data.function.num_params;
        write_varint(buf, 0);  /* inline */
        write_varint(buf, (uint64_t)np);
        for (size_t i = 0; i < np; i++) {
            b2ir_encode_variable_node(buf,
                node->data.function.params[i].name,
                node->data.function.params[i].mutable,
                node->data.function.params[i].captured,
                NULL, ctx);
        }

        /* Body */
        b2ir_encode_node(buf, node->data.function.body, ctx);
        break;
    }

    case IR_BLOCK: { /* case 3: statements:[IR] */
        write_varint(buf, 3);
        b2ir_write_type(buf, node->type, ctx);
        b2ir_write_locations(buf, node, ctx);
        b2ir_write_ir_array(buf, node->data.block.stmts,
                            node->data.block.num_stmts, ctx);
        break;
    }

    case IR_BREAK: { /* case 4: label:Label */
        write_varint(buf, 4);
        b2ir_write_type(buf, node->type, ctx);
        b2ir_write_locations(buf, node, ctx);
        b2ir_write_label(buf, node->data.loop_ctrl.label, ctx);
        break;
    }

    case IR_BUILTIN: { /* case 5: builtin:String, type_parameters:[Type], arguments:[IR] */
        write_varint(buf, 5);
        b2ir_write_type(buf, node->type, ctx);
        b2ir_write_locations(buf, node, ctx);
        b2ir_write_string(buf, node->data.builtin.name, ctx);
        b2ir_write_type_array(buf, node->data.builtin.type_params,
                              node->data.builtin.num_type_params, ctx);
        b2ir_write_ir_array(buf, node->data.builtin.args,
                            node->data.builtin.num_args, ctx);
        break;
    }

    case IR_CALL: { /* case 6: function:IR, arguments:[IR] */
        write_varint(buf, 6);
        b2ir_write_type(buf, node->type, ctx);
        b2ir_write_locations(buf, node, ctx);
        b2ir_encode_node(buf, node->data.call.func, ctx);
        b2ir_write_ir_array(buf, node->data.call.args,
                            node->data.call.num_args, ctx);
        break;
    }

    case IR_CALL_ASYNC: { /* case 7: function:IR, arguments:[IR] */
        write_varint(buf, 7);
        b2ir_write_type(buf, node->type, ctx);
        b2ir_write_locations(buf, node, ctx);
        b2ir_encode_node(buf, node->data.call.func, ctx);
        b2ir_write_ir_array(buf, node->data.call.args,
                            node->data.call.num_args, ctx);
        break;
    }

    case IR_CONTINUE: { /* case 8: label:Label */
        write_varint(buf, 8);
        b2ir_write_type(buf, node->type, ctx);
        b2ir_write_locations(buf, node, ctx);
        b2ir_write_label(buf, node->data.loop_ctrl.label, ctx);
        break;
    }

    case IR_ERROR: { /* case 9: message:IR */
        write_varint(buf, 9);
        b2ir_write_type(buf, node->type, ctx);
        b2ir_write_locations(buf, node, ctx);
        b2ir_encode_node(buf, node->data.error.message, ctx);
        break;
    }

    case IR_FOR_ARRAY: { /* case 10: array:IR, label:Label, key:IR, value:IR, body:IR */
        write_varint(buf, 10);
        b2ir_write_type(buf, node->type, ctx);
        b2ir_write_locations(buf, node, ctx);
        b2ir_encode_node(buf, node->data.for_array.array, ctx);
        b2ir_write_label(buf, node->data.for_array.label, ctx);
        /* key: index variable (or empty variable if no index_name) */
        b2ir_encode_variable_node(buf,
            node->data.for_array.index_name ? node->data.for_array.index_name : "",
            false, false, NULL, ctx);
        /* value: loop variable */
        b2ir_encode_variable_node(buf,
            node->data.for_array.var_name ? node->data.for_array.var_name : "",
            false, false, NULL, ctx);
        b2ir_encode_node(buf, node->data.for_array.body, ctx);
        break;
    }

    case IR_FOR_DICT: { /* case 11: dict:IR, label:Label, key:IR, value:IR, body:IR */
        write_varint(buf, 11);
        b2ir_write_type(buf, node->type, ctx);
        b2ir_write_locations(buf, node, ctx);
        b2ir_encode_node(buf, node->data.for_dict.dict, ctx);
        b2ir_write_label(buf, node->data.for_dict.label, ctx);
        /* key variable */
        b2ir_encode_variable_node(buf,
            node->data.for_dict.key_name ? node->data.for_dict.key_name : "",
            false, false, NULL, ctx);
        /* value variable */
        b2ir_encode_variable_node(buf,
            node->data.for_dict.val_name ? node->data.for_dict.val_name : "",
            false, false, NULL, ctx);
        b2ir_encode_node(buf, node->data.for_dict.body, ctx);
        break;
    }

    case IR_FOR_SET: { /* case 12: set:IR, label:Label, key:IR, body:IR */
        write_varint(buf, 12);
        b2ir_write_type(buf, node->type, ctx);
        b2ir_write_locations(buf, node, ctx);
        b2ir_encode_node(buf, node->data.for_set.set, ctx);
        b2ir_write_label(buf, node->data.for_set.label, ctx);
        /* key variable */
        b2ir_encode_variable_node(buf,
            node->data.for_set.var_name ? node->data.for_set.var_name : "",
            false, false, NULL, ctx);
        b2ir_encode_node(buf, node->data.for_set.body, ctx);
        break;
    }

    case IR_GET_FIELD: { /* case 14: field:String, struct:IR */
        write_varint(buf, 14);
        b2ir_write_type(buf, node->type, ctx);
        b2ir_write_locations(buf, node, ctx);
        b2ir_write_string(buf, node->data.get_field.field_name, ctx);
        b2ir_encode_node(buf, node->data.get_field.expr, ctx);
        break;
    }

    case IR_IF_ELSE: { /* case 15: ifs:[{predicate:IR, body:IR}], else_body:IR */
        write_varint(buf, 15);
        b2ir_write_type(buf, node->type, ctx);
        b2ir_write_locations(buf, node, ctx);

        /* Flatten the nested if-else chain into an array of {pred, body} pairs.
         * Walk down the else branch while it's an IR_IF_ELSE with the same type. */
        size_t cap = 4;
        size_t count = 0;
        IRNode **preds = malloc(cap * sizeof(IRNode *));
        IRNode **bodies = malloc(cap * sizeof(IRNode *));
        IRNode *cur = node;
        while (cur && cur->kind == IR_IF_ELSE) {
            if (count >= cap) {
                cap *= 2;
                preds = realloc(preds, cap * sizeof(IRNode *));
                bodies = realloc(bodies, cap * sizeof(IRNode *));
            }
            preds[count] = cur->data.if_else.cond;
            bodies[count] = cur->data.if_else.then_branch;
            count++;
            cur = cur->data.if_else.else_branch;
        }
        /* cur is now the final else body */

        /* Write as array: distance=0, count, then each {pred, body} */
        write_varint(buf, 0);  /* inline */
        write_varint(buf, (uint64_t)count);
        for (size_t i = 0; i < count; i++) {
            b2ir_encode_node(buf, preds[i], ctx);
            b2ir_encode_node(buf, bodies[i], ctx);
        }
        /* else body */
        b2ir_encode_node(buf, cur, ctx);

        free(preds);
        free(bodies);
        break;
    }

    case IR_LET: { /* case 16: variable:IR, value:IR */
        write_varint(buf, 16);
        b2ir_write_type(buf, node->type, ctx);
        b2ir_write_locations(buf, node, ctx);
        /* Write variable sub-node */
        b2ir_encode_variable_node(buf,
            node->data.let.var.name,
            node->data.let.var.mutable,
            node->data.let.var.captured,
            node->type, ctx);
        b2ir_encode_node(buf, node->data.let.value, ctx);
        break;
    }

    case IR_MATCH: { /* case 17: variant:IR, cases:[{case:String, variable:IR, body:IR}] */
        write_varint(buf, 17);
        b2ir_write_type(buf, node->type, ctx);
        b2ir_write_locations(buf, node, ctx);
        b2ir_encode_node(buf, node->data.match.expr, ctx);
        /* Cases array */
        write_varint(buf, 0);  /* inline */
        write_varint(buf, (uint64_t)node->data.match.num_cases);
        for (size_t i = 0; i < node->data.match.num_cases; i++) {
            b2ir_write_string(buf, node->data.match.cases[i].case_name, ctx);
            /* Variable sub-node for the bind name */
            b2ir_encode_variable_node(buf,
                node->data.match.cases[i].bind_name ?
                    node->data.match.cases[i].bind_name : "",
                false, false, NULL, ctx);
            b2ir_encode_node(buf, node->data.match.cases[i].body, ctx);
        }
        break;
    }

    case IR_NEW_ARRAY: { /* case 18: values:[IR] */
        write_varint(buf, 18);
        b2ir_write_type(buf, node->type, ctx);
        b2ir_write_locations(buf, node, ctx);
        b2ir_write_ir_array(buf, node->data.new_collection.items,
                            node->data.new_collection.num_items, ctx);
        break;
    }

    case IR_NEW_DICT: { /* case 19: values:[{key:IR, value:IR}] */
        write_varint(buf, 19);
        b2ir_write_type(buf, node->type, ctx);
        b2ir_write_locations(buf, node, ctx);
        /* Key-value pairs array */
        write_varint(buf, 0);  /* inline */
        write_varint(buf, (uint64_t)node->data.new_dict.num_pairs);
        for (size_t i = 0; i < node->data.new_dict.num_pairs; i++) {
            b2ir_encode_node(buf, node->data.new_dict.keys[i], ctx);
            b2ir_encode_node(buf, node->data.new_dict.values[i], ctx);
        }
        break;
    }

    case IR_NEW_MATRIX: { /* case 20: values:[IR], rows:Integer, cols:Integer */
        write_varint(buf, 20);
        b2ir_write_type(buf, node->type, ctx);
        b2ir_write_locations(buf, node, ctx);
        b2ir_write_ir_array(buf, node->data.new_matrix.items,
                            node->data.new_matrix.num_items, ctx);
        write_zigzag(buf, (int64_t)node->data.new_matrix.rows);
        write_zigzag(buf, (int64_t)node->data.new_matrix.cols);
        break;
    }

    case IR_NEW_REF: { /* case 21: value:IR */
        write_varint(buf, 21);
        b2ir_write_type(buf, node->type, ctx);
        b2ir_write_locations(buf, node, ctx);
        b2ir_encode_node(buf, node->data.new_ref.value, ctx);
        break;
    }

    case IR_NEW_SET: { /* case 22: values:[IR] */
        write_varint(buf, 22);
        b2ir_write_type(buf, node->type, ctx);
        b2ir_write_locations(buf, node, ctx);
        b2ir_write_ir_array(buf, node->data.new_collection.items,
                            node->data.new_collection.num_items, ctx);
        break;
    }

    case IR_NEW_VECTOR: { /* case 23: values:[IR] */
        write_varint(buf, 23);
        b2ir_write_type(buf, node->type, ctx);
        b2ir_write_locations(buf, node, ctx);
        b2ir_write_ir_array(buf, node->data.new_vector.items,
                            node->data.new_vector.num_items, ctx);
        break;
    }

    case IR_PLATFORM: { /* case 24: name:String, type_parameters:[Type], arguments:[IR],
                                    async:Bool, optional:Bool */
        write_varint(buf, 24);
        b2ir_write_type(buf, node->type, ctx);
        b2ir_write_locations(buf, node, ctx);
        b2ir_write_string(buf, node->data.platform.name, ctx);
        b2ir_write_type_array(buf, node->data.platform.type_params,
                              node->data.platform.num_type_params, ctx);
        b2ir_write_ir_array(buf, node->data.platform.args,
                            node->data.platform.num_args, ctx);
        byte_buffer_write_u8(buf, node->data.platform.is_async ? 1 : 0);
        byte_buffer_write_u8(buf, node->data.platform.optional ? 1 : 0);
        break;
    }

    case IR_RETURN: { /* case 25: value:IR */
        write_varint(buf, 25);
        b2ir_write_type(buf, node->type, ctx);
        b2ir_write_locations(buf, node, ctx);
        b2ir_encode_node(buf, node->data.return_.value, ctx);
        break;
    }

    case IR_STRUCT: { /* case 26: fields:[{name:String, value:IR}] */
        write_varint(buf, 26);
        b2ir_write_type(buf, node->type, ctx);
        b2ir_write_locations(buf, node, ctx);
        /* Fields array */
        write_varint(buf, 0);  /* inline */
        write_varint(buf, (uint64_t)node->data.struct_.num_fields);
        for (size_t i = 0; i < node->data.struct_.num_fields; i++) {
            b2ir_write_string(buf, node->data.struct_.field_names[i], ctx);
            b2ir_encode_node(buf, node->data.struct_.field_values[i], ctx);
        }
        break;
    }

    case IR_TRY_CATCH: { /* case 27: try_body:IR, catch_body:IR, message:IR, stack:IR,
                                     finally_body:IR */
        write_varint(buf, 27);
        b2ir_write_type(buf, node->type, ctx);
        b2ir_write_locations(buf, node, ctx);
        b2ir_encode_node(buf, node->data.try_catch.try_body, ctx);
        b2ir_encode_node(buf, node->data.try_catch.catch_body, ctx);
        /* message variable as IR node */
        b2ir_encode_variable_node(buf,
            node->data.try_catch.message_var ? node->data.try_catch.message_var : "",
            false, false, NULL, ctx);
        /* stack variable as IR node */
        b2ir_encode_variable_node(buf,
            node->data.try_catch.stack_var ? node->data.try_catch.stack_var : "",
            false, false, NULL, ctx);
        b2ir_encode_node(buf, node->data.try_catch.finally_body, ctx);
        break;
    }

    case IR_UNWRAP_RECURSIVE: { /* case 28: value:IR */
        write_varint(buf, 28);
        b2ir_write_type(buf, node->type, ctx);
        b2ir_write_locations(buf, node, ctx);
        b2ir_encode_node(buf, node->data.recursive.value, ctx);
        break;
    }

    case IR_VALUE: { /* case 29: value:LiteralValue */
        write_varint(buf, 29);
        b2ir_write_type(buf, node->type, ctx);
        b2ir_write_locations(buf, node, ctx);
        b2ir_write_literal(buf, node->data.value.value, ctx);
        break;
    }

    case IR_VARIABLE: { /* case 30: name:String, mutable:Bool, captured:Bool */
        write_varint(buf, 30);
        b2ir_write_type(buf, node->type, ctx);
        b2ir_write_locations(buf, node, ctx);
        b2ir_write_string(buf, node->data.variable.name, ctx);
        byte_buffer_write_u8(buf, node->data.variable.mutable ? 1 : 0);
        byte_buffer_write_u8(buf, node->data.variable.captured ? 1 : 0);
        break;
    }

    case IR_VARIANT: { /* case 31: case:String, value:IR */
        write_varint(buf, 31);
        b2ir_write_type(buf, node->type, ctx);
        b2ir_write_locations(buf, node, ctx);
        b2ir_write_string(buf, node->data.variant.case_name, ctx);
        b2ir_encode_node(buf, node->data.variant.value, ctx);
        break;
    }

    case IR_WHILE: { /* case 32: predicate:IR, label:Label, body:IR */
        write_varint(buf, 32);
        b2ir_write_type(buf, node->type, ctx);
        b2ir_write_locations(buf, node, ctx);
        b2ir_encode_node(buf, node->data.while_.cond, ctx);
        b2ir_write_label(buf, node->data.while_.label, ctx);
        b2ir_encode_node(buf, node->data.while_.body, ctx);
        break;
    }

    case IR_WRAP_RECURSIVE: { /* case 33: value:IR */
        write_varint(buf, 33);
        b2ir_write_type(buf, node->type, ctx);
        b2ir_write_locations(buf, node, ctx);
        b2ir_encode_node(buf, node->data.recursive.value, ctx);
        break;
    }

    default:
        fprintf(stderr, "b2ir_encode_node: unknown IR kind %d\n", node->kind);
        break;
    }
}

IRNode *east_beast2_decode_ir(const uint8_t *data, size_t len, EastValue **ir_value_out)
{
    if (ir_value_out) *ir_value_out = NULL;
    if (!data || len < 8) {
        fprintf(stderr, "beast2_decode_ir: invalid data (NULL or too short)\n");
        return NULL;
    }
    if (memcmp(data, BEAST2_MAGIC, 8) != 0) {
        fprintf(stderr, "beast2_decode_ir: invalid magic bytes\n");
        return NULL;
    }

    if (!east_type_type) east_type_of_type_init();

    size_t offset = 8;

    /* 1. Read type table → EastType*[] (direct reconstruction, no EastValue) */
    TypeTableResult tt = read_type_table_section(data, len, &offset);

    /* 2. Read string table */
    Beast2StringTableDec st = read_string_table_section(data, len, &offset);

    /* 3. Decode IR directly to IRNode — no EastValue intermediate, no arena,
     *    no convert_ir.  Type references resolve directly via type table. */
    IRNode *ir = b2ir_decode_node(data, len, &offset, tt.types, tt.count, &st);

    type_table_result_free(&tt);
    string_table_dec_free(&st);

    if (!ir) {
        fprintf(stderr, "beast2_decode_ir: failed to decode IR\n");
        return NULL;
    }

    if (offset != len) {
        fprintf(stderr, "beast2_decode_ir: %zu trailing bytes (at %zu of %zu)\n",
                len - offset, offset, len);
        ir_node_release(ir);
        return NULL;
    }

    /* No EastValue IR tree available — ir_value_out stays NULL */
    return ir;
}
