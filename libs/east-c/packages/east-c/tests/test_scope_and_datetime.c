/*
 * Block scoping (#675) and the epoch-millisecond split (#676).
 *
 * Two east-c defects that produced a wrong ANSWER rather than an error, and
 * in both cases the TypeScript runner was already right — so the same IR gave
 * different results depending on which runtime executed it.
 *
 *   1. A block evaluated its statements in the ENCLOSING environment, so what
 *      it bound leaked. Two blocks binding the same name — the shape a build
 *      with hoisted constants emits, one per exported function — shared one
 *      binding; and because a closure here captures the environment rather
 *      than snapshotting it, even a function created BEFORE the second
 *      binding read the second value. Reachable from ordinary cross-package
 *      code: a build names its constants from a per-process counter, so two
 *      packages exported from two processes both start at `__n0`.
 *
 *   2. `millis_to_tm` split epoch milliseconds with C division, which
 *      truncates toward ZERO. Every pre-1970 datetime decomposed one second
 *      late through the component getters.
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

#define INT "{\"type\":\"Integer\",\"value\":null}"
#define NUL "{\"type\":\"Null\",\"value\":null}"
#define FN0 "{\"type\":\"Function\",\"value\":{\"inputs\":[],\"output\":" INT "}}"

#define IVAR(name)                                                                                 \
    "{\"type\":\"Variable\",\"value\":{\"type\":" INT ",\"loc_id\":\"0\",\"name\":\"" name         \
    "\",\"mutable\":false,\"captured\":false}}"
#define FVAR(name)                                                                                 \
    "{\"type\":\"Variable\",\"value\":{\"type\":" FN0 ",\"loc_id\":\"0\",\"name\":\"" name         \
    "\",\"mutable\":false,\"captured\":false}}"
#define IVALUE(n)                                                                                  \
    "{\"type\":\"Value\",\"value\":{\"type\":" INT ",\"loc_id\":\"0\",\"value\":{\"type\":"        \
    "\"Integer\",\"value\":\"" n "\"}}}"
#define LET(var, val)                                                                              \
    "{\"type\":\"Let\",\"value\":{\"type\":" NUL ",\"loc_id\":\"0\",\"variable\":" var             \
    ",\"value\":" val "}}"
#define CALL(fn)                                                                                   \
    "{\"type\":\"Call\",\"value\":{\"type\":" INT ",\"loc_id\":\"0\",\"function\":" fn             \
    ",\"arguments\":[]}}"
#define ADD(a, b)                                                                                  \
    "{\"type\":\"Builtin\",\"value\":{\"type\":" INT ",\"loc_id\":\"0\",\"builtin\":"              \
    "\"IntegerAdd\",\"type_parameters\":[],\"arguments\":[" a "," b "]}}"

/* Block[ Let c = <n> ; Function() -> c ] — a closure over a block-bound
 * constant, exactly what a hoisted constant compiles to. Both blocks bind the
 * name "c", as two independently exported functions would. */
#define CLOSURE_OVER_C(n)                                                                          \
    "{\"type\":\"Block\",\"value\":{\"type\":" FN0 ",\"loc_id\":\"0\",\"statements\":[" LET(       \
        IVAR("c"), IVALUE(n)) ",{\"type\":\"Function\",\"value\":{\"type\":" FN0                   \
                              ",\"loc_id\":\"0\",\"captures\":[" IVAR(                             \
                                  "c") "],\"parameters\":[],\"body\":" IVAR("c") "}}]}}"

/* () => { const f = <closure over c=1>; const g = <closure over c=2>;
 *         return f() + g() }   ==>  3, on every runtime. */
static const char *TWO_CLOSURES =
    "{\"type\":\"Function\",\"value\":{\"type\":" FN0 ",\"loc_id\":\"0\",\"captures\":[],"
    "\"parameters\":[],\"body\":{\"type\":\"Block\",\"value\":{\"type\":" INT
    ",\"loc_id\":\"0\",\"statements\":[" LET(FVAR("f"), CLOSURE_OVER_C("1")) "," LET(
        FVAR("g"), CLOSURE_OVER_C("2")) "," ADD(CALL(FVAR("f")), CALL(FVAR("g"))) "]}}}}";

/* A block's binding must not outlive it: the inner block binds `x`, and the
 * outer read after it must still see the outer `x`. */
static const char *SHADOWED_BINDING =
    "{\"type\":\"Function\",\"value\":{\"type\":" FN0 ",\"loc_id\":\"0\",\"captures\":[],"
    "\"parameters\":[],\"body\":{\"type\":\"Block\",\"value\":{\"type\":" INT
    ",\"loc_id\":\"0\",\"statements\":[" LET(IVAR("x"), IVALUE("10")) "," LET(
        IVAR("inner"),
        "{\"type\":\"Block\",\"value\":{\"type\":" INT ",\"loc_id\":\"0\",\"statements\":[" LET(
            IVAR("x"), IVALUE("20")) "," IVAR("x") "]}}") "," ADD(IVAR("x"), IVAR("inner")) "]}}}}";

static int64_t run(const char *json, const char *what)
{
    EastValue *ir_val = east_json_decode(json, east_ir_type);
    if (!ir_val) {
        CHECK(false, "%s: decode failed", what);
        return -1;
    }
    IRNode *ir = east_ir_from_value(ir_val);
    if (!ir || ir->kind != IR_FUNCTION) {
        CHECK(false, "%s: expected a Function node", what);
        if (ir) ir_node_release(ir);
        east_value_release(ir_val);
        return -1;
    }
    /* The compiled function IS the body; the Function node itself would
     * evaluate to a function value (the compliance runner does the same). */
    IRNode *body = ir->data.function.body;

    BuiltinRegistry *builtins = builtin_registry_new();
    east_register_all_builtins(builtins);
    PlatformRegistry *platform = platform_registry_new();

    char *err = NULL;
    EastCompiledFn *fn = east_compile_checked(body, platform, builtins, &err);
    int64_t out = -1;
    if (!fn) {
        CHECK(false, "%s: compile failed: %s", what, err ? err : "(no message)");
    } else {
        EvalResult r = east_call(fn, NULL, 0);
        if (r.status != EVAL_OK || !r.value || r.value->kind != EAST_VAL_INTEGER) {
            CHECK(false, "%s: run failed (status=%d, kind=%d): %s", what, (int)r.status,
                  r.value ? (int)r.value->kind : -1,
                  r.error_message ? r.error_message : "(no message)");
        } else {
            out = r.value->data.integer;
        }
        if (r.value) east_value_release(r.value);
        eval_result_free(&r);
        east_compiled_fn_free(fn);
    }
    free(err);
    platform_registry_release(platform);
    builtin_registry_free(builtins);
    ir_node_release(ir);
    east_value_release(ir_val);
    return out;
}

static void test_block_scoping(void)
{
    /* Pre-fix this was 4: the second `Let c` overwrote the first in the
     * shared environment, and BOTH closures read it. */
    int64_t both = run(TWO_CLOSURES, "two closures over same-named block constants");
    CHECK(both == 3, "two closures over c=1 and c=2 summed to %lld, expected 3", (long long)both);

    /* 20 (inner) + 10 (outer, unshadowed after the inner block ends) */
    int64_t shadow = run(SHADOWED_BINDING, "inner block shadows an outer binding");
    CHECK(shadow == 30, "shadowed binding gave %lld, expected 30", (long long)shadow);
}

/* The component getters against the correct UTC decomposition — what
 * `new Date(ms)` gives on the TypeScript runner. */
static void test_epoch_millis_split(void)
{
    static const struct {
        int64_t ms;
        int64_t year, month, day, hour, min, sec, milli;
    } cases[] = {
        {-1, 1969, 12, 31, 23, 59, 59, 999},
        {-500, 1969, 12, 31, 23, 59, 59, 500},
        {-1500, 1969, 12, 31, 23, 59, 58, 500},
        {-1000, 1969, 12, 31, 23, 59, 59, 0},
        {-86400001, 1969, 12, 30, 23, 59, 59, 999},
        {0, 1970, 1, 1, 0, 0, 0, 0},
        {1500, 1970, 1, 1, 0, 0, 1, 500},
    };
    static const char *const getters[] = {
        "DateTimeGetYear",   "DateTimeGetMonth",  "DateTimeGetDayOfMonth", "DateTimeGetHour",
        "DateTimeGetMinute", "DateTimeGetSecond", "DateTimeGetMillisecond",
    };

    BuiltinRegistry *builtins = builtin_registry_new();
    east_register_all_builtins(builtins);

    for (size_t c = 0; c < sizeof(cases) / sizeof(cases[0]); c++) {
        const int64_t want[7] = {cases[c].year, cases[c].month, cases[c].day,  cases[c].hour,
                                 cases[c].min,  cases[c].sec,   cases[c].milli};
        EastValue *dt = east_datetime(cases[c].ms);
        for (size_t g = 0; g < 7; g++) {
            BuiltinImpl impl = builtin_registry_get(builtins, getters[g], NULL, 0);
            if (!impl) {
                CHECK(false, "builtin %s not registered", getters[g]);
                continue;
            }
            EastValue *args[1] = {dt};
            EastValue *got = impl(args, 1);
            CHECK(got && got->kind == EAST_VAL_INTEGER && got->data.integer == want[g],
                  "ms=%lld %s gave %lld, expected %lld", (long long)cases[c].ms, getters[g],
                  got && got->kind == EAST_VAL_INTEGER ? (long long)got->data.integer : -1,
                  (long long)want[g]);
            if (got) east_value_release(got);
        }
        east_value_release(dt);
    }
    builtin_registry_free(builtins);
}

int main(void)
{
    east_type_of_type_init();

    test_block_scoping();
    test_epoch_millis_split();

    if (failures > 0) {
        fprintf(stderr, "%d failure(s)\n", failures);
        return 1;
    }
    printf("scope and datetime gate: all checks passed\n");
    return 0;
}
