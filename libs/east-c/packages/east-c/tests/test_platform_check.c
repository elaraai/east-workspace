/*
 * Cross-backend compliance test for the platform-signature check
 * (east_compile_checked): compiles TypeScript-exported IR against a
 * deliberately drifted typed platform registration and asserts the compile
 * error message is byte-identical to the TS analyzer's (captured into the
 * sibling .error.txt fixture by libs/east/test/platform_check.spec.ts).
 *
 * Usage: test_platform_check [fixture-dir]   (default /tmp/east-test-ir/platform_check)
 *
 * Exits 77 (ctest SKIP) when the fixture dir is absent — run
 * `make test-export` at the workspace root first.
 */

#include <east/east.h>
#include <east/eval_result.h>
#include <east/type_of_type.h>

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define SKIP_EXIT_CODE 77

static char *read_file(const char *path)
{
    FILE *f = fopen(path, "rb");
    if (!f) return NULL;
    fseek(f, 0, SEEK_END);
    long len = ftell(f);
    fseek(f, 0, SEEK_SET);
    char *buf = malloc((size_t)len + 1);
    if (!buf) {
        fclose(f);
        return NULL;
    }
    size_t n = fread(buf, 1, (size_t)len, f);
    buf[n] = '\0';
    fclose(f);
    return buf;
}

static void trim_trailing_ws(char *s)
{
    size_t n = strlen(s);
    while (n > 0 && (s[n - 1] == '\n' || s[n - 1] == '\r' || s[n - 1] == ' '))
        s[--n] = '\0';
}

/* Decode an exported {ir, source_map} wrapper and return the top-level
 * function's body IR (retained). */
static IRNode *load_ir_body(const char *json_path)
{
    char *json = read_file(json_path);
    if (!json) {
        fprintf(stderr, "Cannot open fixture: %s\n", json_path);
        return NULL;
    }

    EastType *loc_struct = east_struct_type(
        (const char *[]){"filename", "line", "column"},
        (EastType *[]){&east_string_type, &east_integer_type, &east_integer_type}, 3);
    EastType *loc_arr = east_array_type(loc_struct);
    EastType *stacks_arr = east_array_type(loc_arr);
    EastType *sm_type = east_struct_type((const char *[]){"stacks"}, (EastType *[]){stacks_arr}, 1);
    EastType *wrapper_type = east_struct_type((const char *[]){"ir", "source_map"},
                                              (EastType *[]){east_ir_type, sm_type}, 2);

    EastValue *wrapper_val = east_json_decode(json, wrapper_type);
    free(json);
    east_type_release(loc_struct);
    east_type_release(loc_arr);
    east_type_release(stacks_arr);
    east_type_release(sm_type);
    east_type_release(wrapper_type);

    if (!wrapper_val) {
        fprintf(stderr, "Failed to decode fixture JSON: %s\n", json_path);
        return NULL;
    }

    /* Struct fields sorted alphabetically: ir=0, source_map=1 */
    EastValue *ir_val = east_struct_get_field_idx(wrapper_val, 0);
    IRNode *ir = east_ir_from_value(ir_val);
    east_value_release(wrapper_val);
    if (!ir) {
        fprintf(stderr, "Failed to convert IR value: %s\n", json_path);
        return NULL;
    }

    IRNode *body = ir;
    if (ir->kind == IR_FUNCTION || ir->kind == IR_ASYNC_FUNCTION) {
        body = ir->data.function.body;
    }
    ir_node_retain(body);
    ir_node_release(ir);
    return body;
}

static EvalResult plat_dummy(EastValue **args, size_t num_args, EastType **input_types,
                             size_t num_input_types, EastType *output_type)
{
    (void)args;
    (void)num_args;
    (void)input_types;
    (void)num_input_types;
    (void)output_type;
    return eval_ok(east_integer(0));
}

/* One fixture case: the registered (drifted) signature and whether a compile
 * error is expected. Registered types are built in run_case; the IR-side
 * declaration lives in the exported fixture. Must stay in lockstep with
 * libs/east/test/platform_check.spec.ts and east-py tests/test_platform_check.py. */
typedef struct {
    const char *name;
    bool expect_error;
} CheckCase;

static const CheckCase CASES[] = {
    {"arg_count", true},
    {"input_type", true},
    {"return_type", true},
    {"match", false},
};

/* Build the drifted registration for a case. Returns the number of input
 * types written to `inputs` (capacity 2) and sets *output. */
static size_t registered_types(const char *case_name, EastType **inputs, EastType **output)
{
    if (strcmp(case_name, "arg_count") == 0) {
        inputs[0] = &east_integer_type;
        inputs[1] = &east_integer_type;
        *output = &east_integer_type;
        return 2;
    }
    if (strcmp(case_name, "input_type") == 0) {
        inputs[0] = east_array_type(&east_float_type);
        *output = &east_integer_type;
        return 1;
    }
    if (strcmp(case_name, "return_type") == 0) {
        inputs[0] = &east_integer_type;
        *output = east_struct_type((const char *[]){"a"}, (EastType *[]){&east_integer_type}, 1);
        return 1;
    }
    /* match */
    inputs[0] = &east_integer_type;
    *output = &east_integer_type;
    return 1;
}

static int run_case(const char *dir, const CheckCase *c)
{
    char path[1024];
    snprintf(path, sizeof(path), "%s/%s.json", dir, c->name);
    IRNode *body = load_ir_body(path);
    if (!body) return 1;

    EastType *inputs[2] = {NULL, NULL};
    EastType *output = NULL;
    size_t num_inputs = registered_types(c->name, inputs, &output);

    BuiltinRegistry *builtins = builtin_registry_new();
    east_register_all_builtins(builtins);
    PlatformRegistry *platform = platform_registry_new();
    platform_registry_add_typed(platform, "compliance.check", plat_dummy, false, inputs, num_inputs,
                                output);

    /* The registry retained the types; drop the constructed ones. */
    for (size_t i = 0; i < num_inputs; i++)
        east_type_release(inputs[i]);
    east_type_release(output);

    char *err = NULL;
    EastCompiledFn *fn = east_compile_checked(body, platform, builtins, &err);

    int failed = 0;
    if (c->expect_error) {
        snprintf(path, sizeof(path), "%s/%s.error.txt", dir, c->name);
        char *expected = read_file(path);
        if (!expected) {
            fprintf(stderr, "[x] %s: missing expected-error fixture %s\n", c->name, path);
            failed = 1;
        } else {
            trim_trailing_ws(expected);
            if (fn || !err) {
                fprintf(stderr, "[x] %s: expected compile error, got %s\n", c->name,
                        fn ? "successful compile" : "NULL without message");
                failed = 1;
            } else if (strcmp(err, expected) != 0) {
                fprintf(stderr, "[x] %s: error message mismatch\n  expected: %s\n  actual:   %s\n",
                        c->name, expected, err);
                failed = 1;
            } else {
                printf("[+] %s: identical error: %s\n", c->name, err);
            }
            free(expected);
        }
    } else {
        if (!fn) {
            fprintf(stderr, "[x] %s: expected successful compile, got error: %s\n", c->name,
                    err ? err : "(no message)");
            failed = 1;
        } else {
            printf("[+] %s: compiled clean with matching typed registration\n", c->name);
        }
    }

    free(err);
    if (fn) east_compiled_fn_free(fn);
    platform_registry_free(platform);
    builtin_registry_free(builtins);
    ir_node_release(body);
    return failed;
}

int main(int argc, char **argv)
{
    const char *dir = argc > 1 ? argv[1] : "/tmp/east-test-ir/platform_check";

    char probe[1024];
    snprintf(probe, sizeof(probe), "%s/match.json", dir);
    FILE *f = fopen(probe, "rb");
    if (!f) {
        printf("SKIP: no fixtures at %s (run `make test-export` at the workspace root)\n", dir);
        return SKIP_EXIT_CODE;
    }
    fclose(f);

    east_type_of_type_init();

    int failures = 0;
    for (size_t i = 0; i < sizeof(CASES) / sizeof(CASES[0]); i++)
        failures += run_case(dir, &CASES[i]);

    if (failures) {
        fprintf(stderr, "platform_check: %d case(s) failed\n", failures);
        return 1;
    }
    printf("platform_check: all cases passed\n");
    return 0;
}
