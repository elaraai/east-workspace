/*
 * Nested-loop projection gate.
 *
 * east_beast2_projection_for_loop derives, from a paged loop's body, the
 * struct fields it reads from the loop variable. It now follows an inner
 * loop into a nested Array<Struct> (or a Dict's value): `for l in r.lines`
 * binds `l` to the element mask of `lines`, so the items narrow to the
 * fields the inner body reads; `r.lines.size()` narrows them to nothing.
 * The escape rules that keep a projection sound are pinned here too — an
 * inner variable used whole marks its own subtree whole, the row used whole
 * still declines, and a binder that shadows a live variable declines — and
 * a projected decode of a small paged blob must agree with the whole decode
 * on every field the body reads.
 *
 * Run under ASan/LSan for the mask, plan and value lifetimes.
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

/* ----- the row shape: { id, f1, lines: Array<Item>, tags: Dict<String, Item> } ----- */

static EastType *item_t, *row_t, *rows_t;

static void build_types(void)
{
    const char *inames[3] = {"sku", "qty", "price"};
    EastType *itypes[3] = {&east_string_type, &east_integer_type, &east_float_type};
    item_t = east_struct_type(inames, itypes, 3);
    EastType *lines_t = east_array_type(item_t);
    EastType *tags_t = east_dict_type(&east_string_type, item_t);
    const char *rnames[4] = {"id", "f1", "lines", "tags"};
    EastType *rtypes[4] = {&east_integer_type, &east_float_type, lines_t, tags_t};
    row_t = east_struct_type(rnames, rtypes, 4);
    rows_t = east_array_type(row_t);
}

/* IR building blocks (types on nodes are not what the walker reads). */
static IRNode *var(const char *name)
{
    return ir_variable(&east_null_type, name, false, false);
}
static IRNode *field(IRNode *expr, const char *name)
{
    IRNode *n = ir_get_field(&east_null_type, expr, name);
    ir_node_release(expr);
    return n;
}
static IRNode *let(const char *name, IRNode *value)
{
    IRNode *n = ir_let(&east_null_type, name, false, false, value);
    ir_node_release(value);
    return n;
}
static IRNode *block2(IRNode *a, IRNode *b)
{
    IRNode *stmts[2] = {a, b};
    IRNode *n = ir_block(&east_null_type, stmts, b ? 2 : 1);
    ir_node_release(a);
    if (b) ir_node_release(b);
    return n;
}
static IRNode *for_array(const char *v, IRNode *array, IRNode *body)
{
    IRNode *n = ir_for_array(&east_null_type, v, NULL, array, body, NULL);
    ir_node_release(array);
    ir_node_release(body);
    return n;
}
static IRNode *for_dict(const char *k, const char *v, IRNode *dict, IRNode *body)
{
    IRNode *n = ir_for_dict(&east_null_type, k, v, dict, body, NULL);
    ir_node_release(dict);
    ir_node_release(body);
    return n;
}
static IRNode *size_of(const char *builtin, IRNode *arg)
{
    IRNode *args[1] = {arg};
    IRNode *n = ir_builtin(&east_integer_type, builtin, NULL, 0, args, 1);
    ir_node_release(arg);
    return n;
}
static IRNode *assign(const char *name, IRNode *value)
{
    IRNode *n = ir_assign(&east_null_type, name, value);
    ir_node_release(value);
    return n;
}

/* The narrowed row type for `body` iterating `r` over rows_t, or NULL when
 * the projection declines. */
static EastType *narrowed_row(IRNode *body, const char *what, bool *declined)
{
    Beast2Projection *pr = east_beast2_projection_for_loop(body, "r", rows_t);
    *declined = pr == NULL;
    if (!pr) return NULL;
    EastType *root = east_beast2_projection_root_type(pr);
    EastType *row = root->kind == EAST_TYPE_ARRAY ? root->data.element : NULL;
    CHECK(row && row->kind == EAST_TYPE_STRUCT, "%s: projected root is not Array<Struct>", what);
    east_beast2_projection_free(pr);
    return row;
}

static EastType *struct1(const char *n0, EastType *t0)
{
    const char *names[1] = {n0};
    EastType *types[1] = {t0};
    return east_struct_type(names, types, 1);
}

static void test_inference(void)
{
    bool declined;

    /* for l in r.lines: let x = l.price   ==>  { lines: Array<{ price }> } */
    IRNode *a = for_array("l", field(var("r"), "lines"), let("x", field(var("l"), "price")));
    EastType *got = narrowed_row(a, "inner read", &declined);
    EastType *want = struct1("lines", east_array_type(struct1("price", &east_float_type)));
    CHECK(!declined && got && east_type_equal(got, want),
          "inner read: items must narrow to the field the inner body reads");
    ir_node_release(a);

    /* let n = r.lines.size()   ==>  { lines: Array<{}> } */
    IRNode *b = let("n", size_of("ArraySize", field(var("r"), "lines")));
    got = narrowed_row(b, "size", &declined);
    want = struct1("lines", east_array_type(east_struct_type(NULL, NULL, 0)));
    CHECK(!declined && got && east_type_equal(got, want),
          "size: a sized array's items must narrow to an empty struct");
    ir_node_release(b);

    /* for l in r.lines: let x = l   ==>  { lines: Array<Item> } (l escapes) */
    IRNode *c = for_array("l", field(var("r"), "lines"), let("x", var("l")));
    got = narrowed_row(c, "inner escape", &declined);
    want = struct1("lines", east_array_type(item_t));
    CHECK(!declined && got && east_type_equal(got, want),
          "inner escape: an escaping item keeps its subtree whole, the row still narrows");
    ir_node_release(c);

    /* for (k, v) in r.tags: let x = v.qty   ==>  { tags: Dict<String, { qty }> } */
    IRNode *d = for_dict("k", "v", field(var("r"), "tags"), let("x", field(var("v"), "qty")));
    got = narrowed_row(d, "dict value", &declined);
    want = struct1("tags", east_dict_type(&east_string_type, struct1("qty", &east_integer_type)));
    CHECK(!declined && got && east_type_equal(got, want),
          "dict value: a dict's values narrow to what the body reads; keys stay whole");
    ir_node_release(d);

    /* for l in r.lines: l = ...   ==>  declined (a target is assigned) */
    IRNode *e = for_array("l", field(var("r"), "lines"), assign("l", field(var("r"), "id")));
    got = narrowed_row(e, "assign", &declined);
    CHECK(declined, "assign: rebinding an inner variable must decline");
    ir_node_release(e);

    /* let x = r   ==>  declined (the row escapes) */
    IRNode *f = let("x", var("r"));
    got = narrowed_row(f, "row escape", &declined);
    CHECK(declined, "row escape: the row used whole must decline");
    ir_node_release(f);

    /* for l in r.lines: let r = l.price   ==>  declined (shadows the row) */
    IRNode *g = for_array("l", field(var("r"), "lines"), let("r", field(var("l"), "price")));
    got = narrowed_row(g, "shadow", &declined);
    CHECK(declined, "shadow: a binder taking a live variable's name must decline");
    ir_node_release(g);

    /* for l in r.lines: let x = l.price; let y = r.f1  ==>  { f1, lines: Array<{ price }> } */
    IRNode *h = block2(for_array("l", field(var("r"), "lines"), let("x", field(var("l"), "price"))),
                       let("y", field(var("r"), "f1")));
    got = narrowed_row(h, "mixed", &declined);
    {
        const char *names[2] = {"f1", "lines"};
        EastType *types[2] = {&east_float_type,
                              east_array_type(struct1("price", &east_float_type))};
        want = east_struct_type(names, types, 2);
    }
    CHECK(!declined && got && east_type_equal(got, want),
          "mixed: row fields and narrowed items combine in wire order");
    ir_node_release(h);
}

/* A two-row paged blob, decoded whole and through the inner-read plan: the
 * fields the body reads must agree, and the projected items hold only them. */
static void test_decode_agrees(void)
{
    /* rows[i] = { id: i, f1: i + 0.5, lines: [ {sku, qty, price} x 2 ], tags: {} } */
    EastValue *rows = east_array_new(row_t);
    for (int64_t i = 0; i < 2; i++) {
        EastValue *lines = east_array_new(item_t);
        for (int64_t j = 0; j < 2; j++) {
            char sku[16];
            snprintf(sku, sizeof sku, "S%lld-%lld", (long long)i, (long long)j);
            const char *inames[3] = {"sku", "qty", "price"};
            EastValue *ivals[3] = {east_string(sku), east_integer(j),
                                   east_float((double)(i * 10 + j))};
            EastValue *item = east_struct_new(inames, ivals, 3, item_t);
            east_array_push(lines, item);
            east_value_release(item);
            for (int k = 0; k < 3; k++)
                east_value_release(ivals[k]);
        }
        EastValue *tags = east_dict_new(&east_string_type, item_t);
        const char *rnames[4] = {"id", "f1", "lines", "tags"};
        EastValue *rvals[4] = {east_integer(i), east_float((double)i + 0.5), lines, tags};
        EastValue *row = east_struct_new(rnames, rvals, 4, row_t);
        east_array_push(rows, row);
        east_value_release(row);
        for (int k = 0; k < 4; k++)
            east_value_release(rvals[k]);
    }
    ByteBuffer *blob = east_beast2_encode_paged(rows, rows_t, EAST_BEAST2_CODEC_DEFLATE, 0);
    east_value_release(rows);
    CHECK(blob != NULL, "decode: paged encode failed");
    if (!blob) return;

    Beast2Pages *pages = east_beast2_pages_new(blob->data, blob->len, rows_t);
    CHECK(pages != NULL, "decode: pager open failed");
    IRNode *body = for_array("l", field(var("r"), "lines"), let("x", field(var("l"), "price")));
    Beast2Projection *pr = east_beast2_projection_for_loop(body, "r", rows_t);
    CHECK(pr != NULL, "decode: the inner-read plan must exist");
    if (pages && pr) {
        EastValue *whole = east_beast2_pages_segment(pages, 0);
        EastValue *narrow = east_beast2_pages_segment_projected(pages, 0, pr);
        CHECK(whole && narrow, "decode: both decodes must succeed");
        if (whole && narrow) {
            CHECK(east_array_len(whole) == 2 && east_array_len(narrow) == 2,
                  "decode: both hold two rows");
            for (size_t i = 0; i < 2; i++) {
                EastValue *wl = east_struct_get_field(east_array_get(whole, i), "lines");
                EastValue *nl = east_struct_get_field(east_array_get(narrow, i), "lines");
                CHECK(wl && nl && east_array_len(wl) == 2 && east_array_len(nl) == 2,
                      "decode: row %zu keeps its two items", i);
                for (size_t j = 0; wl && nl && j < 2; j++) {
                    EastValue *wi = east_array_get(wl, j), *ni = east_array_get(nl, j);
                    CHECK(ni->data.struct_.num_fields == 1, "decode: projected item has one field");
                    EastValue *wp = east_struct_get_field(wi, "price");
                    EastValue *np = east_struct_get_field(ni, "price");
                    CHECK(wp && np && wp->data.float64 == np->data.float64,
                          "decode: row %zu item %zu price agrees", i, j);
                }
            }
            /* The row's other fields are gone from the projected row. */
            EastValue *nrow = east_array_get(narrow, 0);
            CHECK(nrow->data.struct_.num_fields == 1 && east_struct_get_field(nrow, "id") == NULL,
                  "decode: the projected row holds only `lines`");
        }
        if (whole) east_value_release(whole);
        if (narrow) east_value_release(narrow);
    }
    if (pr) east_beast2_projection_free(pr);
    ir_node_release(body);
    if (pages) east_beast2_pages_free(pages);
    byte_buffer_free(blob);
}

int main(void)
{
    east_type_of_type_init();
    build_types();

    test_inference();
    test_decode_agrees();

    east_type_registry_clear();
    if (failures > 0) {
        fprintf(stderr, "%d failure(s)\n", failures);
        return 1;
    }
    printf("nested projection gate: all checks passed\n");
    return 0;
}
