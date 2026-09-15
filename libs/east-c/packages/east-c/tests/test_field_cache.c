/*
 * Field-read inline cache gate.
 *
 * A GetField node remembers the struct type it last read a value of and the
 * field's index in that type, so the next value that borrows its names from
 * the same type is read by index instead of a name scan. Two things must
 * hold for that to be safe, and this gate pins both:
 *
 *   - a value carrying its OWN field names (a coerced struct whose field
 *     order differs from the type's) never hits the cache, even when it is
 *     stamped with the same type — its layout is not the type's;
 *   - a value stamped with a recursive wrapper reads through the cache like
 *     any other, since the wrapper pointer is the key.
 *
 * Run under ASan/LSan for the type and value lifetimes it exercises.
 */
#include <east/east.h>
#include <east/compiler.h>
#include <east/type_of_type.h>

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static int failures = 0;

#define CHECK(cond, ...)                                                                           \
    do {                                                                                           \
        if (!(cond)) {                                                                             \
            fprintf(stderr, "FAIL %s:%d: ", __FILE__, __LINE__);                                   \
            fprintf(stderr, __VA_ARGS__);                                                          \
            fprintf(stderr, "\n");                                                                 \
            failures++;                                                                            \
        }                                                                                          \
    } while (0)

/* Call `fn` with one struct argument and return the Integer it yields. */
static int64_t read_field(EastCompiledFn *fn, EastValue *arg, const char *what)
{
    EastValue *args[1] = {arg};
    EvalResult r = east_call(fn, args, 1);
    int64_t out = -1;
    if (r.status != EVAL_OK || !r.value || r.value->kind != EAST_VAL_INTEGER) {
        CHECK(false, "%s: run failed (status=%d): %s", what, (int)r.status,
              r.error_message ? r.error_message : "(no message)");
    } else {
        out = r.value->data.integer;
    }
    if (r.value) east_value_release(r.value);
    eval_result_free(&r);
    return out;
}

/* (s) => s.<field>, built from IR builders against `stype`. The GetField node
 * is handed back so the cache state can be inspected. */
static EastCompiledFn *compile_reader(EastType *stype, const char *field, IRNode **get_field_out,
                                      IRNode **fn_node_out, BuiltinRegistry *builtins,
                                      PlatformRegistry *platform)
{
    IRNode *var = ir_variable(stype, "s", false, false);
    IRNode *get = ir_get_field(&east_integer_type, var, field);
    IRVariable param = {.name = "s", .mutable = false, .captured = false, .loc_id = 0};
    EastType *inputs[1] = {stype};
    EastType *fn_type = east_function_type(inputs, 1, &east_integer_type);
    IRNode *fn_node = ir_function(fn_type, NULL, 0, &param, 1, get);
    /* The function node retains its body and the body its operand; the
     * constructors' own references are dropped here. */
    ir_node_release(var);
    ir_node_release(get);
    ir_resolve_scopes(fn_node);
    EastCompiledFn *fn = east_compile_fn(fn_node, platform, builtins, NULL);
    *get_field_out = get; /* borrowed: the function node retains it */
    *fn_node_out = fn_node;
    return fn;
}

static void test_coerced_struct_bypasses_cache(BuiltinRegistry *builtins,
                                               PlatformRegistry *platform)
{
    const char *names[2] = {"a", "b"};
    EastType *types[2] = {&east_integer_type, &east_integer_type};
    EastType *stype = east_struct_type(names, types, 2);

    IRNode *get = NULL, *fn_node = NULL;
    EastCompiledFn *fn = compile_reader(stype, "b", &get, &fn_node, builtins, platform);
    CHECK(fn != NULL, "coerced: compile failed");
    if (!fn) return;

    /* Names in the type's order: the value borrows them (no copies). */
    EastValue *v1 = east_integer(1), *v2 = east_integer(2);
    EastValue *vals[2] = {v1, v2};
    EastValue *borrowed = east_struct_new(names, vals, 2, stype);
    CHECK(borrowed->data.struct_.field_names == NULL, "coerced: in-order value borrows its names");

    /* Names in the OTHER order with the same type: the value keeps its own
     * copies, and `b` is at index 0 here. */
    const char *swapped[2] = {"b", "a"};
    EastValue *v20 = east_integer(20), *v10 = east_integer(10);
    EastValue *swapped_vals[2] = {v20, v10};
    EastValue *own = east_struct_new(swapped, swapped_vals, 2, stype);
    CHECK(own->data.struct_.field_names != NULL, "coerced: out-of-order value copies its names");

    CHECK(get->data.get_field.cache_type == NULL, "coerced: cache starts empty");
    CHECK(read_field(fn, borrowed, "coerced: first read") == 2,
          "coerced: s.b of the in-order value");
    CHECK(get->data.get_field.cache_type == stype && get->data.get_field.cache_idx == 1,
          "coerced: the first read fills the cache with (type, 1)");
    CHECK(read_field(fn, own, "coerced: own-order read") == 20,
          "coerced: s.b of the out-of-order value must come from its own names, not the cache");
    CHECK(get->data.get_field.cache_type == stype && get->data.get_field.cache_idx == 1,
          "coerced: an own-names value leaves the cache alone");
    CHECK(read_field(fn, borrowed, "coerced: cached read") == 2, "coerced: the cached read");

    east_value_release(borrowed);
    east_value_release(own);
    east_value_release(v1);
    east_value_release(v2);
    east_value_release(v10);
    east_value_release(v20);
    east_compiled_fn_free(fn);
    ir_node_release(fn_node);
}

static void test_recursive_wrapper_hits_cache(BuiltinRegistry *builtins, PlatformRegistry *platform)
{
    /* R = Recursive(Struct { v: Integer, next: R }) */
    EastType *rec = east_recursive_type_new();
    const char *names[2] = {"v", "next"};
    EastType *types[2] = {&east_integer_type, rec};
    EastType *inner = east_struct_type(names, types, 2);
    east_recursive_type_set(rec, inner);

    IRNode *get = NULL, *fn_node = NULL;
    EastCompiledFn *fn = compile_reader(rec, "v", &get, &fn_node, builtins, platform);
    CHECK(fn != NULL, "recursive: compile failed");
    if (!fn) return;

    EastValue *seven = east_integer(7), *nine = east_integer(9);
    EastValue *vals1[2] = {seven, east_null()};
    EastValue *vals2[2] = {nine, east_null()};
    /* Stamped with the wrapper: names borrow through it to the inner struct. */
    EastValue *first = east_struct_new(names, vals1, 2, rec);
    EastValue *second = east_struct_new(names, vals2, 2, rec);
    CHECK(first->data.struct_.field_names == NULL,
          "recursive: value borrows names via the wrapper");

    CHECK(read_field(fn, first, "recursive: first read") == 7, "recursive: s.v of the first value");
    CHECK(get->data.get_field.cache_type == rec && get->data.get_field.cache_idx == 0,
          "recursive: the cache keys on the wrapper pointer");
    CHECK(read_field(fn, second, "recursive: cached read") == 9,
          "recursive: the second value reads through the cache");

    east_value_release(first);
    east_value_release(second);
    east_value_release(seven);
    east_value_release(nine);
    east_compiled_fn_free(fn);
    ir_node_release(fn_node);
}

int main(void)
{
    east_type_of_type_init();
    BuiltinRegistry *builtins = builtin_registry_new();
    east_register_all_builtins(builtins);
    PlatformRegistry *platform = platform_registry_new();

    test_coerced_struct_bypasses_cache(builtins, platform);
    test_recursive_wrapper_hits_cache(builtins, platform);

    platform_registry_release(platform);
    builtin_registry_free(builtins);
    east_type_registry_clear();

    if (failures > 0) {
        fprintf(stderr, "%d failure(s)\n", failures);
        return 1;
    }
    printf("field cache gate: all checks passed\n");
    return 0;
}
