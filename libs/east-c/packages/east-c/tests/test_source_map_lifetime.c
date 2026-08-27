/*
 * Source-map lifetime gate (#626): a function value keeps the source map it
 * resolves loc_ids against alive for as long as it can raise.
 *
 * Maps are reference-counted (east_source_map_retain/release) and every
 * closure that resolves against one holds a reference — a closure created
 * while a map was the current map, and a closure decoded from a blob's
 * source-map section alike. Before this gate the whole-value beast2 decoders
 * handed every decoded closure a pointer into a stack-local header that was
 * disposed before the decode returned, and the compiled-function owner never
 * freed anything: the first error raised through a decoded function with real
 * loc_ids read a dead stack frame. It went unnoticed only because every
 * python-authored program carried loc_id 0, which the resolver rejects before
 * touching the map.
 *
 * The gate drives the full lifetime: decode a {ir, source_map} program, compile
 * it with the map current, drop every reference but the closure's, raise
 * through it, encode it as a function value (v5 and v4), free the encoder-side
 * value, decode, and raise through the decoded closure after its decode call
 * has returned. Run under ASan/LSan (run_leak_check.sh's build-asan config):
 * the retain/release balance across compile, encode, decode and free is the
 * leak oracle.
 */
#include <east/east.h>
#include <east/eval_result.h>
#include <east/type_of_type.h>

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

/* (x: Integer) -> IntegerDivide(x, 0), with loc_id 1 on the Builtin node and
 * loc_id 2 on the Function node. Stack 1 has two frames (the expression and
 * its caller), stack 2 one — so a resolved stack is checked for both its
 * contents and its length. Exported by east.ir.builders + encode_json_for
 * (IRType); the source_map object is the {ir, source_map} wrapper shape the
 * TS test export writes (Integer fields are JSON strings). */
static const char *PROGRAM_JSON =
    "{\"ir\":{\"type\":\"Function\",\"value\":{\"type\":{\"type\":\"Function\",\"value\":"
    "{\"inputs\":[{\"type\":\"Integer\",\"value\":null}],\"output\":{\"type\":\"Integer\","
    "\"value\":null}}},\"loc_id\":\"2\",\"captures\":[],\"parameters\":[{\"type\":\"Variable\","
    "\"value\":{\"type\":{\"type\":\"Integer\",\"value\":null},\"loc_id\":\"0\",\"name\":\"x\","
    "\"mutable\":false,\"captured\":false}}],\"body\":{\"type\":\"Builtin\",\"value\":{\"type\":"
    "{\"type\":\"Integer\",\"value\":null},\"loc_id\":\"1\",\"builtin\":\"IntegerDivide\","
    "\"type_parameters\":[],\"arguments\":[{\"type\":\"Variable\",\"value\":{\"type\":{\"type\":"
    "\"Integer\",\"value\":null},\"loc_id\":\"0\",\"name\":\"x\",\"mutable\":false,\"captured\":"
    "false}},{\"type\":\"Value\",\"value\":{\"type\":{\"type\":\"Integer\",\"value\":null},"
    "\"loc_id\":\"0\",\"value\":{\"type\":\"Integer\",\"value\":\"0\"}}}]}}}},"
    "\"source_map\":{\"stacks\":[[],[{\"filename\":\"authored.py\",\"line\":\"7\",\"column\":"
    "\"12\"},{\"filename\":\"caller.py\",\"line\":\"3\",\"column\":\"1\"}],[{\"filename\":"
    "\"authored.py\",\"line\":\"6\",\"column\":\"5\"}]]}}";

static int failures = 0;

#define CHECK(cond, ...)                                                                           \
    do {                                                                                           \
        if (!(cond)) {                                                                             \
            printf("FAIL: ");                                                                      \
            printf(__VA_ARGS__);                                                                   \
            printf("\n");                                                                          \
            failures++;                                                                            \
        }                                                                                          \
    } while (0)

/* Call `fn` with 1 and check the error carries loc_id 1's two-frame stack. */
static void check_raises_at_authored_site(EastCompiledFn *fn, const char *what)
{
    EastValue *arg = east_integer(1);
    EvalResult r = east_call(fn, &arg, 1);
    east_value_release(arg);
    CHECK(r.status == EVAL_ERROR, "%s: expected a runtime error, got status %d", what, r.status);
    CHECK(r.num_locations == 2, "%s: expected 2 resolved frames, got %zu", what, r.num_locations);
    if (r.num_locations == 2) {
        CHECK(r.locations[0].filename && strcmp(r.locations[0].filename, "authored.py") == 0 &&
                  r.locations[0].line == 7 && r.locations[0].column == 12,
              "%s: frame 0 is %s:%lld:%lld, expected authored.py:7:12", what,
              r.locations[0].filename ? r.locations[0].filename : "(null)",
              (long long)r.locations[0].line, (long long)r.locations[0].column);
        CHECK(r.locations[1].filename && strcmp(r.locations[1].filename, "caller.py") == 0 &&
                  r.locations[1].line == 3 && r.locations[1].column == 1,
              "%s: frame 1 is %s:%lld:%lld, expected caller.py:3:1", what,
              r.locations[1].filename ? r.locations[1].filename : "(null)",
              (long long)r.locations[1].line, (long long)r.locations[1].column);
    }
    if (r.value) east_value_release(r.value);
    eval_result_free(&r);
}

/* Decode a function-value blob AFTER its encoder-side value is gone, and
 * raise through it: the decoded closure must own a live copy of the map. */
static void check_decoded_closure(const ByteBuffer *blob, EastType *fn_t, const char *what)
{
    EastValue *decoded = east_beast2_decode_full(blob->data, blob->len, fn_t);
    CHECK(decoded && decoded->kind == EAST_VAL_FUNCTION, "%s: decode failed", what);
    if (!decoded) return;
    EastCompiledFn *dfn = decoded->data.function.compiled;
    CHECK(dfn && dfn->source_map, "%s: decoded closure carries no source map", what);
    if (dfn && dfn->source_map) {
        CHECK(dfn->source_map->num_stacks == 3, "%s: decoded map has %zu stacks, expected 3", what,
              dfn->source_map->num_stacks);
        CHECK(dfn->source_map->ref_count == 1,
              "%s: decoded map has %d holders, expected the closure alone", what,
              dfn->source_map->ref_count);
        check_raises_at_authored_site(dfn, what);
    }
    east_value_release(decoded); /* the last holder: frees the map */
}

int main(void)
{
    east_type_of_type_init();
    BuiltinRegistry *builtins = builtin_registry_new();
    east_register_all_builtins(builtins);
    PlatformRegistry *platform = platform_registry_new();
    /* Decoded closures wire themselves to the thread-current registries. */
    east_set_thread_context(platform, builtins);

    /* 1. Decode the program: the IR plus one reference to its source map. */
    EastValue *ir_val = NULL;
    EastSourceMap *sm = NULL;
    IRNode *ir = east_json_decode_ir(PROGRAM_JSON, &ir_val, &sm);
    CHECK(ir != NULL, "east_json_decode_ir returned no IR");
    CHECK(sm != NULL, "east_json_decode_ir returned no source map");
    if (!ir || !sm) {
        printf("GATE FAIL: fixture did not decode\n");
        return 1;
    }
    CHECK(sm->num_stacks == 3, "decoded map has %zu stacks, expected 3", sm->num_stacks);
    CHECK(sm->ref_count == 1, "fresh map has %d holders, expected 1", sm->ref_count);

    /* 2. Compile + unwrap with the map current: the closure takes a reference. */
    east_set_source_map(sm);
    EastCompiledFn *wrapper = east_compile(ir, platform, builtins);
    CHECK(wrapper != NULL, "east_compile failed");
    EvalResult unwrap = east_call(wrapper, NULL, 0);
    east_set_source_map(NULL);
    CHECK(unwrap.status == EVAL_OK && unwrap.value && unwrap.value->kind == EAST_VAL_FUNCTION,
          "unwrapping the Function node did not yield a function value");
    if (unwrap.status != EVAL_OK || !unwrap.value) {
        printf("GATE FAIL: could not build the closure\n");
        return 1;
    }
    EastValue *fn_val = unwrap.value;
    EastCompiledFn *closure = fn_val->data.function.compiled;
    CHECK(closure->source_map == sm, "closure did not snapshot the current map");
    CHECK(sm->ref_count == 2, "after unwrap the map has %d holders, expected 2 (us + closure)",
          sm->ref_count);

    /* 3. Drop everything but the closure: it alone keeps the map alive. */
    east_source_map_release(sm);
    east_compiled_fn_free(wrapper);
    ir_node_release(ir);
    east_value_release(ir_val);
    CHECK(closure->source_map->ref_count == 1,
          "with only the closure left the map has %d holders, expected 1",
          closure->source_map->ref_count);

    /* 4. An error raised through the closure resolves via its own map. */
    check_raises_at_authored_site(closure, "compiled closure");

    /* 5. Export the function VALUE in both containers: the header carries the
     *    map. Free the encoder-side value before decoding, so the only thing
     *    keeping any map alive is the decoded closure itself. */
    EastType *inputs[1] = {&east_integer_type};
    EastType *fn_t = east_function_type(inputs, 1, &east_integer_type);
    ByteBuffer *blob_v5 = east_beast2_encode_full(fn_val, fn_t);
    ByteBuffer *blob_v4 = east_beast2_encode_v4(fn_val, fn_t);
    CHECK(blob_v5 != NULL, "v5 encode of the function value failed");
    CHECK(blob_v4 != NULL, "v4 encode of the function value failed");
    east_value_release(fn_val); /* the last holder of the compile-side map */

    if (blob_v5) {
        check_decoded_closure(blob_v5, fn_t, "v5-decoded closure");
        byte_buffer_free(blob_v5);
    }
    if (blob_v4) {
        check_decoded_closure(blob_v4, fn_t, "v4-decoded closure");
        byte_buffer_free(blob_v4);
    }

    east_type_release(fn_t);
    east_set_thread_context(NULL, NULL);
    east_type_registry_clear();
    platform_registry_free(platform);
    builtin_registry_free(builtins);

    if (failures == 0) {
        printf("GATE PASS: closures own their source map across compile, encode, decode and "
               "free (issue #626)\n");
        return 0;
    }
    printf("GATE FAIL: %d check(s) failed\n", failures);
    return 1;
}
