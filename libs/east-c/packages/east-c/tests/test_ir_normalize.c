/*
 * IR normalization gate (#627).
 *
 * east_ir_normalize is the round-trip equality contract — the one canonical
 * form every builder's IR converges on. Pins:
 *
 *   1. a TypeScript-shaped program (names `_N` in the lowering's order,
 *      captures listed, captured flags stamped) normalizes to ITSELF once
 *      its loc_ids are zero — the traversal order is the lowering's;
 *   2. a python-shaped twin (its own `__kN`/`__nN` names, a nested function
 *      whose captures list is missing the variable it reads, `captured`
 *      unset, real loc_ids) normalizes to exactly the same value;
 *   3. recursive type ids are renumbered per type value, so two spellings
 *      of one recursive type agree;
 *   4. east_value_diff_path names the first difference by path, and NULL
 *      for equal values;
 *   5. normalization is idempotent.
 */
#include <east/east.h>
#include <east/ir_normalize.h>
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
#define FN_INT_INT "{\"type\":\"Function\",\"value\":{\"inputs\":[" INT "],\"output\":" INT "}}"

/* Variable node: (name, loc, captured) */
#define VAR(name, loc, cap)                                                                        \
    "{\"type\":\"Variable\",\"value\":{\"type\":" INT ",\"loc_id\":\"" loc "\",\"name\":\"" name   \
    "\",\"mutable\":false,\"captured\":" cap "}}"
#define ADD(a, b)                                                                                  \
    "{\"type\":\"Builtin\",\"value\":{\"type\":" INT ",\"loc_id\":\"0\",\"builtin\":"              \
    "\"IntegerAdd\",\"type_parameters\":[],\"arguments\":[" a "," b "]}}"

/* (x) => { const y = x + x; const f = (z) => z + y; return f(x) } */
static const char *TS_SHAPE =
    "{\"type\":\"Function\",\"value\":{\"type\":" FN_INT_INT ",\"loc_id\":\"0\",\"captures\":[],"
    "\"parameters\":[" VAR(
        "_0", "0",
        "false") "],\"body\":{\"type\":\"Block\",\"value\":{"
                 "\"type\":" INT ",\"loc_id\":\"0\",\"statements\":["
                 "{\"type\":\"Let\",\"value\":{\"type\":{\"type\":\"Null\",\"value\":null},\"loc_"
                 "id\":\"0\","
                 "\"variable\":" VAR("_1", "0", "true") ",\"value\":" ADD(
                     VAR("_0", "0", "false"),
                     VAR("_0", "0",
                         "false")) "}},"
                                   "{\"type\":\"Let\",\"value\":{\"type\":{\"type\":\"Null\","
                                   "\"value\":null},\"loc_id\":\"0\","
                                   "\"variable\":{\"type\":\"Variable\",\"value\":{"
                                   "\"type\":" FN_INT_INT ",\"loc_id\":\"0\","
                                   "\"name\":\"_3\",\"mutable\":false,\"captured\":false}},"
                                   "\"value\":{\"type\":\"Function\",\"value\":{"
                                   "\"type\":" FN_INT_INT ",\"loc_id\":\"0\","
                                   "\"captures\":[" VAR("_1", "0", "true") "],\"parameters\":[" VAR(
                                       "_2", "0",
                                       "false") "],"
                                                "\"body\":" ADD(
                                                    VAR("_2", "0", "false"),
                                                    VAR("_1", "0",
                                                        "true")) "}}}},"
                                                                 "{\"type\":\"Call\",\"value\":{"
                                                                 "\"type\":" INT
                                                                 ",\"loc_id\":\"0\","
                                                                 "\"function\":{\"type\":"
                                                                 "\"Variable\",\"value\":{"
                                                                 "\"type\":" FN_INT_INT
                                                                 ",\"loc_id\":\"0\","
                                                                 "\"name\":\"_3\",\"mutable\":"
                                                                 "false,\"captured\":false}},"
                                                                 "\"arguments\":[" VAR(
                                                                     "_0", "0", "false") "]}}]}}}}";

/* The same program as python builds it: its own names, loc_ids, no captures
 * listed on the nested function, no captured flags. */
static const char *PY_SHAPE =
    "{\"type\":\"Function\",\"value\":{\"type\":" FN_INT_INT ",\"loc_id\":\"7\",\"captures\":[],"
    "\"parameters\":[" VAR(
        "__k0", "7",
        "false") "],\"body\":{\"type\":\"Block\",\"value\":{"
                 "\"type\":" INT ",\"loc_id\":\"3\",\"statements\":["
                 "{\"type\":\"Let\",\"value\":{\"type\":{\"type\":\"Null\",\"value\":null},\"loc_"
                 "id\":\"4\","
                 "\"variable\":" VAR("__n5", "4", "false") ",\"value\":" ADD(
                     VAR("__k0", "9", "false"),
                     VAR("__k0", "9",
                         "false")) "}},"
                                   "{\"type\":\"Let\",\"value\":{\"type\":{\"type\":\"Null\","
                                   "\"value\":null},\"loc_id\":\"5\","
                                   "\"variable\":{\"type\":\"Variable\",\"value\":{"
                                   "\"type\":" FN_INT_INT ",\"loc_id\":\"5\","
                                   "\"name\":\"__n9\",\"mutable\":false,\"captured\":false}},"
                                   "\"value\":{\"type\":\"Function\",\"value\":{"
                                   "\"type\":" FN_INT_INT ",\"loc_id\":\"6\","
                                   "\"captures\":[],\"parameters\":[" VAR(
                                       "__n7", "6",
                                       "false") "],"
                                                "\"body\":" ADD(
                                                    VAR("__n7", "8", "false"),
                                                    VAR("__n5", "8",
                                                        "false")) "}}}},"
                                                                  "{\"type\":\"Call\",\"value\":{"
                                                                  "\"type\":" INT
                                                                  ",\"loc_id\":\"2\","
                                                                  "\"function\":{\"type\":"
                                                                  "\"Variable\",\"value\":{"
                                                                  "\"type\":" FN_INT_INT
                                                                  ",\"loc_id\":\"2\","
                                                                  "\"name\":\"__n9\",\"mutable\":"
                                                                  "false,\"captured\":false}},"
                                                                  "\"arguments\":[" VAR(
                                                                      "__k0", "2",
                                                                      "false") "]}}]}}}}";

#define REC(id)                                                                                    \
    "{\"type\":\"Recursive\",\"value\":{\"type\":\"wrapper\",\"value\":{\"id\":\"" id              \
    "\",\"inner\":{\"type\":\"Array\",\"value\":{\"type\":\"Recursive\",\"value\":{\"type\":"      \
    "\"ref\",\"value\":\"" id "\"}}}}}}"
#define REC_VALUE(id)                                                                              \
    "{\"type\":\"Function\",\"value\":{\"type\":{\"type\":\"Function\",\"value\":{\"inputs\":"     \
    "[" REC(id) "],\"output\":" INT                                                                \
                "}},\"loc_id\":\"0\",\"captures\":[],\"parameters\":[{\"type\":"                   \
                "\"Variable\",\"value\":{\"type\":" REC(                                           \
                    id) ",\"loc_id\":\"0\",\"name\":\"_0\",\"mutable\":"                           \
                        "false,\"captured\":false}}],\"body\":{\"type\":\"Value\",\"value\":{"     \
                        "\"type\":" INT                                                            \
                        ",\"loc_id\":\"0\",\"value\":{\"type\":\"Integer\",\"value\":\"1\"}}}}}"

static EastValue *decode(const char *json)
{
    EastValue *v = east_json_decode(json, east_ir_type);
    CHECK(v != NULL, "decode failed for %.60s", json);
    return v;
}

int main(void)
{
    east_type_of_type_init();

    EastValue *ts = decode(TS_SHAPE);
    EastValue *py = decode(PY_SHAPE);
    if (!ts || !py) return 1;

    /* 1. a TypeScript-shaped program is its own normal form */
    EastValue *ts_n = east_ir_normalize(ts);
    CHECK(ts_n != NULL, "normalize(ts) returned NULL");
    char *d = east_value_diff_path(ts, ts_n);
    CHECK(d == NULL, "TS-shaped program did not normalize to itself: differs at %s", d);
    free(d);

    /* 2. the python-shaped twin converges on the same value */
    EastValue *py_n = east_ir_normalize(py);
    CHECK(py_n != NULL, "normalize(py) returned NULL");
    d = east_value_diff_path(ts_n, py_n);
    CHECK(d == NULL, "python-shaped program differs from the TS form at %s", d);
    free(d);
    d = east_value_diff_path(ts, py);
    CHECK(d != NULL, "the raw shapes must differ (loc_ids, names)");
    CHECK(d && strcmp(d, "$(Function).loc_id") == 0, "first raw difference path: %s", d);
    free(d);

    /* 5. idempotent */
    EastValue *py_nn = east_ir_normalize(py_n);
    d = east_value_diff_path(py_n, py_nn);
    CHECK(d == NULL, "normalize is not idempotent: %s", d);
    free(d);

    /* 3. recursive ids renumber per type value */
    EastValue *r1 = decode(REC_VALUE("17"));
    EastValue *r2 = decode(REC_VALUE("4242"));
    if (r1 && r2) {
        EastValue *r1n = east_ir_normalize(r1);
        EastValue *r2n = east_ir_normalize(r2);
        d = east_value_diff_path(r1n, r2n);
        CHECK(d == NULL, "recursive ids not canonical: %s", d);
        free(d);
        d = east_value_diff_path(r1, r2);
        CHECK(d != NULL, "raw recursive spellings must differ");
        free(d);
        east_value_release(r1n);
        east_value_release(r2n);
        east_value_release(r1);
        east_value_release(r2);
    }

    /* 4. the diff path names the first difference */
    EastValue *v1 = decode("{\"type\":\"Value\",\"value\":{\"type\":" INT
                           ",\"loc_id\":\"0\",\"value\":{\"type\":\"Integer\",\"value\":\"1\"}}}");
    EastValue *v2 = decode("{\"type\":\"Value\",\"value\":{\"type\":" INT
                           ",\"loc_id\":\"0\",\"value\":{\"type\":\"Integer\",\"value\":\"2\"}}}");
    if (v1 && v2) {
        d = east_value_diff_path(v1, v2);
        CHECK(d && strcmp(d, "$(Value).value(Integer)") == 0, "diff path: %s", d);
        free(d);
        east_value_release(v1);
        east_value_release(v2);
    }

    east_value_release(py_nn);
    east_value_release(py_n);
    east_value_release(ts_n);
    east_value_release(ts);
    east_value_release(py);
    east_type_registry_clear();

    if (failures) {
        fprintf(stderr, "%d failure(s)\n", failures);
        return 1;
    }
    printf("test_ir_normalize: OK\n");
    return 0;
}
