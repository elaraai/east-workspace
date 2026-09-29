/*
 * Frames a closure bound in them holds (#1002), and the cycles a frame and a
 * closure however held make (#1010).
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
 * That check saw a closure only where a frame bound it directly. An open
 * closure held inside a struct, array, dict or ref bound in the frame it reads
 * kept the frame all the same (#1010). Two more things fix that:
 *
 *   - the check also walks what a frame binds, where its type can hold a
 *     function, a bounded number of values deep, so a frame whose closures
 *     are all held by what it binds goes as the evaluator lets go of it —
 *     whatever generation those values have reached;
 *   - the cycle collector counts references to frames as it counts them to
 *     values, and reclaims what the check cannot: a closure held from outside
 *     when its frame is done, and dropped later.
 *
 * Every shape runs its body many times, resolved and unresolved (nothing is
 * closed then, and the frames bind by name), and must leave no tracked value
 * behind once a full collection has run — each leaked cycle held at least its
 * closure, which is tracked. A long loop of the #1010 shapes must also hold
 * no more than its young collections leave, with no collection forced, at a
 * length where a slow leak would show — a loop inside the pass, whose
 * collections run while the pass's frame is live, among them. The shapes
 * where a closure outlives its block — returned, assigned further out, one of
 * two escaping, kept past the loop that made it, kept until the next pass —
 * must still answer from the frame it holds, after collections that run while
 * it is held.
 *
 * Run under ASan/LSan: unbinding or freeing a frame a live closure still
 * reads is a use-after-free there.
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
static EastType *fn_i;      /* () -> Integer */
static EastType *fn_ii;     /* (Integer) -> Integer */
static EastType *fn_i_fn;   /* (Integer) -> () -> Integer */
static EastType *fn_fn;     /* () -> (Integer) -> Integer */
static EastType *fn_merge;  /* (Integer, Set<Integer>, Set<Integer>) -> Set<Integer> */
static EastType *holder_t;  /* {fn: () -> Integer} */
static EastType *holders_t; /* Array<{fn: () -> Integer}> */
static EastType *fns_t;     /* Array<() -> Integer> */
static EastType *fn_dict_t; /* Dict<Integer, () -> Integer> */
static EastType *fn_ref_t;  /* Ref<() -> Integer> */
static EastType *fn_holder; /* () -> {fn: () -> Integer} */
static EastType *fn_fn_i;   /* () -> () -> Integer */

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
    const char *holder_fields[1] = {"fn"};
    EastType *holder_types[1] = {fn_i};
    holder_t = east_struct_type(holder_fields, holder_types, 1);
    holders_t = east_array_type(holder_t);
    fns_t = east_array_type(fn_i);
    fn_dict_t = east_dict_type(int_t, fn_i);
    fn_ref_t = east_ref_type(fn_i);
    fn_holder = east_function_type(NULL, 0, holder_t);
    fn_fn_i = east_function_type(NULL, 0, fn_i);
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

/* The `n` statements in `stmts`; the block's type is the last one's. */
static IRNode *block_of(size_t n, IRNode **stmts)
{
    IRNode *node = ir_block(stmts[n - 1]->type, stmts, n);
    for (size_t i = 0; i < n; i++)
        ir_node_release(stmts[i]);
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
    return block_of(n, stmts);
}

/* A builtin over `a`, and over `b` when there is one. */
static IRNode *builtin(EastType *type, const char *name, EastType *type_param, IRNode *a, IRNode *b)
{
    EastType *type_params[1] = {type_param};
    IRNode *args[2] = {a, b};
    IRNode *node = ir_builtin(type, name, type_params, type_param ? 1 : 0, args, b ? 2 : 1);
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

/* {fn: <fn>} */
static IRNode *holder(IRNode *fn)
{
    char *names[1] = {"fn"};
    IRNode *node = ir_struct(holder_t, names, &fn, 1);
    ir_node_release(fn);
    return node;
}

/* <w>.fn */
static IRNode *holder_fn(IRNode *w)
{
    IRNode *node = ir_get_field(fn_i, w, "fn");
    ir_node_release(w);
    return node;
}

/* [<fn>] */
static IRNode *array_of(IRNode *fn)
{
    IRNode *node = ir_new_array(fns_t, &fn, 1);
    ir_node_release(fn);
    return node;
}

/* [<w>], of {fn} */
static IRNode *holder_array(IRNode *w)
{
    IRNode *node = ir_new_array(holders_t, &w, 1);
    ir_node_release(w);
    return node;
}

/* {0: <fn>} */
static IRNode *dict_of(IRNode *fn)
{
    IRNode *key = integer(0);
    IRNode *node = ir_new_dict(fn_dict_t, &key, &fn, 1);
    ir_node_release(key);
    ir_node_release(fn);
    return node;
}

/* ref(<fn>) */
static IRNode *ref_of(IRNode *fn)
{
    IRNode *node = ir_new_ref(fn_ref_t, fn);
    ir_node_release(fn);
    return node;
}

/* ----- the programs ----- */

/* (n) => { let acc = 0; let i = 0; while (i < n) { <bindings>; acc = <use>; i = i + 1 }; acc }
 * — the `n` bindings share the pass's frame. */
static IRNode *loop_binding(size_t n, IRNode **bindings, IRNode *use)
{
    IRNode *pass[6];
    for (size_t b = 0; b < n; b++)
        pass[b] = bindings[b];
    pass[n] = assign("acc", use);
    pass[n + 1] = assign("i", add(mvar(int_t, "i"), integer(1)));
    return function(
        fn_ii, NONE, NAMES("n"),
        block(4, let("acc", true, integer(0)), let("i", true, integer(0)),
              while_loop(less(mvar(int_t, "i"), var(int_t, "n")), block_of(n + 2, pass)),
              mvar(int_t, "acc")));
}

/* (n) => { let acc = 0; let i = 0; while (i < n) { <binding>; acc = <use>; i = i + 1 }; acc } */
static IRNode *loop(IRNode *binding, IRNode *use)
{
    return loop_binding(1, &binding, use);
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

/* ----- a closure held in a composite bound in the frame it reads (#1010) ----- */

/* acc = acc + <fn>() */
static IRNode *acc_plus_call(IRNode *fn)
{
    return add(mvar(int_t, "acc"), call(fn, 0));
}

/* const w = {fn: () => 1}; acc = acc + w.fn() — a closed function in a struct:
 * resolved it holds no frame, by name it holds the pass's. Ends at n. */
static IRNode *loop_closed_in_struct(void)
{
    return loop(let("w", false, holder(function(fn_i, NONE, NONE, integer(1)))),
                acc_plus_call(holder_fn(var(holder_t, "w"))));
}

/* const x = i; const w = {fn: () => x}; acc = acc + w.fn() — an open closure
 * in a struct bound in the frame it reads. n(n-1)/2. */
static IRNode *loop_open_in_struct(void)
{
    IRNode *bindings[2] = {
        let("x", false, mvar(int_t, "i")),
        let("w", false, holder(function(fn_i, NAMES("x"), NONE, var(int_t, "x")))),
    };
    return loop_binding(2, bindings, acc_plus_call(holder_fn(var(holder_t, "w"))));
}

/* const x = i; const f = () => x; const w = {fn: f}; acc = acc + w.fn() — the
 * closure bound in the frame too, so the struct's reference to it is one the
 * frame's cells do not account for. n(n-1)/2. */
static IRNode *loop_open_bound_and_in_struct(void)
{
    IRNode *bindings[3] = {
        let("x", false, mvar(int_t, "i")),
        let("f", false, function(fn_i, NAMES("x"), NONE, var(int_t, "x"))),
        let("w", false, holder(var(fn_i, "f"))),
    };
    return loop_binding(3, bindings, acc_plus_call(holder_fn(var(holder_t, "w"))));
}

/* const x = i; const w = [() => x]; acc = acc + w[0]() — in an array. n(n-1)/2. */
static IRNode *loop_open_in_array(void)
{
    IRNode *bindings[2] = {
        let("x", false, mvar(int_t, "i")),
        let("w", false, array_of(function(fn_i, NAMES("x"), NONE, var(int_t, "x")))),
    };
    return loop_binding(
        2, bindings, acc_plus_call(builtin(fn_i, "ArrayGet", NULL, var(fns_t, "w"), integer(0))));
}

/* const x = i; const w = {0: () => x}; acc = acc + w.get(0)() — in a dict.
 * n(n-1)/2. */
static IRNode *loop_open_in_dict(void)
{
    IRNode *bindings[2] = {
        let("x", false, mvar(int_t, "i")),
        let("w", false, dict_of(function(fn_i, NAMES("x"), NONE, var(int_t, "x")))),
    };
    return loop_binding(
        2, bindings,
        acc_plus_call(builtin(fn_i, "DictGet", int_t, var(fn_dict_t, "w"), integer(0))));
}

/* const x = i; const w = ref(() => x); acc = acc + w.get()() — in a ref.
 * n(n-1)/2. */
static IRNode *loop_open_in_ref(void)
{
    IRNode *bindings[2] = {
        let("x", false, mvar(int_t, "i")),
        let("w", false, ref_of(function(fn_i, NAMES("x"), NONE, var(int_t, "x")))),
    };
    return loop_binding(2, bindings,
                        acc_plus_call(builtin(fn_i, "RefGet", NULL, var(fn_ref_t, "w"), NULL)));
}

/* const x = i; const w = {fn: () => x}; { let j = 0; while (j < 3) j = j + 1 };
 * acc = acc + w.fn() — the struct's shape with a loop inside the pass, whose
 * back-edge can run a young collection while the pass's frame still holds its
 * cycle: by the time the pass ends, the cycle may be old. n(n-1)/2. */
static IRNode *loop_nested(void)
{
    IRNode *bindings[3] = {
        let("x", false, mvar(int_t, "i")),
        let("w", false, holder(function(fn_i, NAMES("x"), NONE, var(int_t, "x")))),
        block(2, let("j", true, integer(0)),
              while_loop(less(mvar(int_t, "j"), integer(3)),
                         assign("j", add(mvar(int_t, "j"), integer(1))))),
    };
    return loop_binding(3, bindings, acc_plus_call(holder_fn(var(holder_t, "w"))));
}

/* (n) => { let acc = 0; let i = 0; let keep = [{fn: () => 0}];
 *          while (i < n) { const x = i; const w = {fn: () => x}; keep = [w];
 *                          acc = acc + w.fn(); i = i + 1 };
 *          acc }
 * — each pass's struct escapes into `keep` and the next pass drops it, after
 * its frame is done: only the cycle collector can reclaim that. n(n-1)/2. */
static IRNode *escape_then_drop(void)
{
    IRNode *pass[5] = {
        let("x", false, mvar(int_t, "i")),
        let("w", false, holder(function(fn_i, NAMES("x"), NONE, var(int_t, "x")))),
        assign("keep", holder_array(var(holder_t, "w"))),
        assign("acc", acc_plus_call(holder_fn(var(holder_t, "w")))),
        assign("i", add(mvar(int_t, "i"), integer(1))),
    };
    return function(
        fn_ii, NONE, NAMES("n"),
        block(5, let("acc", true, integer(0)), let("i", true, integer(0)),
              let("keep", true, holder_array(holder(function(fn_i, NONE, NONE, integer(0))))),
              while_loop(less(mvar(int_t, "i"), var(int_t, "n")), block_of(5, pass)),
              mvar(int_t, "acc")));
}

/* (n) => { let acc = 0; let i = 0; let first = {fn: () => 0};
 *          while (i < n) { const x = i + 1; const w = {fn: () => x};
 *                          if (i == 5) first = w; acc = acc + w.fn(); i = i + 1 };
 *          acc + first.fn() }
 * — one pass's struct outlives the loop that made it, through every young
 * collection the loop runs, and answers from its frame afterwards.
 * n(n+1)/2 + 6. */
static IRNode *escape_mid_loop(void)
{
    IRNode *pass[5] = {
        let("x", false, add(mvar(int_t, "i"), integer(1))),
        let("w", false, holder(function(fn_i, NAMES("x"), NONE, var(int_t, "x")))),
        if_else(equal(mvar(int_t, "i"), integer(5)), assign("first", var(holder_t, "w")), NULL),
        assign("acc", acc_plus_call(holder_fn(var(holder_t, "w")))),
        assign("i", add(mvar(int_t, "i"), integer(1))),
    };
    return function(fn_ii, NONE, NAMES("n"),
                    block(5, let("acc", true, integer(0)), let("i", true, integer(0)),
                          let("first", true, holder(function(fn_i, NONE, NONE, integer(0)))),
                          while_loop(less(mvar(int_t, "i"), var(int_t, "n")), block_of(5, pass)),
                          acc_plus_call(holder_fn(mvar(holder_t, "first")))));
}

/* () => { const k = 7; const w = {fn: () => k}; w } — a closure in a struct,
 * returned out of the block it reads. */
static IRNode *returns_holder(void)
{
    return function(
        fn_holder, NONE, NONE,
        block(3, let("k", false, integer(7)),
              let("w", false, holder(function(fn_i, NAMES("k"), NONE, var(int_t, "k")))),
              var(holder_t, "w")));
}

/* () => { const k = 7; const f = () => k; f } — a closure bound in its own
 * frame and returned: the reference from outside goes only once the frame is
 * done, which the frame check never sees. */
static IRNode *returns_bound(void)
{
    return function(fn_fn_i, NONE, NONE,
                    block(3, let("k", false, integer(7)),
                          let("f", false, function(fn_i, NAMES("k"), NONE, var(int_t, "k"))),
                          var(fn_i, "f")));
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

/* Runs the program over `n` passes once, forcing no collection, and asserts
 * what it leaves tracked is no more than its loop's young collections leave
 * behind — flat, however many passes run. A leaking pass leaves at least its
 * closure and the value holding it, so `n` of them would leave 2n. */
static void expect_flat(IRNode *(*build)(void), int64_t n, int64_t want, const char *what,
                        bool resolved)
{
    Program p;
    if (!compile(build, resolved, what, &p)) {
        release(&p);
        return;
    }
    EastValue *arg = east_integer(n);
    size_t before = tracked_after_collection();
    int64_t got = call_int(p.fn, &arg, 1, what);
    long long held = (long long)east_gc_tracked_count() - (long long)before;
    CHECK(got == want, "%s (%s) gave %lld over %lld passes, expected %lld", what, mode(resolved),
          (long long)got, (long long)n, (long long)want);
    CHECK(held <= 2 * GC_YOUNG_THRESHOLD, "%s (%s): %lld tracked values held after %lld passes",
          what, mode(resolved), held, (long long)n);
    east_value_release(arg);
    release(&p);
}

/* The closure a result is, or holds. */
static EastValue *itself(EastValue *result)
{
    return result;
}

static EastValue *its_fn(EastValue *result)
{
    return east_struct_get_field(result, "fn");
}

/* Calls a function returning a closure — `closure_of` finds it in the result —
 * many times. Each result is held through a full collection and must still
 * answer 7 from the frame its closure holds; dropped, it must leave nothing. */
static void expect_escape(IRNode *(*build)(void), EastValue *(*closure_of)(EastValue *),
                          const char *what, bool resolved)
{
    enum { CALLS = 20 };
    Program p;
    if (!compile(build, resolved, what, &p)) {
        release(&p);
        return;
    }
    size_t before = tracked_after_collection();
    for (int c = 0; c < CALLS; c++) {
        EvalResult r = east_call(p.fn, NULL, 0);
        EastValue *fn = r.status == EVAL_OK && r.value ? closure_of(r.value) : NULL;
        if (!fn || fn->kind != EAST_VAL_FUNCTION) {
            CHECK(false, "%s (%s): run failed: %s", what, mode(resolved),
                  r.error_message ? r.error_message : "(no closure)");
        } else {
            east_gc_collect_full(); /* the result holds the closure, and so its frame */
            int64_t got = call_int(fn->data.function.compiled, NULL, 0, what);
            CHECK(got == 7, "%s (%s) gave %lld after a collection, expected 7", what,
                  mode(resolved), (long long)got);
        }
        if (r.value) east_value_release(r.value);
        eval_result_free(&r);
    }
    size_t after = tracked_after_collection();
    CHECK(after == before, "%s (%s): %lld tracked values outlived %d calls", what, mode(resolved),
          (long long)after - (long long)before, CALLS);
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

/* A chain of closures, each bound in the frame the next one holds, closed
 * into a cycle — the first frame binds the last closure — and held from
 * outside at that last one. A collection counts the chain's frames, so it
 * rescues every link from the one held; it walks them from its own stack,
 * which a rescue on the C stack, a few calls a link, could not survive at this
 * length. Dropped, the cycle goes whole with the next collection. */
static void test_long_chain(void)
{
    enum { LINKS = 100000 };
    size_t before = tracked_after_collection();
    Environment *first = env_new(NULL);
    EastValue *last = NULL;
    for (int k = 0; k < LINKS; k++) {
        Environment *frame = k == 0 ? first : env_new(NULL);
        if (last) {
            env_set(frame, "g", last);
            east_value_release(last);
        }
        EastCompiledFn *fn = calloc(1, sizeof(EastCompiledFn));
        fn->captures = frame; /* takes the frame's first reference */
        last = east_function_value(fn);
    }
    env_set(first, "g", last);

    east_gc_collect_full();
    CHECK(east_gc_tracked_count() - before == LINKS,
          "a held chain of %d closures kept %zu of them through a collection", LINKS,
          east_gc_tracked_count() - before);
    east_value_release(last);
    size_t after = tracked_after_collection();
    CHECK(after == before, "a dropped chain of %d closures left %lld tracked values", LINKS,
          (long long)after - (long long)before);
}

/* What `n` passes of a shape give. */
static int64_t passes(int64_t n)
{
    return n;
}

static int64_t counter_sum(int64_t n)
{
    return n * (n - 1) / 2;
}

static int64_t escape_sum(int64_t n)
{
    return n * (n + 1) / 2 + 6;
}

/* How long a loop runs before expect_flat checks it. A shape whose cycles go
 * as each pass ends holds nothing however long it runs, so it runs long enough
 * for the slowest leak to show: a cycle each young collection, what a cycle a
 * collection finds alive — and so promotes — costs when it dies old. A shape
 * only the cycle collector reclaims runs into that limit, since a single call
 * never runs a full collection (#1013): it runs long enough for a cycle a pass
 * to show, and no longer. */
#define FLAT_PASSES 200000
#define COLLECTED_PASSES 5000

/* The loops that bind a closure in a composite on every pass (#1010). */
static const struct {
    IRNode *(*build)(void);
    int64_t (*gives)(int64_t n);
    int64_t flat; /* how long expect_flat runs it */
    const char *what;
} composite_shapes[] = {
    {loop_closed_in_struct, passes, FLAT_PASSES, "a closed function in a struct bound per pass"},
    {loop_open_in_struct, counter_sum, FLAT_PASSES, "an open closure in a struct bound per pass"},
    {loop_open_bound_and_in_struct, counter_sum, FLAT_PASSES,
     "an open closure bound, and in a struct, per pass"},
    {loop_open_in_array, counter_sum, FLAT_PASSES, "an open closure in an array bound per pass"},
    {loop_open_in_dict, counter_sum, FLAT_PASSES, "an open closure in a dict bound per pass"},
    {loop_open_in_ref, counter_sum, FLAT_PASSES, "an open closure in a ref bound per pass"},
    {loop_nested, counter_sum, FLAT_PASSES, "an open closure in a struct, a loop in each pass"},
    {escape_mid_loop, escape_sum, FLAT_PASSES, "a pass's struct kept past the loop"},
    {escape_then_drop, counter_sum, COLLECTED_PASSES, "a pass's struct kept until the next pass"},
};

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

    for (size_t s = 0; s < sizeof(composite_shapes) / sizeof(composite_shapes[0]); s++) {
        expect_no_leak(composite_shapes[s].build, 200, 5, composite_shapes[s].gives(200),
                       composite_shapes[s].what, resolved);
        expect_flat(composite_shapes[s].build, composite_shapes[s].flat,
                    composite_shapes[s].gives(composite_shapes[s].flat), composite_shapes[s].what,
                    resolved);
    }
    expect_escape(returns_holder, its_fn, "a closure in a struct returned from its block",
                  resolved);
    expect_escape(returns_bound, itself, "a closure bound in its frame and returned", resolved);
}

int main(void)
{
    init_types();

    run_all(true);
    run_all(false);
    test_open_functions();
    test_long_chain();

    east_gc_collect_full();
    east_type_registry_clear();

    if (failures > 0) {
        fprintf(stderr, "%d failure(s)\n", failures);
        return 1;
    }
    printf("closure frames gate: all checks passed\n");
    return 0;
}
