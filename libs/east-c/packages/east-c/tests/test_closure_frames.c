/*
 * Frames a closure bound in them holds (#1002).
 *
 * A closure shares the frame it was made in, so one bound in that same frame
 * — `const f = $.const(East.function(...))`, or the Let linkImports embeds an
 * imported function under — held the frame that held it. Reference counting
 * never freed that cycle and the cycle collector, which walks values, never
 * saw it: every evaluation of such a body kept its frames, the closure and
 * everything they held until the process exited — a Dict output merge that
 * calls an imported function kept every fold's arguments.
 *
 * Two things fix it, and this gate pins both:
 *
 *   - a function whose body reads nothing it does not bind is closed (the
 *     resolver marks it) and holds no frame at all;
 *   - when the evaluator lets go of a frame that only closures bound in it
 *     still hold — directly, or through frames only they hold (the Block a
 *     build's hoisted constants sit in) — it unbinds those frames, so the
 *     closures and frames go with it.
 *
 * Every shape runs its body many times, resolved and unresolved (nothing is
 * closed then, and the frames bind by name), and must leave no tracked value
 * behind once a full collection has run — each leaked cycle held at least its
 * closure, which is tracked. The shapes where a closure outlives its block —
 * returned, assigned further out, one of two escaping — must still answer
 * from the frame it holds.
 *
 * Run under ASan/LSan: unbinding a frame a live closure still reads is a
 * use-after-free there.
 */
#include <east/east.h>
#include <east/compiler.h>
#include <east/gc.h>
#include <east/ir.h>

#include <stdarg.h>
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

/* ----- IR through the builders (ir.h) -----
 *
 * Each helper takes over the references its IRNode arguments carry, so a
 * program is one nested expression, released once. */

static EastType *int_t, *set_t;
static EastType *fn_i;     /* () -> Integer */
static EastType *fn_ii;    /* (Integer) -> Integer */
static EastType *fn_i_fn;  /* (Integer) -> () -> Integer */
static EastType *fn_fn;    /* () -> (Integer) -> Integer */
static EastType *fn_merge; /* (Integer, Set<Integer>, Set<Integer>) -> Set<Integer> */

static void init_types(void)
{
    int_t = &east_integer_type;
    set_t = east_set_type(int_t);
    EastType *one[1] = {int_t};
    fn_i = east_function_type(NULL, 0, int_t);
    fn_ii = east_function_type(one, 1, int_t);
    fn_i_fn = east_function_type(one, 1, fn_i);
    fn_fn = east_function_type(NULL, 0, fn_ii);
    EastType *merge_inputs[3] = {int_t, set_t, set_t};
    fn_merge = east_function_type(merge_inputs, 3, set_t);
}

/* A NULL-terminated list of names, for a function's captures or params. */
#define NAMES(...) ((const char *[]){__VA_ARGS__, NULL})
#define NONE NULL

/* A variable bound with `const`, and one bound with `let`. */
static IRNode *var(EastType *type, const char *name)
{
    return ir_variable(type, name, false, false);
}

static IRNode *mvar(EastType *type, const char *name)
{
    return ir_variable(type, name, true, false);
}

static IRNode *integer(int64_t n)
{
    EastValue *v = east_integer(n);
    IRNode *node = ir_value(int_t, v);
    east_value_release(v);
    return node;
}

static IRNode *empty_set(void)
{
    return ir_new_set(set_t, NULL, 0);
}

static IRNode *let(const char *name, bool mutable, IRNode *value)
{
    IRNode *node = ir_let(&east_null_type, name, mutable, false, value);
    ir_node_release(value);
    return node;
}

static IRNode *assign(const char *name, IRNode *value)
{
    IRNode *node = ir_assign(&east_null_type, name, value);
    ir_node_release(value);
    return node;
}

/* `n` statements; the block's type is the last one's. */
static IRNode *block(size_t n, ...)
{
    IRNode *stmts[8];
    va_list ap;
    va_start(ap, n);
    for (size_t i = 0; i < n; i++)
        stmts[i] = va_arg(ap, IRNode *);
    va_end(ap);
    IRNode *node = ir_block(stmts[n - 1]->type, stmts, n);
    for (size_t i = 0; i < n; i++)
        ir_node_release(stmts[i]);
    return node;
}

static IRNode *builtin(EastType *type, const char *name, EastType *type_param, IRNode *a, IRNode *b)
{
    EastType *type_params[1] = {type_param};
    IRNode *args[2] = {a, b};
    IRNode *node = ir_builtin(type, name, type_params, type_param ? 1 : 0, args, 2);
    ir_node_release(a);
    ir_node_release(b);
    return node;
}

static IRNode *add(IRNode *a, IRNode *b)
{
    return builtin(int_t, "IntegerAdd", NULL, a, b);
}

static IRNode *sub(IRNode *a, IRNode *b)
{
    return builtin(int_t, "IntegerSubtract", NULL, a, b);
}

static IRNode *less(IRNode *a, IRNode *b)
{
    return builtin(&east_boolean_type, "Less", int_t, a, b);
}

static IRNode *equal(IRNode *a, IRNode *b)
{
    return builtin(&east_boolean_type, "Equal", int_t, a, b);
}

static IRNode *set_union(IRNode *a, IRNode *b)
{
    return builtin(set_t, "SetUnion", int_t, a, b);
}

/* fn(args...), typed as the function's output. */
static IRNode *call(IRNode *fn, size_t n, ...)
{
    IRNode *args[4];
    va_list ap;
    va_start(ap, n);
    for (size_t i = 0; i < n; i++)
        args[i] = va_arg(ap, IRNode *);
    va_end(ap);
    IRNode *node = ir_call(fn->type->data.function.output, fn, args, n);
    ir_node_release(fn);
    for (size_t i = 0; i < n; i++)
        ir_node_release(args[i]);
    return node;
}

/* A function over `params`, declaring `captures` as the IR does. */
static IRNode *function(EastType *type, const char **captures, const char **params, IRNode *body)
{
    IRVariable caps[4] = {{0}}, pars[4] = {{0}};
    size_t nc = 0, np = 0;
    for (; captures && captures[nc]; nc++)
        caps[nc].name = (char *)captures[nc];
    for (; params && params[np]; np++)
        pars[np].name = (char *)params[np];
    IRNode *node = ir_function(type, caps, nc, pars, np, body);
    ir_node_release(body);
    return node;
}

static IRNode *while_loop(IRNode *cond, IRNode *body)
{
    IRNode *node = ir_while(&east_null_type, cond, body, NULL);
    ir_node_release(cond);
    ir_node_release(body);
    return node;
}

static IRNode *if_else(IRNode *cond, IRNode *then_branch, IRNode *else_branch)
{
    IRNode *node = ir_if_else(then_branch->type, cond, then_branch, else_branch);
    ir_node_release(cond);
    ir_node_release(then_branch);
    ir_node_release(else_branch);
    return node;
}

/* ----- the programs ----- */

/* (n) => { let acc = 0; let i = 0; while (i < n) { <binding>; acc = <use>; i = i + 1 }; acc } */
static IRNode *loop(IRNode *binding, IRNode *use)
{
    return function(fn_ii, NONE, NAMES("n"),
                    block(4, let("acc", true, integer(0)), let("i", true, integer(0)),
                          while_loop(less(mvar(int_t, "i"), var(int_t, "n")),
                                     block(3, binding, assign("acc", use),
                                           assign("i", add(mvar(int_t, "i"), integer(1))))),
                          mvar(int_t, "acc")));
}

/* const f = (x) => x + 1; acc = f(i) — the issue's plain loop: a closed
 * function bound on every pass. Ends at n. */
static IRNode *loop_closed(void)
{
    return loop(
        let("f", false, function(fn_ii, NONE, NAMES("x"), add(var(int_t, "x"), integer(1)))),
        call(var(fn_ii, "f"), 1, mvar(int_t, "i")));
}

/* const f = (x) => x + i; acc = acc + f(1) — a closure over the loop's own
 * counter, bound in the pass's frame. Ends at n + n(n-1)/2. */
static IRNode *loop_capturing(void)
{
    return loop(
        let("f", false,
            function(fn_ii, NAMES("i"), NAMES("x"), add(var(int_t, "x"), mvar(int_t, "i")))),
        add(mvar(int_t, "acc"), call(var(fn_ii, "f"), 1, integer(1))));
}

/* const g = { const c = 2; (x) => x + c }; acc = acc + g(i) — what linkImports
 * embeds for a function exported with its build's hoisted constants: the
 * closure holds the Block's frame, whose parent holds the closure. Ends at
 * n(n-1)/2 + 2n. */
static IRNode *loop_hoisted(void)
{
    return loop(
        let("g", false,
            block(2, let("c", false, integer(2)),
                  function(fn_ii, NAMES("c"), NAMES("x"), add(var(int_t, "x"), var(int_t, "c"))))),
        add(mvar(int_t, "acc"), call(var(fn_ii, "g"), 1, mvar(int_t, "i"))));
}

/* (n) => { let f = (x) => 0; f = (x) => x == 0 ? 0 : x + f(x - 1); f(n) } —
 * recursion through the binding the closure captures. n(n+1)/2. */
static IRNode *recursion(void)
{
    return function(
        fn_ii, NONE, NAMES("n"),
        block(3, let("f", true, function(fn_ii, NONE, NAMES("x"), integer(0))),
              assign("f", function(fn_ii, NAMES("f"), NAMES("x"),
                                   if_else(equal(var(int_t, "x"), integer(0)), integer(0),
                                           add(var(int_t, "x"),
                                               call(mvar(fn_ii, "f"), 1,
                                                    sub(var(int_t, "x"), integer(1))))))),
              call(mvar(fn_ii, "f"), 1, var(int_t, "n"))));
}

/* () => { let g = () => 0; { const k = 7; const f = () => k; g = f }; g() } —
 * a closure assigned out of its block keeps the block's frame, and the pair
 * goes with the outer frame. 7. */
static IRNode *escape_assign(void)
{
    return function(fn_i, NONE, NONE,
                    block(3, let("g", true, function(fn_i, NONE, NONE, integer(0))),
                          block(3, let("k", false, integer(7)),
                                let("f", false, function(fn_i, NAMES("k"), NONE, var(int_t, "k"))),
                                assign("g", var(fn_i, "f"))),
                          call(mvar(fn_i, "g"), 0)));
}

/* () => { let g = () => 0; let total = 0;
 *         { const k = 5; const f1 = () => k; const f2 = () => k + 1; total = f1(); g = f2 };
 *         total + g() }
 * — two closures over one frame, one escaping: the frame stays for it, and the
 * other goes with the outer frame. 11. */
static IRNode *one_of_two_escapes(void)
{
    return function(
        fn_i, NONE, NONE,
        block(4, let("g", true, function(fn_i, NONE, NONE, integer(0))),
              let("total", true, integer(0)),
              block(5, let("k", false, integer(5)),
                    let("f1", false, function(fn_i, NAMES("k"), NONE, var(int_t, "k"))),
                    let("f2", false,
                        function(fn_i, NAMES("k"), NONE, add(var(int_t, "k"), integer(1)))),
                    assign("total", call(var(fn_i, "f1"), 0)), assign("g", var(fn_i, "f2"))),
              add(mvar(int_t, "total"), call(mvar(fn_i, "g"), 0))));
}

/* () => { const base = 40; const mk = (x) => { const f = () => x + base; f };
 *         const h = mk(1); h() + 1 }
 * — a function returns the closure it bound: the closure outlives its frame
 * through the return, and reads it afterwards. 42. */
static IRNode *escape_return(void)
{
    return function(
        fn_i, NONE, NONE,
        block(4, let("base", false, integer(40)),
              let("mk", false,
                  function(fn_i_fn, NAMES("base"), NAMES("x"),
                           block(2,
                                 let("f", false,
                                     function(fn_i, NAMES("x", "base"), NONE,
                                              add(var(int_t, "x"), var(int_t, "base")))),
                                 var(fn_i, "f")))),
              let("h", false, call(var(fn_i_fn, "mk"), 1, integer(1))),
              add(call(var(fn_i, "h"), 0), integer(1))));
}

/* (k, a, b) => { const f = <fn>; f(k, a, b) } — a merge binding the function
 * it calls. */
static IRNode *merge(IRNode *fn)
{
    return function(
        fn_merge, NONE, NAMES("k", "a", "b"),
        block(2, let("f", false, fn),
              call(var(fn_merge, "f"), 3, var(int_t, "k"), var(set_t, "a"), var(set_t, "b"))));
}

/* The linked merge the issue measured: a closed import, (k, a, b) => a.union(b). */
static IRNode *merge_closed(void)
{
    return merge(function(fn_merge, NONE, NAMES("k2", "a2", "b2"),
                          set_union(var(set_t, "a2"), var(set_t, "b2"))));
}

/* The same import exported with a hoisted constant:
 * { const e = {}; (k, a, b) => a.union(b).union(e) }. */
static IRNode *merge_hoisted(void)
{
    return merge(
        block(2, let("e", false, empty_set()),
              function(fn_merge, NAMES("e"), NAMES("k2", "a2", "b2"),
                       set_union(set_union(var(set_t, "a2"), var(set_t, "b2")), var(set_t, "e")))));
}

/* () => { const f = (x) => x + 1; f } — a closed function's value. */
static IRNode *closed_value(void)
{
    return function(
        fn_fn, NONE, NONE,
        block(2,
              let("f", false, function(fn_ii, NONE, NAMES("x"), add(var(int_t, "x"), integer(1)))),
              var(fn_ii, "f")));
}

/* ----- harness ----- */

typedef struct {
    IRNode *ir;
    EastCompiledFn *fn;
    BuiltinRegistry *builtins;
    PlatformRegistry *platform;
} Program;

/* Builds the program, resolves it or leaves every read by name, compiles it. */
static bool compile(IRNode *(*build)(void), bool resolved, const char *what, Program *p)
{
    memset(p, 0, sizeof(*p));
    p->ir = build();
    if (resolved) ir_resolve_scopes(p->ir);
    p->builtins = builtin_registry_new();
    east_register_all_builtins(p->builtins);
    p->platform = platform_registry_new();
    char *err = NULL;
    p->fn = east_compile_fn(p->ir, p->platform, p->builtins, &err);
    CHECK(p->fn != NULL, "%s: compile failed: %s", what, err ? err : "(no message)");
    free(err);
    return p->fn != NULL;
}

static void release(Program *p)
{
    if (p->fn) east_compiled_fn_free(p->fn);
    if (p->platform) platform_registry_release(p->platform);
    if (p->builtins) builtin_registry_free(p->builtins);
    if (p->ir) ir_node_release(p->ir);
}

static const char *mode(bool resolved)
{
    return resolved ? "resolved" : "by name";
}

/* fn(args) as an Integer, -1 on failure. */
static int64_t call_int(EastCompiledFn *fn, EastValue **args, size_t n, const char *what)
{
    int64_t out = -1;
    EvalResult r = east_call(fn, args, n);
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

/* The tracked values a full collection leaves: what a run must return to. */
static size_t tracked_after_collection(void)
{
    east_gc_collect_full();
    return east_gc_tracked_count();
}

/* Runs the program (of `n` when `n` >= 0, of nothing otherwise) once to warm
 * up, then `calls` times, each giving `want`, and asserts those calls left no
 * tracked value behind. */
static void expect_no_leak(IRNode *(*build)(void), int64_t n, int calls, int64_t want,
                           const char *what, bool resolved)
{
    Program p;
    if (!compile(build, resolved, what, &p)) {
        release(&p);
        return;
    }
    EastValue *arg = n >= 0 ? east_integer(n) : NULL;
    EastValue *args[1] = {arg};
    size_t nargs = arg ? 1 : 0;

    call_int(p.fn, args, nargs, what);
    size_t before = tracked_after_collection();
    for (int c = 0; c < calls; c++) {
        int64_t got = call_int(p.fn, args, nargs, what);
        CHECK(got == want, "%s (%s) gave %lld, expected %lld", what, mode(resolved), (long long)got,
              (long long)want);
    }
    size_t after = tracked_after_collection();
    CHECK(after == before, "%s (%s): %lld tracked values outlived %d calls", what, mode(resolved),
          (long long)after - (long long)before, calls);

    if (arg) east_value_release(arg);
    release(&p);
}

/* Drives a merge the way a Dict output folds a key's parts:
 * acc = merge(0, acc, {i}) for each i. Each fold's arguments must go when it
 * returns. */
static void expect_merge_folds(IRNode *(*build)(void), const char *what, bool resolved)
{
    enum { FOLDS = 500 };
    Program p;
    if (!compile(build, resolved, what, &p)) {
        release(&p);
        return;
    }
    size_t before = tracked_after_collection();
    EastValue *key = east_integer(0);
    EastValue *acc = east_set_new(int_t);
    for (int i = 0; i < FOLDS && acc; i++) {
        EastValue *part = east_set_new(int_t);
        EastValue *element = east_integer(i);
        east_set_insert(part, element);
        east_value_release(element);
        EastValue *args[3] = {key, acc, part};
        EvalResult r = east_call(p.fn, args, 3);
        east_value_release(acc);
        east_value_release(part);
        acc = NULL;
        if (r.status != EVAL_OK || !r.value || r.value->kind != EAST_VAL_SET) {
            CHECK(false, "%s (%s): fold %d failed: %s", what, mode(resolved), i,
                  r.error_message ? r.error_message : "(no message)");
            if (r.value) east_value_release(r.value);
        } else {
            acc = r.value;
        }
        eval_result_free(&r);
    }
    CHECK(acc && east_set_len(acc) == FOLDS, "%s (%s) folded to %zu elements, expected %d", what,
          mode(resolved), acc ? east_set_len(acc) : 0, FOLDS);
    if (acc) east_value_release(acc);
    east_value_release(key);
    size_t after = tracked_after_collection();
    CHECK(after == before, "%s (%s): %lld tracked values outlived %d folds", what, mode(resolved),
          (long long)after - (long long)before, FOLDS);
    release(&p);
}

/* A closed function holds no frame: its value's captures are empty, and it
 * answers once the frame it was made in is gone. Unresolved, nothing is
 * closed, and the function holds its frame as before. */
static void test_closed_value(bool resolved)
{
    const char *what = "a closed function's value";
    Program p;
    if (!compile(closed_value, resolved, what, &p)) {
        release(&p);
        return;
    }
    IRNode *inner = p.ir->data.function.body->data.block.stmts[0]->data.let.value;
    CHECK(inner->kind == IR_FUNCTION && inner->data.function.closed == resolved,
          "%s: the function is %s %s", what, inner->data.function.closed ? "closed" : "open",
          mode(resolved));

    EvalResult r = east_call(p.fn, NULL, 0);
    if (r.status != EVAL_OK || !r.value || r.value->kind != EAST_VAL_FUNCTION) {
        CHECK(false, "%s: run failed: %s", what, r.error_message ? r.error_message : "(none)");
    } else {
        EastCompiledFn *closed = r.value->data.function.compiled;
        CHECK((closed->captures == NULL) == resolved, "%s holds %s frame %s", what,
              closed->captures ? "a" : "no", mode(resolved));
        EastValue *x = east_integer(41);
        int64_t got = call_int(closed, &x, 1, what);
        CHECK(got == 42, "%s gave %lld, expected 42", what, (long long)got);
        east_value_release(x);
    }
    if (r.value) east_value_release(r.value);
    eval_result_free(&r);
    release(&p);
}

/* A function that reads what an enclosing body binds is not closed — through
 * a function nested in it too — and neither is one whose IR declares a
 * capture. */
static void test_open_functions(void)
{
    const char *what = "a closure over the loop counter";
    Program p;
    if (compile(loop_capturing, true, what, &p)) {
        IRNode *loop_node = p.ir->data.function.body->data.block.stmts[2];
        IRNode *f = loop_node->data.while_.body->data.block.stmts[0]->data.let.value;
        CHECK(!f->data.function.closed, "%s: its read of `i` keeps it open", what);
    }
    release(&p);

    what = "a function returning a closure over its caller's binding";
    if (compile(escape_return, true, what, &p)) {
        IRNode *mk = p.ir->data.function.body->data.block.stmts[1]->data.let.value;
        CHECK(!mk->data.function.closed, "%s: its read of `base` keeps it open", what);
    }
    release(&p);

    /* (x) => x, declaring a capture it never reads: the beast2 encoder writes
     * the declared captures from the closure's frame, so it must keep one. */
    what = "a function declaring an unread capture";
    IRNode *fn = function(fn_ii, NAMES("unread"), NAMES("x"), var(int_t, "x"));
    ir_resolve_scopes(fn);
    CHECK(!fn->data.function.closed, "%s: stays open", what);
    ir_node_release(fn);
}

static void run_all(bool resolved)
{
    expect_no_leak(loop_closed, 200, 5, 200, "a closed function bound per pass", resolved);
    expect_no_leak(loop_capturing, 200, 5, 200 + 200 * 199 / 2,
                   "a capturing closure bound per pass", resolved);
    expect_no_leak(loop_hoisted, 200, 5, 200 * 199 / 2 + 400,
                   "a closure over hoisted constants bound per pass", resolved);
    expect_no_leak(recursion, 30, 20, 30 * 31 / 2, "a closure recursing through its binding",
                   resolved);
    expect_no_leak(escape_assign, -1, 20, 7, "a closure assigned out of its block", resolved);
    expect_no_leak(one_of_two_escapes, -1, 20, 11, "one of two closures over a frame escaping",
                   resolved);
    expect_no_leak(escape_return, -1, 20, 42, "a function returning the closure it bound",
                   resolved);
    expect_merge_folds(merge_closed, "a merge binding a closed import", resolved);
    expect_merge_folds(merge_hoisted, "a merge binding an import with hoisted constants", resolved);
    test_closed_value(resolved);
}

int main(void)
{
    init_types();

    run_all(true);
    run_all(false);
    test_open_functions();

    east_gc_collect_full();
    east_type_registry_clear();

    if (failures > 0) {
        fprintf(stderr, "%d failure(s)\n", failures);
        return 1;
    }
    printf("closure frames gate: all checks passed\n");
    return 0;
}
