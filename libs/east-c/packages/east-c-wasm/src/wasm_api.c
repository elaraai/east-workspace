/*
 * WASM API for east-c.
 *
 * Provides a minimal API for compiling and executing East IR from JavaScript
 * via WebAssembly. Platform functions are implemented as JS callbacks that
 * the WASM module calls via imports.
 */

#include <east/east.h>
#include <east/eval_result.h>
#include <east/type_of_type.h>
#include <east/compiler.h>
#include <east/gc.h>
#include <east/serialization.h>

#include <emscripten.h>
#include <stdlib.h>
#include <string.h>

/* ------------------------------------------------------------------ */
/*  Global state                                                       */
/* ------------------------------------------------------------------ */

static PlatformRegistry *g_platform = NULL;
static BuiltinRegistry *g_builtins = NULL;
static int g_initialized = 0;

/* ------------------------------------------------------------------ */
/*  JS platform bridge                                                 */
/* ------------------------------------------------------------------ */

EM_JS(int, js_platform_call, (
    const char *name,
    const uint8_t *type_params_buf, size_t type_params_len,
    const uint8_t *args_buf, size_t args_len,
    uint8_t *out_buf, size_t *out_len
), {
    if (Module.js_platform_call) {
        return Module.js_platform_call(name, type_params_buf, type_params_len,
                                        args_buf, args_len,
                                        out_buf, out_len);
    }
    return 1;
});

#define PLATFORM_RESULT_BUF_SIZE (1024 * 1024)

static uint8_t *g_platform_result_buf = NULL;
/* Heap-allocated so it survives ASYNCIFY stack unwind/rewind. */
static size_t *g_platform_result_len = NULL;

/* ------------------------------------------------------------------ */
/*  Trampoline system for platform function dispatch                   */
/*                                                                     */
/*  C function pointers can't capture state, so we use a global        */
/*  trampoline set by the pre_call hook before each platform call.     */
/*  WASM is single-threaded so this is safe.                           */
/* ------------------------------------------------------------------ */

typedef struct PlatformTrampoline {
    char *name;
    EastType **type_params;
    size_t num_type_params;
    uint8_t *type_params_encoded;
    size_t type_params_encoded_len;
    struct PlatformTrampoline *next;
} PlatformTrampoline;

#define TRAMPOLINE_BUCKETS 256
static PlatformTrampoline *g_trampolines[TRAMPOLINE_BUCKETS];
static PlatformTrampoline *g_current_trampoline = NULL;

static uint32_t trampoline_hash(const char *name, EastType **tp, size_t ntp) {
    uint32_t h = 5381;
    for (const char *c = name; *c; c++) h = h * 33 + (uint32_t)*c;
    h ^= (uint32_t)ntp;
    for (size_t i = 0; i < ntp; i++) h = h * 33 + (uint32_t)(uintptr_t)tp[i];
    return h;
}

static void encode_type_params(PlatformTrampoline *t) {
    if (t->num_type_params == 0) {
        t->type_params_encoded = NULL;
        t->type_params_encoded_len = 0;
        return;
    }
    EastValue *arr = east_array_new(east_type_type);
    for (size_t i = 0; i < t->num_type_params; i++) {
        EastValue *tv = east_type_to_value(t->type_params[i]);
        east_array_push(arr, tv);
        east_value_release(tv);
    }
    EastType *arr_type = east_array_type(east_type_type);
    ByteBuffer *buf = east_beast2_encode_full(arr, arr_type);
    east_type_release(arr_type);
    east_value_release(arr);

    t->type_params_encoded = malloc(buf->len);
    memcpy(t->type_params_encoded, buf->data, buf->len);
    t->type_params_encoded_len = buf->len;
    byte_buffer_free(buf);
}

static PlatformTrampoline *get_or_create_trampoline(
    const char *name, EastType **type_params, size_t num_type_params
) {
    uint32_t h = trampoline_hash(name, type_params, num_type_params) % TRAMPOLINE_BUCKETS;

    for (PlatformTrampoline *t = g_trampolines[h]; t; t = t->next) {
        if (strcmp(t->name, name) == 0 && t->num_type_params == num_type_params) {
            bool match = true;
            for (size_t i = 0; i < num_type_params && match; i++) {
                if (!east_type_equal(t->type_params[i], type_params[i])) match = false;
            }
            if (match) return t;
        }
    }

    PlatformTrampoline *t = calloc(1, sizeof(PlatformTrampoline));
    t->name = strdup(name);
    t->num_type_params = num_type_params;
    if (num_type_params > 0) {
        t->type_params = malloc(sizeof(EastType *) * num_type_params);
        for (size_t i = 0; i < num_type_params; i++) {
            t->type_params[i] = type_params[i];
            east_type_retain(type_params[i]);
        }
    }
    encode_type_params(t);
    t->next = g_trampolines[h];
    g_trampolines[h] = t;
    return t;
}

/* ------------------------------------------------------------------ */
/*  Temporary handle table for function args passed to platform fns    */
/* ------------------------------------------------------------------ */

#define MAX_TEMP_HANDLES 256
static struct {
    EastValue *fn_values[MAX_TEMP_HANDLES];
    size_t count;
} g_temp_handles;

#define MAX_BRIDGE_DEPTH 32
static int g_bridge_depth = 0;
static size_t g_handle_stack[MAX_BRIDGE_DEPTH];

static uint32_t alloc_temp_handle(EastValue *fn_val) {
    if (g_temp_handles.count >= MAX_TEMP_HANDLES) return 0;
    uint32_t id = 0x80000000 | (uint32_t)g_temp_handles.count;
    east_value_retain(fn_val);
    g_temp_handles.fn_values[g_temp_handles.count++] = fn_val;
    return id;
}

static void free_temp_handles_to(size_t target) {
    while (g_temp_handles.count > target) {
        g_temp_handles.count--;
        east_value_release(g_temp_handles.fn_values[g_temp_handles.count]);
        g_temp_handles.fn_values[g_temp_handles.count] = NULL;
    }
}

/* ------------------------------------------------------------------ */
/*  Platform bridge function                                           */
/*                                                                     */
/*  Called by the compiler when IR hits an IR_PLATFORM node.            */
/*  input_types and output_type are provided by the compiler.          */
/* ------------------------------------------------------------------ */

static EvalResult platform_bridge_fn(EastValue **args, size_t num_args,
                                      EastType **input_types, size_t num_input_types,
                                      EastType *output_type) {
    PlatformTrampoline *t = g_current_trampoline;
    if (!t) return eval_error("platform bridge: no active trampoline");

    if (g_bridge_depth >= MAX_BRIDGE_DEPTH) {
        return eval_error("platform bridge: maximum nesting depth exceeded");
    }
    g_handle_stack[g_bridge_depth] = g_temp_handles.count;
    g_bridge_depth++;

    /* Encode args: [count:u32le][len:u32le][beast2]... */
    /* Function args use sentinel: [0xFFFFFFFF][handle_id][input_count][type_len][type_bytes] */
    ByteBuffer *args_buf = byte_buffer_new(1024);
    uint32_t count = (uint32_t)num_args;
    byte_buffer_write_bytes(args_buf, (uint8_t *)&count, 4);

    for (size_t i = 0; i < num_args; i++) {
        EastValue *v = args[i];
        EastType *arg_type = (i < num_input_types) ? input_types[i] : NULL;

        /* Function args → opaque handle */
        if (arg_type &&
            (arg_type->kind == EAST_TYPE_FUNCTION || arg_type->kind == EAST_TYPE_ASYNC_FUNCTION) &&
            v->kind == EAST_VAL_FUNCTION) {

            uint32_t sentinel = 0xFFFFFFFF;
            byte_buffer_write_bytes(args_buf, (uint8_t *)&sentinel, 4);

            uint32_t handle_id = alloc_temp_handle(v);
            if (handle_id == 0) {
                byte_buffer_free(args_buf);
                g_bridge_depth--;
                return eval_error("platform bridge: too many function handles");
            }
            byte_buffer_write_bytes(args_buf, (uint8_t *)&handle_id, 4);

            uint32_t input_count = (uint32_t)arg_type->data.function.num_inputs;
            byte_buffer_write_bytes(args_buf, (uint8_t *)&input_count, 4);

            EastValue *type_val = east_type_to_value(arg_type);
            ByteBuffer *tbuf = east_beast2_encode_full(type_val, east_type_type);
            uint32_t tlen = (uint32_t)tbuf->len;
            byte_buffer_write_bytes(args_buf, (uint8_t *)&tlen, 4);
            byte_buffer_write_bytes(args_buf, tbuf->data, tbuf->len);
            byte_buffer_free(tbuf);
            east_value_release(type_val);
            continue;
        }

        /* Beast2-encode the value using the compiler-provided type */
        ByteBuffer *vbuf = east_beast2_encode_full(v, arg_type);
        uint32_t vlen = (uint32_t)vbuf->len;
        byte_buffer_write_bytes(args_buf, (uint8_t *)&vlen, 4);
        byte_buffer_write_bytes(args_buf, vbuf->data, vbuf->len);
        byte_buffer_free(vbuf);
    }

    *g_platform_result_len = PLATFORM_RESULT_BUF_SIZE;
    int rc = js_platform_call(
        t->name,
        t->type_params_encoded, t->type_params_encoded_len,
        args_buf->data, args_buf->len,
        g_platform_result_buf, g_platform_result_len
    );

    byte_buffer_free(args_buf);

    size_t out_len = *g_platform_result_len;

    g_bridge_depth--;
    if (g_bridge_depth < MAX_BRIDGE_DEPTH) {
        free_temp_handles_to(g_handle_stack[g_bridge_depth]);
    }

    if (rc != 0) {
        char *msg = malloc(out_len + 1);
        memcpy(msg, g_platform_result_buf, out_len);
        msg[out_len] = '\0';
        EvalResult err = eval_error(msg);
        free(msg);
        return err;
    }

    if (out_len == 0) {
        return eval_ok(east_null());
    }

    EastValue *result = east_beast2_decode_auto(g_platform_result_buf, out_len);
    if (!result) {
        return eval_error("platform bridge: failed to decode result from JS");
    }
    return eval_ok(result);
}

static PlatformFn platform_bridge_factory(EastType **type_params, size_t num_type_params) {
    (void)type_params;
    (void)num_type_params;
    return platform_bridge_fn;
}

/* ------------------------------------------------------------------ */
/*  Handle table for compiled functions                                */
/* ------------------------------------------------------------------ */

#define MAX_HANDLES 4096
static EastValue *g_handles[MAX_HANDLES];
static uint32_t g_next_handle = 1;

static uint32_t alloc_handle(EastCompiledFn *fn) {
    EastValue *fn_value = east_function_value(fn);
    /* east_function_value creates with refcount 1, find a slot and store */
    for (uint32_t i = g_next_handle; i < MAX_HANDLES; i++) {
        if (g_handles[i] == NULL) {
            g_handles[i] = fn_value;  /* takes ownership of the refcount */
            g_next_handle = i + 1;
            return i;
        }
    }
    for (uint32_t i = 1; i < g_next_handle; i++) {
        if (g_handles[i] == NULL) {
            g_handles[i] = fn_value;
            g_next_handle = i + 1;
            return i;
        }
    }
    east_value_release(fn_value);
    return 0;
}

static EastCompiledFn *get_handle(uint32_t h) {
    if (h == 0 || h >= MAX_HANDLES) return NULL;
    EastValue *v = g_handles[h];
    if (!v || v->kind != EAST_VAL_FUNCTION) return NULL;
    return v->data.function.compiled;
}

static void free_handle(uint32_t h) {
    if (h > 0 && h < MAX_HANDLES && g_handles[h]) {
        east_value_release(g_handles[h]);
        g_handles[h] = NULL;
    }
}

/* ------------------------------------------------------------------ */
/*  Last error tracking                                                */
/* ------------------------------------------------------------------ */

static char *g_last_error = NULL;

static void set_last_error(const char *msg) {
    free(g_last_error);
    g_last_error = msg ? strdup(msg) : NULL;
}

static void clear_last_error(void) {
    free(g_last_error);
    g_last_error = NULL;
}

/* ------------------------------------------------------------------ */
/*  Shared compilation helper                                          */
/* ------------------------------------------------------------------ */

/* Compile an IR value (already decoded) to a handle. */
static uint32_t compile_ir_node(IRNode *ir) {
    IRNode *body = ir;
    size_t num_params = 0;
    IRVariable *params = NULL;
    if (ir->kind == IR_ASYNC_FUNCTION || ir->kind == IR_FUNCTION) {
        num_params = ir->data.function.num_params;
        params = ir->data.function.params;
        body = ir->data.function.body;
    }

    EastCompiledFn *fn = east_compile(body, g_platform, g_builtins);
    if (!fn) {
        set_last_error("failed to compile IR");
        ir_node_release(ir);
        return 0;
    }

    /* Store the Function type (not just the body type) for type marshalling */
    fn->fn_type = ir->type;

    if (num_params > 0 && params) {
        fn->num_params = num_params;
        fn->param_names = calloc(num_params, sizeof(char *));
        if (fn->param_names) {
            for (size_t i = 0; i < num_params; i++)
                fn->param_names[i] = strdup(params[i].name);
        }
    }

    uint32_t handle = alloc_handle(fn);
    if (handle == 0) {
        set_last_error("out of compiled function handles");
        east_compiled_fn_free(fn);
    }

    ir_node_release(ir);
    return handle;
}

/* Compile an IR value (EastValue*) to a handle — decodes to IRNode first. */
static uint32_t compile_ir_value(EastValue *ir_val) {
    IRNode *ir = east_ir_from_value(ir_val);
    east_value_release(ir_val);
    if (!ir) {
        set_last_error("failed to convert IR value to IR node tree");
        return 0;
    }
    return compile_ir_node(ir);
}

/* ------------------------------------------------------------------ */
/*  Pre-call hook                                                      */
/* ------------------------------------------------------------------ */

static void wasm_platform_pre_call(const char *name, EastType **type_params, size_t num_type_params) {
    g_current_trampoline = get_or_create_trampoline(name, type_params, num_type_params);
}

/* ------------------------------------------------------------------ */
/*  Public WASM API                                                    */
/* ------------------------------------------------------------------ */

EMSCRIPTEN_KEEPALIVE
const char *east_wasm_last_error(void) {
    return g_last_error;
}

EMSCRIPTEN_KEEPALIVE
void east_wasm_init(void) {
    if (g_initialized) return;

    east_type_of_type_init();

    g_platform = platform_registry_new();
    g_platform->pre_call = wasm_platform_pre_call;
    g_builtins = builtin_registry_new();
    east_register_all_builtins(g_builtins);

    g_platform_result_buf = malloc(PLATFORM_RESULT_BUF_SIZE);
    g_platform_result_len = malloc(sizeof(size_t));

    memset(g_handles, 0, sizeof(g_handles));
    memset(g_trampolines, 0, sizeof(g_trampolines));
    memset(&g_temp_handles, 0, sizeof(g_temp_handles));
    g_bridge_depth = 0;

    g_initialized = 1;
}

EMSCRIPTEN_KEEPALIVE
void east_wasm_register_platform(const char *name, int is_generic, int is_async) {
    if (is_generic) {
        platform_registry_add_generic(g_platform, name, platform_bridge_factory, is_async != 0);
    } else {
        platform_registry_add(g_platform, name, platform_bridge_fn, is_async != 0);
    }
}

EMSCRIPTEN_KEEPALIVE
uint32_t east_wasm_compile(const uint8_t *ir_bytes, size_t ir_len) {
    clear_last_error();
    if (!g_initialized) { set_last_error("east_wasm_init() not called"); return 0; }

    /* Combined decode+convert with O(1) type resolution via type table */
    IRNode *ir = east_beast2_decode_ir(ir_bytes, ir_len, NULL);
    if (!ir) { set_last_error("failed to decode Beast2-full IR bytes"); return 0; }

    return compile_ir_node(ir);
}

EMSCRIPTEN_KEEPALIVE
uint32_t east_wasm_compile_json(const uint8_t *json, size_t json_len) {
    clear_last_error();
    if (!g_initialized) { set_last_error("east_wasm_init() not called"); return 0; }

    char *json_str = malloc(json_len + 1);
    if (!json_str) { set_last_error("out of memory"); return 0; }
    memcpy(json_str, json, json_len);
    json_str[json_len] = '\0';

    char *decode_error = NULL;
    EastValue *ir_val = east_json_decode_with_error(json_str, east_ir_type, &decode_error);
    free(json_str);
    if (!ir_val) {
        if (decode_error) { set_last_error(decode_error); free(decode_error); }
        else { set_last_error("failed to decode JSON IR"); }
        return 0;
    }

    return compile_ir_value(ir_val);
}

EMSCRIPTEN_KEEPALIVE
uint32_t east_wasm_compile_east(const uint8_t *text, size_t text_len) {
    clear_last_error();
    if (!g_initialized) { set_last_error("east_wasm_init() not called"); return 0; }

    char *text_str = malloc(text_len + 1);
    if (!text_str) { set_last_error("out of memory"); return 0; }
    memcpy(text_str, text, text_len);
    text_str[text_len] = '\0';

    char *parse_error = NULL;
    EastValue *ir_val = east_parse_value_with_error(text_str, east_ir_type, &parse_error);
    free(text_str);
    if (!ir_val) {
        if (parse_error) { set_last_error(parse_error); free(parse_error); }
        else { set_last_error("failed to parse East text IR"); }
        return 0;
    }

    return compile_ir_value(ir_val);
}

/* Shared call result encoding — returns 0 on success, 1 on error */
static int encode_call_result(EvalResult result, EastType *result_type,
                               uint8_t *result_buf, size_t *result_len,
                               char *error_buf, size_t *error_len) {
    if (result.status == EVAL_ERROR) {
        const char *msg = result.error_message ? result.error_message : "unknown error";
        size_t mlen = strlen(msg);
        if (mlen > *error_len) mlen = *error_len;
        memcpy(error_buf, msg, mlen);
        *error_len = mlen;
        *result_len = 0;
        eval_result_free(&result);
        return 1;
    }

    if (!result.value || result.value->kind == EAST_VAL_NULL) {
        *result_len = 0;
        if (result.value) east_value_release(result.value);
        eval_result_free(&result);
        return 0;
    }

    if (!result_type) {
        *result_len = 0;
        east_value_release(result.value);
        eval_result_free(&result);
        return 0;
    }

    ByteBuffer *buf = east_beast2_encode_full(result.value, result_type);
    if (buf->len > *result_len) {
        const char *msg = "result buffer too small";
        size_t mlen = strlen(msg);
        if (mlen > *error_len) mlen = *error_len;
        memcpy(error_buf, msg, mlen);
        *error_len = mlen;
        *result_len = 0;
        byte_buffer_free(buf);
        east_value_release(result.value);
        eval_result_free(&result);
        return 1;
    }

    memcpy(result_buf, buf->data, buf->len);
    *result_len = buf->len;
    byte_buffer_free(buf);
    east_value_release(result.value);
    eval_result_free(&result);
    return 0;
}

/* Decode packed args: [count:u32le][len:u32le][beast2]... */
static EastValue **decode_packed_args(const uint8_t *args_buf, size_t args_len, uint32_t *out_num_args) {
    *out_num_args = 0;
    if (args_len < 4) return NULL;

    uint32_t num_args;
    memcpy(&num_args, args_buf, 4);
    size_t offset = 4;

    EastValue **args = calloc(num_args, sizeof(EastValue *));
    for (uint32_t i = 0; i < num_args; i++) {
        if (offset + 4 > args_len) break;
        uint32_t vlen;
        memcpy(&vlen, args_buf + offset, 4);
        offset += 4;
        if (offset + vlen > args_len) break;
        args[i] = east_beast2_decode_auto(args_buf + offset, vlen);
        offset += vlen;
    }

    *out_num_args = num_args;
    return args;
}

static void free_args(EastValue **args, uint32_t num_args) {
    for (uint32_t i = 0; i < num_args; i++) {
        if (args[i]) east_value_release(args[i]);
    }
    free(args);
}

/* ------------------------------------------------------------------ */
/*  Direct value accessors (pointer-based, no beast2 marshalling)      */
/* ------------------------------------------------------------------ */

EMSCRIPTEN_KEEPALIVE int east_wasm_value_kind(uintptr_t ptr) {
    return ptr ? ((EastValue *)ptr)->kind : -1;
}

EMSCRIPTEN_KEEPALIVE int east_wasm_get_bool(uintptr_t ptr) {
    return ((EastValue *)ptr)->data.boolean ? 1 : 0;
}

EMSCRIPTEN_KEEPALIVE double east_wasm_get_float(uintptr_t ptr) {
    return ((EastValue *)ptr)->data.float64;
}

/* For i64 values (integer, datetime), return low and high 32-bit halves
 * since WASM i64 ↔ JS BigInt requires special handling. */
EMSCRIPTEN_KEEPALIVE uint32_t east_wasm_get_i64_lo(uintptr_t ptr) {
    EastValue *v = (EastValue *)ptr;
    int64_t val = (v->kind == EAST_VAL_DATETIME) ? v->data.datetime : v->data.integer;
    return (uint32_t)(val & 0xFFFFFFFF);
}

EMSCRIPTEN_KEEPALIVE int32_t east_wasm_get_i64_hi(uintptr_t ptr) {
    EastValue *v = (EastValue *)ptr;
    int64_t val = (v->kind == EAST_VAL_DATETIME) ? v->data.datetime : v->data.integer;
    return (int32_t)(val >> 32);
}

EMSCRIPTEN_KEEPALIVE uintptr_t east_wasm_get_string_ptr(uintptr_t ptr) {
    return (uintptr_t)((EastValue *)ptr)->data.string.data;
}

EMSCRIPTEN_KEEPALIVE uint32_t east_wasm_get_string_len(uintptr_t ptr) {
    return (uint32_t)((EastValue *)ptr)->data.string.len;
}

EMSCRIPTEN_KEEPALIVE uintptr_t east_wasm_get_blob_ptr(uintptr_t ptr) {
    return (uintptr_t)((EastValue *)ptr)->data.blob.data;
}

EMSCRIPTEN_KEEPALIVE uint32_t east_wasm_get_blob_len(uintptr_t ptr) {
    return (uint32_t)((EastValue *)ptr)->data.blob.len;
}

EMSCRIPTEN_KEEPALIVE uint32_t east_wasm_collection_len(uintptr_t ptr) {
    EastValue *v = (EastValue *)ptr;
    switch (v->kind) {
    case EAST_VAL_ARRAY:  return (uint32_t)v->data.array.len;
    case EAST_VAL_SET:    return (uint32_t)v->data.set.len;
    case EAST_VAL_DICT:   return (uint32_t)v->data.dict.len;
    case EAST_VAL_STRUCT: return (uint32_t)v->data.struct_.num_fields;
    default: return 0;
    }
}

EMSCRIPTEN_KEEPALIVE uintptr_t east_wasm_array_get(uintptr_t ptr, uint32_t idx) {
    EastValue *v = (EastValue *)ptr;
    if (idx >= v->data.array.len) return 0;
    return (uintptr_t)v->data.array.items[idx];
}

EMSCRIPTEN_KEEPALIVE uintptr_t east_wasm_set_get(uintptr_t ptr, uint32_t idx) {
    EastValue *v = (EastValue *)ptr;
    if (idx >= v->data.set.len) return 0;
    return (uintptr_t)v->data.set.items[idx];
}

EMSCRIPTEN_KEEPALIVE uintptr_t east_wasm_dict_key(uintptr_t ptr, uint32_t idx) {
    EastValue *v = (EastValue *)ptr;
    if (idx >= v->data.dict.len) return 0;
    return (uintptr_t)v->data.dict.keys[idx];
}

EMSCRIPTEN_KEEPALIVE uintptr_t east_wasm_dict_value(uintptr_t ptr, uint32_t idx) {
    EastValue *v = (EastValue *)ptr;
    if (idx >= v->data.dict.len) return 0;
    return (uintptr_t)v->data.dict.values[idx];
}

EMSCRIPTEN_KEEPALIVE uintptr_t east_wasm_struct_field_name(uintptr_t ptr, uint32_t idx) {
    return (uintptr_t)((EastValue *)ptr)->data.struct_.field_names[idx];
}

EMSCRIPTEN_KEEPALIVE uintptr_t east_wasm_struct_field_value(uintptr_t ptr, uint32_t idx) {
    return (uintptr_t)((EastValue *)ptr)->data.struct_.field_values[idx];
}

EMSCRIPTEN_KEEPALIVE uintptr_t east_wasm_variant_tag(uintptr_t ptr) {
    return (uintptr_t)((EastValue *)ptr)->data.variant.case_tag;
}

EMSCRIPTEN_KEEPALIVE uintptr_t east_wasm_variant_value(uintptr_t ptr) {
    return (uintptr_t)((EastValue *)ptr)->data.variant.value;
}

EMSCRIPTEN_KEEPALIVE uintptr_t east_wasm_ref_get(uintptr_t ptr) {
    return (uintptr_t)((EastValue *)ptr)->data.ref.value;
}

EMSCRIPTEN_KEEPALIVE uintptr_t east_wasm_vector_data(uintptr_t ptr) {
    return (uintptr_t)((EastValue *)ptr)->data.vector.data;
}

EMSCRIPTEN_KEEPALIVE uint32_t east_wasm_vector_len(uintptr_t ptr) {
    return (uint32_t)((EastValue *)ptr)->data.vector.len;
}

EMSCRIPTEN_KEEPALIVE int east_wasm_vector_elem_kind(uintptr_t ptr) {
    EastType *et = ((EastValue *)ptr)->data.vector.elem_type;
    return et ? et->kind : -1;
}

EMSCRIPTEN_KEEPALIVE int east_wasm_matrix_elem_kind(uintptr_t ptr) {
    EastType *et = ((EastValue *)ptr)->data.matrix.elem_type;
    return et ? et->kind : -1;
}

EMSCRIPTEN_KEEPALIVE uintptr_t east_wasm_matrix_data(uintptr_t ptr) {
    return (uintptr_t)((EastValue *)ptr)->data.matrix.data;
}

EMSCRIPTEN_KEEPALIVE uint32_t east_wasm_matrix_rows(uintptr_t ptr) {
    return (uint32_t)((EastValue *)ptr)->data.matrix.rows;
}

EMSCRIPTEN_KEEPALIVE uint32_t east_wasm_matrix_cols(uintptr_t ptr) {
    return (uint32_t)((EastValue *)ptr)->data.matrix.cols;
}

EMSCRIPTEN_KEEPALIVE void east_wasm_value_release(uintptr_t ptr) {
    if (ptr) east_value_release((EastValue *)ptr);
}

/* ------------------------------------------------------------------ */
/*  Type accessors (for reading EastType* from WASM memory)            */
/* ------------------------------------------------------------------ */

EMSCRIPTEN_KEEPALIVE int east_wasm_type_kind(uintptr_t ptr) {
    return ptr ? ((EastType *)ptr)->kind : -1;
}

EMSCRIPTEN_KEEPALIVE int64_t east_wasm_type_id(uintptr_t ptr) {
    return ptr ? ((EastType *)ptr)->type_id : -1;
}

/* Array, Set, Ref, Vector, Matrix: element type */
EMSCRIPTEN_KEEPALIVE uintptr_t east_wasm_type_element(uintptr_t ptr) {
    return (uintptr_t)((EastType *)ptr)->data.element;
}

/* Dict: key and value types */
EMSCRIPTEN_KEEPALIVE uintptr_t east_wasm_type_dict_key(uintptr_t ptr) {
    return (uintptr_t)((EastType *)ptr)->data.dict.key;
}

EMSCRIPTEN_KEEPALIVE uintptr_t east_wasm_type_dict_val(uintptr_t ptr) {
    return (uintptr_t)((EastType *)ptr)->data.dict.value;
}

/* Struct/Variant: number of fields/cases */
EMSCRIPTEN_KEEPALIVE uint32_t east_wasm_type_num_fields(uintptr_t ptr) {
    EastType *t = (EastType *)ptr;
    if (t->kind == EAST_TYPE_STRUCT) return (uint32_t)t->data.struct_.num_fields;
    if (t->kind == EAST_TYPE_VARIANT) return (uint32_t)t->data.variant.num_cases;
    return 0;
}

EMSCRIPTEN_KEEPALIVE uintptr_t east_wasm_type_field_name(uintptr_t ptr, uint32_t idx) {
    EastType *t = (EastType *)ptr;
    if (t->kind == EAST_TYPE_STRUCT) return (uintptr_t)t->data.struct_.fields[idx].name;
    if (t->kind == EAST_TYPE_VARIANT) return (uintptr_t)t->data.variant.cases[idx].name;
    return 0;
}

EMSCRIPTEN_KEEPALIVE uintptr_t east_wasm_type_field_type(uintptr_t ptr, uint32_t idx) {
    EastType *t = (EastType *)ptr;
    if (t->kind == EAST_TYPE_STRUCT) return (uintptr_t)t->data.struct_.fields[idx].type;
    if (t->kind == EAST_TYPE_VARIANT) return (uintptr_t)t->data.variant.cases[idx].type;
    return 0;
}

/* Function: inputs and output */
EMSCRIPTEN_KEEPALIVE uint32_t east_wasm_type_fn_num_inputs(uintptr_t ptr) {
    return (uint32_t)((EastType *)ptr)->data.function.num_inputs;
}

EMSCRIPTEN_KEEPALIVE uintptr_t east_wasm_type_fn_input(uintptr_t ptr, uint32_t idx) {
    return (uintptr_t)((EastType *)ptr)->data.function.inputs[idx];
}

EMSCRIPTEN_KEEPALIVE uintptr_t east_wasm_type_fn_output(uintptr_t ptr) {
    return (uintptr_t)((EastType *)ptr)->data.function.output;
}

/* Recursive: inner type */
EMSCRIPTEN_KEEPALIVE uintptr_t east_wasm_type_recursive_inner(uintptr_t ptr) {
    return (uintptr_t)((EastType *)ptr)->data.recursive.node;
}

/* Get function type pointer from compiled handle */
EMSCRIPTEN_KEEPALIVE uintptr_t east_wasm_fn_type_ptr(uint32_t handle) {
    EastCompiledFn *fn = get_handle(handle);
    if (!fn) return 0;
    return (uintptr_t)fn->fn_type;
}

/* ------------------------------------------------------------------ */
/*  Pointer-returning call (no beast2 marshalling)                     */
/* ------------------------------------------------------------------ */

EMSCRIPTEN_KEEPALIVE uintptr_t east_wasm_call_ptr(uint32_t handle,
                                                    char *error_buf, size_t *error_len) {
    EastCompiledFn *fn = get_handle(handle);
    if (!fn) {
        const char *msg = "invalid handle";
        size_t mlen = strlen(msg);
        if (mlen > *error_len) mlen = *error_len;
        memcpy(error_buf, msg, mlen);
        *error_len = mlen;
        return 0;
    }

    EvalResult result = east_call(fn, NULL, 0);
    if (result.status == EVAL_ERROR) {
        const char *msg = result.error_message ? result.error_message : "unknown error";
        size_t mlen = strlen(msg);
        if (mlen > *error_len) mlen = *error_len;
        memcpy(error_buf, msg, mlen);
        *error_len = mlen;
        eval_result_free(&result);
        return 0;
    }

    EastValue *val = result.value;
    eval_result_free(&result);
    /* Caller owns the returned value — must call east_wasm_value_release. */
    return (uintptr_t)val;
}

EMSCRIPTEN_KEEPALIVE uintptr_t east_wasm_call_ptr_with_args(uint32_t handle,
                                                              const uint8_t *args_buf, size_t args_len,
                                                              char *error_buf, size_t *error_len) {
    EastCompiledFn *fn = get_handle(handle);
    if (!fn) {
        const char *msg = "invalid handle";
        size_t mlen = strlen(msg);
        if (mlen > *error_len) mlen = *error_len;
        memcpy(error_buf, msg, mlen);
        *error_len = mlen;
        return 0;
    }

    uint32_t num_args;
    EastValue **args = decode_packed_args(args_buf, args_len, &num_args);

    EvalResult result = east_call(fn, args, num_args);
    free_args(args, num_args);

    if (result.status == EVAL_ERROR) {
        const char *msg = result.error_message ? result.error_message : "unknown error";
        size_t mlen = strlen(msg);
        if (mlen > *error_len) mlen = *error_len;
        memcpy(error_buf, msg, mlen);
        *error_len = mlen;
        eval_result_free(&result);
        return 0;
    }

    EastValue *val = result.value;
    eval_result_free(&result);
    return (uintptr_t)val;
}

/* ------------------------------------------------------------------ */
/*  Beast2 data value decode (returns pointer, no IR needed)           */
/* ------------------------------------------------------------------ */

EMSCRIPTEN_KEEPALIVE uintptr_t east_wasm_decode_value(const uint8_t *data, size_t len,
                                                       char *error_buf, size_t *error_len) {
    clear_last_error();
    if (!g_initialized) {
        const char *msg = "east_wasm_init() not called";
        size_t mlen = strlen(msg);
        if (mlen > *error_len) mlen = *error_len;
        memcpy(error_buf, msg, mlen);
        *error_len = mlen;
        return 0;
    }

    EastValue *val = east_beast2_decode_auto(data, len);
    if (!val) {
        const char *msg = "failed to decode beast2 value";
        size_t mlen = strlen(msg);
        if (mlen > *error_len) mlen = *error_len;
        memcpy(error_buf, msg, mlen);
        *error_len = mlen;
        return 0;
    }

    /* Caller owns the returned value — must call east_wasm_value_release. */
    return (uintptr_t)val;
}

/* ------------------------------------------------------------------ */
/*  Legacy beast2-based call (kept for backward compatibility)         */
/* ------------------------------------------------------------------ */

EMSCRIPTEN_KEEPALIVE
int east_wasm_call(uint32_t handle,
                    uint8_t *result_buf, size_t *result_len,
                    char *error_buf, size_t *error_len) {
    EastCompiledFn *fn = get_handle(handle);
    if (!fn) {
        const char *msg = "invalid handle";
        size_t mlen = strlen(msg);
        if (mlen > *error_len) mlen = *error_len;
        memcpy(error_buf, msg, mlen);
        *error_len = mlen;
        *result_len = 0;
        return 1;
    }

    EvalResult result = east_call(fn, NULL, 0);
    return encode_call_result(result, fn->ir->type, result_buf, result_len, error_buf, error_len);
}

EMSCRIPTEN_KEEPALIVE
int east_wasm_call_with_args(uint32_t handle,
                              const uint8_t *args_buf, size_t args_len,
                              uint8_t *result_buf, size_t *result_len,
                              char *error_buf, size_t *error_len) {
    EastCompiledFn *fn = get_handle(handle);
    if (!fn) {
        const char *msg = "invalid handle";
        size_t mlen = strlen(msg);
        if (mlen > *error_len) mlen = *error_len;
        memcpy(error_buf, msg, mlen);
        *error_len = mlen;
        *result_len = 0;
        return 1;
    }

    uint32_t num_args;
    EastValue **args = decode_packed_args(args_buf, args_len, &num_args);

    EvalResult result = east_call(fn, args, num_args);
    free_args(args, num_args);

    return encode_call_result(result, fn->ir->type, result_buf, result_len, error_buf, error_len);
}

EMSCRIPTEN_KEEPALIVE
int east_wasm_get_fn_type(uint32_t handle, uint8_t *out_buf, size_t *out_len) {
    EastCompiledFn *fn = get_handle(handle);
    if (!fn) {
        *out_len = 0;
        return 1;
    }

    EastType *ft = fn->fn_type;
    if (!ft) {
        *out_len = 0;
        return 1;
    }

    EastValue *type_val = east_type_to_value(ft);
    ByteBuffer *buf = east_beast2_encode_full(type_val, east_type_type);
    east_value_release(type_val);

    if (buf->len > *out_len) {
        byte_buffer_free(buf);
        *out_len = 0;
        return 1;
    }

    memcpy(out_buf, buf->data, buf->len);
    *out_len = buf->len;
    byte_buffer_free(buf);
    return 0;
}

EMSCRIPTEN_KEEPALIVE
void east_wasm_free(uint32_t handle) {
    free_handle(handle);
}

EMSCRIPTEN_KEEPALIVE
void east_wasm_gc(void) {
    east_gc_collect();
}

EMSCRIPTEN_KEEPALIVE
void *east_wasm_malloc(size_t size) {
    return malloc(size);
}

EMSCRIPTEN_KEEPALIVE
void east_wasm_free_buf(void *ptr) {
    free(ptr);
}

/*
 * Invoke a function via its temp handle (callback from JS into WASM).
 * Args are Beast2-full packed. Result is Beast2-full encoded (legacy).
 */
EMSCRIPTEN_KEEPALIVE
int east_wasm_invoke_fn(uint32_t handle_id,
                         const uint8_t *args_buf, size_t args_len,
                         uint8_t *result_buf, size_t *result_len,
                         char *error_buf, size_t *error_len) {
    EastValue *fn_val = NULL;
    if (handle_id & 0x80000000) {
        uint32_t idx = handle_id & 0x7FFFFFFF;
        if (idx < g_temp_handles.count)
            fn_val = g_temp_handles.fn_values[idx];
    }
    if (!fn_val || fn_val->kind != EAST_VAL_FUNCTION) {
        const char *msg = "invalid function handle";
        size_t mlen = strlen(msg);
        if (mlen > *error_len) mlen = *error_len;
        memcpy(error_buf, msg, mlen);
        *error_len = mlen;
        *result_len = 0;
        return 1;
    }

    EastCompiledFn *fn = fn_val->data.function.compiled;
    if (!fn) {
        const char *msg = "function handle has no compiled function";
        size_t mlen = strlen(msg);
        if (mlen > *error_len) mlen = *error_len;
        memcpy(error_buf, msg, mlen);
        *error_len = mlen;
        *result_len = 0;
        return 1;
    }

    uint32_t num_args;
    EastValue **args = decode_packed_args(args_buf, args_len, &num_args);

    EvalResult result = east_call(fn, args, num_args);
    free_args(args, num_args);

    return encode_call_result(result, fn->ir->type, result_buf, result_len, error_buf, error_len);
}

/*
 * Invoke a function via temp handle — pointer-returning variant (no beast2).
 */
EMSCRIPTEN_KEEPALIVE
uintptr_t east_wasm_invoke_fn_ptr(uint32_t handle_id,
                                    const uint8_t *args_buf, size_t args_len,
                                    char *error_buf, size_t *error_len) {
    EastValue *fn_val = NULL;
    if (handle_id & 0x80000000) {
        uint32_t idx = handle_id & 0x7FFFFFFF;
        if (idx < g_temp_handles.count)
            fn_val = g_temp_handles.fn_values[idx];
    }
    if (!fn_val || fn_val->kind != EAST_VAL_FUNCTION || !fn_val->data.function.compiled) {
        const char *msg = "invalid function handle";
        size_t mlen = strlen(msg);
        if (mlen > *error_len) mlen = *error_len;
        memcpy(error_buf, msg, mlen);
        *error_len = mlen;
        return 0;
    }

    EastCompiledFn *fn = fn_val->data.function.compiled;
    uint32_t num_args;
    EastValue **args = decode_packed_args(args_buf, args_len, &num_args);
    EvalResult result = east_call(fn, args, num_args);
    free_args(args, num_args);

    if (result.status == EVAL_ERROR) {
        const char *msg = result.error_message ? result.error_message : "unknown error";
        size_t mlen = strlen(msg);
        if (mlen > *error_len) mlen = *error_len;
        memcpy(error_buf, msg, mlen);
        *error_len = mlen;
        eval_result_free(&result);
        return 0;
    }

    EastValue *val = result.value;
    eval_result_free(&result);
    return (uintptr_t)val;
}

/* Allocate a temp handle for a function EastValue* (for JS to invoke later). */
EMSCRIPTEN_KEEPALIVE
uint32_t east_wasm_alloc_fn_handle(uintptr_t fn_ptr) {
    EastValue *v = (EastValue *)fn_ptr;
    if (!v || v->kind != EAST_VAL_FUNCTION || !v->data.function.compiled) return 0;
    return alloc_temp_handle(v);
}
