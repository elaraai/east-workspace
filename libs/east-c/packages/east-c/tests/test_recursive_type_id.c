/*
 * A recursive type's id is the first 62 bits of the SHA-256 of its canonical
 * type table, so one type has one id in every runtime and process. The four
 * ids are pinned in TypeScript's `east/src/type_of_type.recursive_id.spec.ts`
 * and east-py's tests as well: a type built here must get the id TypeScript
 * gives it, and east_type_to_value must write it on the wrapper.
 */
#include <east/east.h>

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

/* μ self. Variant{leaf: Integer, node: Array<self>} */
static EastType *tree_type(void)
{
    EastType *tree = east_recursive_type_new();
    const char *names[] = {"leaf", "node"};
    EastType *types[] = {&east_integer_type, east_array_type(tree)};
    east_recursive_type_set(tree, east_variant_type(names, types, 2));
    return east_recursive_type_intern(tree);
}

/* μ self. Struct{trees: Array<Tree>, name: String, next: Option<self>} */
static EastType *forest_type(EastType *tree)
{
    EastType *forest = east_recursive_type_new();
    const char *option_names[] = {"none", "some"};
    EastType *option_types[] = {&east_null_type, forest};
    const char *names[] = {"trees", "name", "next"};
    EastType *types[] = {east_array_type(tree), &east_string_type,
                         east_variant_type(option_names, option_types, 2)};
    east_recursive_type_set(forest, east_struct_type(names, types, 3));
    return east_recursive_type_intern(forest);
}

/* The id east_type_to_value writes on a recursive type's outermost wrapper. */
static int64_t written_id(EastType *type)
{
    EastValue *value = east_type_to_value(type);
    EastValue *wrapper = value->data.variant.value->data.variant.value;
    int64_t id = east_struct_get_field_idx(wrapper, 0)->data.integer;
    east_value_release(value);
    return id;
}

static void check_id(const char *name, EastType *type, int64_t expected)
{
    int64_t id = east_type_structural_id(type);
    CHECK(id == expected, "%s's id is %lld, TypeScript's is %lld", name, (long long)id,
          (long long)expected);
    int64_t written = written_id(type);
    CHECK(written == expected, "%s is written under %lld, not its id %lld", name,
          (long long)written, (long long)expected);
}

int main(void)
{
    east_type_of_type_init();

    EastType *tree = tree_type();
    check_id("Tree", tree, 1820754330669801663LL);
    check_id("Forest", forest_type(tree), 3797356837675649521LL);
    check_id("EastTypeType", east_type_type, 1407501298113036788LL);
    check_id("IRType", east_ir_type, 4094604686657949362LL);

    /* A type built again, before interning, has the interned one's id. */
    EastType *again = east_recursive_type_new();
    const char *names[] = {"leaf", "node"};
    EastType *types[] = {&east_integer_type, east_array_type(again)};
    east_recursive_type_set(again, east_variant_type(names, types, 2));
    CHECK(east_type_structural_id(again) == east_type_structural_id(tree),
          "a second build of Tree has another id");

    CHECK(east_type_structural_id(&east_integer_type) == -1,
          "a type that is not recursive has an id");

    east_type_registry_clear();

    if (failures == 0) {
        printf("recursive type ids: all checks passed\n");
        return 0;
    }
    printf("recursive type ids: %d check(s) failed\n", failures);
    return 1;
}
