/*
 * Static name resolution gate.
 *
 * ir_resolve_scopes annotates every Variable, Let and Assign with the frame
 * and cell its name binds to, and the evaluator reads that cell instead of
 * hashing the name. The contract is that the answer never changes: a
 * resolved read is verified against the live frame and falls back to the
 * by-name walk on any mismatch. So every program below runs twice — with
 * resolution on and with EAST_C_NO_SLOT_RESOLVE=1 — and both must give the
 * expected value. The shapes are the ones where a naive resolver would
 * diverge from the by-name semantics the TypeScript runner defines:
 *
 *   - a read before the Let that shadows it sees the outer binding;
 *   - an Assign inside a closure is visible outside, and vice versa;
 *   - a loop body's closure captures that iteration's frame;
 *   - match and catch binders live in their own frame;
 *   - a capture bound from outside by name (a decoded closure, a host) is
 *     found although the resolver never saw it;
 *   - a function compiled from a bare body (east_compile_checked) binds its
 *     params by name and still reads them;
 *   - a scoped frame takes a by-name set into its cell, and a name outside
 *     its scope into the overflow map.
 *
 * Run under ASan/LSan: frames retain their scope, and a scope outlives the
 * IR that opened it through a closure's captured frames.
 */
#include <east/east.h>
#include <east/compiler.h>
#include <east/env.h>
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

/* ----- IR JSON building blocks (the east_ir_type wire shape) ----- */

#define INT "{\"type\":\"Integer\",\"value\":null}"
#define STR "{\"type\":\"String\",\"value\":null}"
#define NUL "{\"type\":\"Null\",\"value\":null}"
#define ARR_INT "{\"type\":\"Array\",\"value\":" INT "}"
#define OPT_INT                                                                                    \
    "{\"type\":\"Variant\",\"value\":[{\"name\":\"none\",\"type\":" NUL                            \
    "},{\"name\":\"some\",\"type\":" INT "}]}"
#define FN0 "{\"type\":\"Function\",\"value\":{\"inputs\":[],\"output\":" INT "}}"
#define FN2 "{\"type\":\"Function\",\"value\":{\"inputs\":[" INT "," INT "],\"output\":" INT "}}"

#define VAR(ty, name, mut)                                                                         \
    "{\"type\":\"Variable\",\"value\":{\"type\":" ty ",\"loc_id\":\"0\",\"name\":\"" name          \
    "\",\"mutable\":" mut ",\"captured\":false}}"
#define IVAR(n) VAR(INT, n, "false")
#define MVAR(n) VAR(INT, n, "true")
#define FVAR(n) VAR(FN0, n, "false")
#define IVALUE(n)                                                                                  \
    "{\"type\":\"Value\",\"value\":{\"type\":" INT ",\"loc_id\":\"0\",\"value\":{\"type\":"        \
    "\"Integer\",\"value\":\"" n "\"}}}"
#define SVALUE(s)                                                                                  \
    "{\"type\":\"Value\",\"value\":{\"type\":" STR ",\"loc_id\":\"0\",\"value\":{\"type\":"        \
    "\"String\",\"value\":\"" s "\"}}}"
#define NULLVALUE                                                                                  \
    "{\"type\":\"Value\",\"value\":{\"type\":" NUL ",\"loc_id\":\"0\",\"value\":{\"type\":"        \
    "\"Null\",\"value\":null}}}"
#define LET(var, val)                                                                              \
    "{\"type\":\"Let\",\"value\":{\"type\":" NUL ",\"loc_id\":\"0\",\"variable\":" var             \
    ",\"value\":" val "}}"
#define ASSIGN(var, val)                                                                           \
    "{\"type\":\"Assign\",\"value\":{\"type\":" NUL ",\"loc_id\":\"0\",\"variable\":" var          \
    ",\"value\":" val "}}"
#define BLOCK(ty, stmts)                                                                           \
    "{\"type\":\"Block\",\"value\":{\"type\":" ty ",\"loc_id\":\"0\",\"statements\":[" stmts "]}}"
#define CALL0(fn)                                                                                  \
    "{\"type\":\"Call\",\"value\":{\"type\":" INT ",\"loc_id\":\"0\",\"function\":" fn             \
    ",\"arguments\":[]}}"
#define ADD(a, b)                                                                                  \
    "{\"type\":\"Builtin\",\"value\":{\"type\":" INT ",\"loc_id\":\"0\",\"builtin\":"              \
    "\"IntegerAdd\",\"type_parameters\":[],\"arguments\":[" a "," b "]}}"
#define STRLEN(s)                                                                                  \
    "{\"type\":\"Builtin\",\"value\":{\"type\":" INT ",\"loc_id\":\"0\",\"builtin\":"              \
    "\"StringLength\",\"type_parameters\":[],\"arguments\":[" s "]}}"
#define FUNC0(caps, body)                                                                          \
    "{\"type\":\"Function\",\"value\":{\"type\":" FN0 ",\"loc_id\":\"0\",\"captures\":[" caps      \
    "],\"parameters\":[],\"body\":" body "}}"
#define FUNC2(body)                                                                                \
    "{\"type\":\"Function\",\"value\":{\"type\":" FN2 ",\"loc_id\":\"0\",\"captures\":[],"         \
    "\"parameters\":[" IVAR("a") "," IVAR("b") "],\"body\":" body "}}"
#define LABEL "{\"name\":\"\",\"loc_id\":\"0\"}"
#define FOR_ARRAY(arr, idx, val, body)                                                             \
    "{\"type\":\"ForArray\",\"value\":{\"type\":" NUL ",\"loc_id\":\"0\",\"array\":" arr           \
    ",\"label\":" LABEL ",\"key\":" idx ",\"value\":" val ",\"body\":" body "}}"
#define NEW_ARRAY(items)                                                                           \
    "{\"type\":\"NewArray\",\"value\":{\"type\":" ARR_INT ",\"loc_id\":\"0\",\"values\":[" items   \
    "]}}"
#define SOME(v)                                                                                    \
    "{\"type\":\"Variant\",\"value\":{\"type\":" OPT_INT ",\"loc_id\":\"0\",\"case\":\"some\","    \
    "\"value\":" v "}}"
#define MATCH(expr, cases)                                                                         \
    "{\"type\":\"Match\",\"value\":{\"type\":" INT ",\"loc_id\":\"0\",\"variant\":" expr           \
    ",\"cases\":[" cases "]}}"
#define CASE(name, var, body) "{\"case\":\"" name "\",\"variable\":" var ",\"body\":" body "}"
#define TRY(try_b, msg, stack, catch_b)                                                            \
    "{\"type\":\"TryCatch\",\"value\":{\"type\":" INT ",\"loc_id\":\"0\",\"try_body\":" try_b      \
    ",\"catch_body\":" catch_b ",\"message\":" msg ",\"stack\":" stack                             \
    ",\"finally_body\":" NULLVALUE "}}"
#define ERROR(msg)                                                                                 \
    "{\"type\":\"Error\",\"value\":{\"type\":" INT ",\"loc_id\":\"0\",\"message\":" msg "}}"

/* () => { let x = 10; let y = { let t = x; let x = 20; t + x }; y + x }
 * The inner `t = x` runs before the inner `let x`, so it reads the OUTER x:
 * 10 + 20 = 30, then 30 + 10 = 40. */
static const char *USE_BEFORE_LET = FUNC0(
    "",
    BLOCK(INT, LET(IVAR("x"), IVALUE("10")) "," LET(
                   IVAR("y"),
                   BLOCK(INT, LET(IVAR("t"), IVAR("x")) "," LET(IVAR("x"), IVALUE("20")) "," ADD(
                                  IVAR("t"), IVAR("x")))) "," ADD(IVAR("y"), IVAR("x"))));

/* () => { let c = 1; let f = () => { c = c + 10; c }; f(); f(); c + f() }
 * The closure's assignment is visible outside and the outer read happens
 * before the third call: 21 + 31 = 52. */
static const char *CLOSURE_ASSIGN = FUNC0(
    "",
    BLOCK(
        INT,
        LET(MVAR("c"), IVALUE("1")) "," LET(
            FVAR("f"),
            FUNC0(MVAR("c"),
                  BLOCK(INT,
                        ASSIGN(MVAR("c"), ADD(MVAR("c"), IVALUE("10"))) "," MVAR(
                            "c")))) "," CALL0(FVAR("f")) "," CALL0(FVAR("f")) "," ADD(MVAR("c"),
                                                                                      CALL0(FVAR(
                                                                                          "f")))));

/* () => { let acc = 0; for x in [1,2,3] { let g = () => x; acc = acc + g() }; acc }
 * Each iteration's closure captures that iteration's frame: 6. */
static const char *LOOP_CLOSURES = FUNC0(
    "",
    BLOCK(INT,
          LET(MVAR("acc"), IVALUE("0")) "," FOR_ARRAY(
              NEW_ARRAY(IVALUE("1") "," IVALUE("2") "," IVALUE("3")), IVAR("i"), IVAR("x"),
              BLOCK(NUL, LET(FVAR("g"), FUNC0(IVAR("x"), IVAR("x"))) "," ASSIGN(
                             MVAR("acc"), ADD(MVAR("acc"), CALL0(FVAR("g")))))) "," MVAR("acc")));

/* () => match some(5) { none(_) => 0, some(v) => v + 1 }  ==>  6 */
static const char *MATCH_BIND =
    FUNC0("", MATCH(SOME(IVALUE("5")), CASE("none", VAR(NUL, "_", "false"), IVALUE("0")) "," CASE(
                                           "some", IVAR("v"), ADD(IVAR("v"), IVALUE("1")))));

/* () => try { error("boom") } catch (m, st) { m.length + 100 }  ==>  104 */
static const char *CATCH_BIND =
    FUNC0("", TRY(ERROR(SVALUE("boom")), VAR(STR, "m", "false"), VAR(ARR_INT, "st", "false"),
                  ADD(STRLEN(VAR(STR, "m", "false")), IVALUE("100"))));

/* () => k + 1, with k never bound in the IR: a host binds it by name. */
static const char *DYNAMIC_CAPTURE = FUNC0("", ADD(IVAR("k"), IVALUE("1")));

/* (a, b) => a + b */
static const char *TWO_PARAMS = FUNC2(ADD(IVAR("a"), IVAR("b")));

/* ----- harness ----- */

static void set_resolution(bool on)
{
#ifdef _WIN32
    _putenv_s("EAST_C_NO_SLOT_RESOLVE", on ? "" : "1");
#else
    if (on)
        unsetenv("EAST_C_NO_SLOT_RESOLVE");
    else
        setenv("EAST_C_NO_SLOT_RESOLVE", "1", 1);
#endif
}

static IRNode *decode(const char *json, const char *what)
{
    EastValue *ir_val = east_json_decode(json, east_ir_type);
    if (!ir_val) {
        CHECK(false, "%s: decode failed", what);
        return NULL;
    }
    IRNode *ir = east_ir_from_value(ir_val);
    east_value_release(ir_val);
    if (!ir || ir->kind != IR_FUNCTION) {
        CHECK(false, "%s: expected a Function node", what);
        if (ir) ir_node_release(ir);
        return NULL;
    }
    return ir;
}

static int64_t call_int(EastCompiledFn *fn, EastValue **args, size_t n, const char *what)
{
    int64_t out = -1;
    EvalResult r = east_call(fn, args, n);
    if (r.status != EVAL_OK || !r.value || r.value->kind != EAST_VAL_INTEGER) {
        CHECK(false, "%s: run failed (status=%d, kind=%d): %s", what, (int)r.status,
              r.value ? (int)r.value->kind : -1,
              r.error_message ? r.error_message : "(no message)");
    } else {
        out = r.value->data.integer;
    }
    if (r.value) east_value_release(r.value);
    eval_result_free(&r);
    return out;
}

/* Decode, compile the Function node, call it with no arguments. */
static int64_t run(const char *json, const char *what)
{
    IRNode *ir = decode(json, what);
    if (!ir) return -1;

    BuiltinRegistry *builtins = builtin_registry_new();
    east_register_all_builtins(builtins);
    PlatformRegistry *platform = platform_registry_new();

    char *err = NULL;
    EastCompiledFn *fn = east_compile_fn(ir, platform, builtins, &err);
    int64_t out = -1;
    if (!fn) {
        CHECK(false, "%s: compile failed: %s", what, err ? err : "(no message)");
    } else {
        out = call_int(fn, NULL, 0, what);
        east_compiled_fn_free(fn);
    }
    free(err);
    platform_registry_release(platform);
    builtin_registry_free(builtins);
    ir_node_release(ir);
    return out;
}

static void expect(const char *json, int64_t want, const char *what, bool resolved)
{
    int64_t got = run(json, what);
    CHECK(got == want, "%s (resolution %s) gave %lld, expected %lld", what, resolved ? "on" : "off",
          (long long)got, (long long)want);
}

/* A capture the resolver never saw, bound into the captures frame by name
 * (the beast2 closure decoder and the east-py bridge do exactly this). */
static void test_dynamic_capture(bool resolved)
{
    IRNode *ir = decode(DYNAMIC_CAPTURE, "dynamic capture");
    if (!ir) return;
    /* With resolution on, `k` must have stayed unresolved: nothing in the
     * static chain binds it. */
    IRNode *add = ir->data.function.body;
    CHECK(add->kind == IR_BUILTIN, "dynamic capture: body is a builtin");
    IRNode *k = add->data.builtin.args[0];
    CHECK(k->kind == IR_VARIABLE && k->data.variable.scope == NULL,
          "dynamic capture: `k` must be unresolved (scope=%p)", (void *)k->data.variable.scope);

    BuiltinRegistry *builtins = builtin_registry_new();
    east_register_all_builtins(builtins);
    PlatformRegistry *platform = platform_registry_new();
    char *err = NULL;
    EastCompiledFn *fn = east_compile_fn(ir, platform, builtins, &err);
    if (fn) {
        EastValue *five = east_integer(5);
        env_set(fn->captures, "k", five);
        east_value_release(five);
        int64_t got = call_int(fn, NULL, 0, "dynamic capture");
        CHECK(got == 6, "dynamic capture (resolution %s) gave %lld, expected 6",
              resolved ? "on" : "off", (long long)got);
        east_compiled_fn_free(fn);
    } else {
        CHECK(false, "dynamic capture: compile failed: %s", err ? err : "(no message)");
    }
    free(err);
    platform_registry_release(platform);
    builtin_registry_free(builtins);
    ir_node_release(ir);
}

/* The two compile entries: east_compile_fn binds params into their resolved
 * cells; east_compile_checked on the bare body binds them by name, and the
 * resolved reads inside the body must fall back to that. */
static void test_params(bool resolved)
{
    IRNode *ir = decode(TWO_PARAMS, "two params");
    if (!ir) return;
    IRNode *add = ir->data.function.body;
    IRNode *a = add->data.builtin.args[0];
    if (resolved) {
        CHECK(a->kind == IR_VARIABLE && a->data.variable.scope == ir->data.function.scope &&
                  a->data.variable.hops == 0 && a->data.variable.slot == 0,
              "two params: `a` must resolve to the params frame, cell 0");
        CHECK(ir->data.function.scope && ir->data.function.scope->count == 2,
              "two params: the params scope holds two cells");
    } else {
        CHECK(a->kind == IR_VARIABLE && a->data.variable.scope == NULL,
              "two params: `a` must be unresolved with resolution off");
    }

    BuiltinRegistry *builtins = builtin_registry_new();
    east_register_all_builtins(builtins);
    PlatformRegistry *platform = platform_registry_new();
    EastValue *args[2] = {east_integer(2), east_integer(3)};

    char *err = NULL;
    EastCompiledFn *fn = east_compile_fn(ir, platform, builtins, &err);
    if (fn) {
        int64_t got = call_int(fn, args, 2, "two params (compile_fn)");
        CHECK(got == 5, "two params via east_compile_fn (resolution %s) gave %lld, expected 5",
              resolved ? "on" : "off", (long long)got);
        east_compiled_fn_free(fn);
    } else {
        CHECK(false, "two params: east_compile_fn failed: %s", err ? err : "(no message)");
    }
    free(err);

    err = NULL;
    EastCompiledFn *legacy = east_compile_checked(ir->data.function.body, platform, builtins, &err);
    if (legacy) {
        legacy->num_params = 2;
        legacy->param_names = calloc(2, sizeof(char *));
        legacy->param_names[0] = strdup("a");
        legacy->param_names[1] = strdup("b");
        int64_t got = call_int(legacy, args, 2, "two params (compile_checked)");
        CHECK(got == 5, "two params via east_compile_checked (resolution %s) gave %lld, expected 5",
              resolved ? "on" : "off", (long long)got);
        east_compiled_fn_free(legacy);
    } else {
        CHECK(false, "two params: east_compile_checked failed: %s", err ? err : "(no message)");
    }
    free(err);

    east_value_release(args[0]);
    east_value_release(args[1]);
    platform_registry_release(platform);
    builtin_registry_free(builtins);
    ir_node_release(ir);
}

/* The frame API itself: a by-name set into a scoped frame lands in the cell
 * when the name is in scope and in the overflow map otherwise; lookups and
 * updates through a child frame see both. */
static void test_frame_api(void)
{
    IRScope *scope = ir_scope_new();
    CHECK(ir_scope_push(scope, "a") == 0, "scope: first push is cell 0");
    CHECK(ir_scope_push(scope, "b") == 1, "scope: second push is cell 1");
    CHECK(ir_scope_bind(scope, "a") == 0, "scope: bind of a bound name reuses its cell");
    CHECK(ir_scope_bind(scope, "c") == 2, "scope: bind of a new name appends");
    CHECK(ir_scope_push(scope, "a") == 3 && ir_scope_find(scope, "a") == 3,
          "scope: a pushed duplicate is the live binding");

    Environment *frame = env_new_scoped(NULL, scope);
    EastValue *one = east_integer(1), *two = east_integer(2), *three = east_integer(3);
    env_set(frame, "b", one);
    CHECK(frame->slots[1] == one && frame->overflow == NULL,
          "frame: a by-name set of an in-scope name fills its cell");
    env_set(frame, "zz", two);
    CHECK(frame->overflow != NULL && env_get(frame, "zz") == two,
          "frame: a by-name set of a name outside the scope goes to overflow");
    CHECK(env_get(frame, "a") == NULL && !env_has(frame, "a"),
          "frame: an unbound cell is not a binding");

    Environment *child = env_new(frame);
    CHECK(env_get(child, "b") == one, "frame: a child sees the parent's cell");
    env_update(child, "b", three);
    CHECK(frame->slots[1] == three && child->overflow == NULL,
          "frame: an update through a child lands in the parent's cell");
    env_update(child, "fresh", three);
    CHECK(child->overflow != NULL && env_get(frame, "fresh") == NULL,
          "frame: an update of an unbound name binds in the current frame");

    env_release(child);
    env_release(frame);
    east_value_release(one);
    east_value_release(two);
    east_value_release(three);
    ir_scope_release(scope);
}

static void run_all(bool resolved)
{
    set_resolution(resolved);
    expect(USE_BEFORE_LET, 40, "use before let sees the outer binding", resolved);
    expect(CLOSURE_ASSIGN, 52, "assign through a closure, both ways", resolved);
    expect(LOOP_CLOSURES, 6, "a closure per loop iteration", resolved);
    expect(MATCH_BIND, 6, "match binder", resolved);
    expect(CATCH_BIND, 104, "catch binders", resolved);
    test_dynamic_capture(resolved);
    test_params(resolved);
}

int main(void)
{
    east_type_of_type_init();

    test_frame_api();
    run_all(true);
    run_all(false);
    set_resolution(true);

    if (failures > 0) {
        fprintf(stderr, "%d failure(s)\n", failures);
        return 1;
    }
    printf("scope resolution gate: all checks passed\n");
    return 0;
}
