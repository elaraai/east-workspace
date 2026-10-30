/*
 * The walks the Array, Set and Dict `toTree` builtins (#948), and the Array
 * and Dict `flattenTree` builtins (#1434), share — the port of
 * libs/east/src/compile/builtins/tree.ts.
 */
#include "tree.h"
#include "east/builtins.h"
#include "east/serialization.h"
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

bool east_tree_order(const ptrdiff_t *parents, size_t n, size_t *order, size_t *child_counts,
                     ptrdiff_t *cycle)
{
    *cycle = -1;
    if (n == 0) return true;
    /* each element's children, contiguous and in source order */
    size_t root_count = 0;
    memset(child_counts, 0, n * sizeof(size_t));
    for (size_t i = 0; i < n; i++) {
        if (parents[i] < 0)
            root_count++;
        else
            child_counts[parents[i]]++;
    }
    size_t *child_start = malloc((n + 1) * sizeof(size_t));
    size_t *next = malloc(n * sizeof(size_t));
    size_t *children = malloc((n - root_count + 1) * sizeof(size_t));
    size_t *roots = malloc((root_count + 1) * sizeof(size_t));
    size_t *stack = malloc(n * sizeof(size_t));
    ptrdiff_t *stamp = NULL;
    uint8_t *on_cycle = NULL;
    bool ok = false;
    if (!child_start || !next || !children || !roots || !stack) goto done;
    child_start[0] = 0;
    for (size_t i = 0; i < n; i++)
        child_start[i + 1] = child_start[i] + child_counts[i];
    memcpy(next, child_start, n * sizeof(size_t)); /* the fill cursor, then the walk's */
    for (size_t i = 0, r = 0; i < n; i++) {
        if (parents[i] < 0)
            roots[r++] = i;
        else
            children[next[parents[i]]++] = i;
    }
    /* the post-order: a stack of elements, each with the next child to visit */
    memcpy(next, child_start, n * sizeof(size_t));
    size_t emitted = 0;
    for (size_t r = 0; r < root_count; r++) {
        size_t top = 1;
        stack[0] = roots[r];
        while (top > 0) {
            size_t v = stack[top - 1];
            if (next[v] < child_start[v + 1]) {
                stack[top++] = children[next[v]++];
            } else {
                order[emitted++] = v;
                top--;
            }
        }
    }
    if (emitted < n) {
        /* An unreached element's parent is unreached too, so following
         * parents from one ends on a cycle. Walk from each unvisited element
         * in source order, stamping the walk's elements; meeting this walk's
         * own stamp closes a new cycle, which is marked all the way round. */
        stamp = calloc(n, sizeof(ptrdiff_t));
        on_cycle = calloc(n, 1);
        if (!stamp || !on_cycle) goto done;
        for (size_t k = 0; k < emitted; k++)
            stamp[order[k]] = -1;
        for (size_t i = 0; i < n; i++) {
            if (stamp[i] != 0) continue;
            size_t v = i;
            while (stamp[v] == 0) {
                stamp[v] = (ptrdiff_t)i + 1;
                v = (size_t)parents[v];
            }
            if (stamp[v] == (ptrdiff_t)i + 1) {
                size_t u = v;
                do {
                    on_cycle[u] = 1;
                    u = (size_t)parents[u];
                } while (u != v);
            }
        }
        for (size_t i = 0; i < n; i++) {
            if (on_cycle[i]) {
                *cycle = (ptrdiff_t)i;
                break;
            }
        }
    }
    ok = true;
done:
    free(child_start);
    free(next);
    free(children);
    free(roots);
    free(stack);
    free(stamp);
    free(on_cycle);
    return ok;
}

EastValue *east_tree_build(const size_t *order, const size_t *child_counts, size_t n,
                           EastType *node_type, EastTreeBuildFn build, void *ctx)
{
    EastType *elem_type = node_type ? node_type : &east_null_type;
    EastValue **built = malloc((n + 1) * sizeof(EastValue *));
    if (!built) {
        east_builtin_error("out of memory");
        return NULL;
    }
    size_t top = 0;
    for (size_t k = 0; k < n; k++) {
        size_t i = order[k];
        size_t count = child_counts[i];
        EastValue *children = east_array_new_with_capacity(elem_type, count);
        for (size_t j = top - count; j < top; j++) {
            east_array_push(children, built[j]);
            east_value_release(built[j]);
        }
        top -= count;
        EastValue *node = build(ctx, i, children);
        east_value_release(children);
        if (!node) {
            for (size_t j = 0; j < top; j++)
                east_value_release(built[j]);
            free(built);
            return NULL;
        }
        built[top++] = node;
    }
    EastValue *roots = east_array_new_with_capacity(elem_type, top);
    for (size_t j = 0; j < top; j++) {
        east_array_push(roots, built[j]);
        east_value_release(built[j]);
    }
    free(built);
    return roots;
}

ptrdiff_t east_tree_sorted_index(EastValue *collection, EastValue *key)
{
    bool is_set = collection->kind == EAST_VAL_SET;
    size_t lo = 0, hi = is_set ? east_set_len(collection) : east_dict_len(collection);
    while (lo < hi) {
        size_t mid = lo + (hi - lo) / 2;
        EastValue *at = is_set ? east_set_at(collection, mid) : east_dict_key_at(collection, mid);
        int c = east_value_compare(at, key);
        if (c == 0) return (ptrdiff_t)mid;
        if (c < 0)
            lo = mid + 1;
        else
            hi = mid;
    }
    return -1;
}

void east_tree_key_error(const char *what, EastValue *key, EastType *key_type)
{
    char *printed = east_print_value(key, key_type);
    const char *shown = printed ? printed : "?";
    size_t len = strlen("toTree: ") + strlen(what) + 1 + strlen(shown) + 1;
    char *msg = malloc(len);
    if (msg) {
        snprintf(msg, len, "toTree: %s %s", what, shown);
        east_builtin_error(msg);
        free(msg);
    } else {
        east_builtin_error("out of memory");
    }
    free(printed);
}

/* One node still to list, with its path of steps: both owned. */
typedef struct {
    EastValue *path;
    EastValue *node;
} FlattenFrame;

typedef struct {
    FlattenFrame *items;
    size_t len;
    size_t cap;
} FlattenStack;

/* Pushes a collection's entries, the last first so the first is listed next,
 * each under `prefix`'s steps (none for the roots). Returns false when out of
 * memory. */
static bool flatten_push(FlattenStack *stack, EastValue *prefix, EastValue *collection)
{
    bool dict = collection->kind == EAST_VAL_DICT;
    size_t len = dict ? east_dict_len(collection) : east_array_len(collection);
    size_t depth = prefix ? east_array_len(prefix) : 0;
    if (stack->len + len > stack->cap) {
        size_t cap = stack->cap ? stack->cap : 16;
        while (cap < stack->len + len)
            cap *= 2;
        FlattenFrame *items = realloc(stack->items, cap * sizeof(FlattenFrame));
        if (!items) return false;
        stack->items = items;
        stack->cap = cap;
    }
    for (size_t j = len; j-- > 0;) {
        EastValue *path = east_array_new_with_capacity(&east_null_type, depth + 1);
        if (!path) return false;
        for (size_t k = 0; k < depth; k++)
            east_array_push(path, east_array_get(prefix, k));
        if (dict) {
            east_array_push(path, east_dict_key_at(collection, j));
        } else {
            EastValue *index = east_integer((int64_t)j);
            east_array_push(path, index);
            east_value_release(index);
        }
        EastValue *node = dict ? east_dict_val_at(collection, j) : east_array_get(collection, j);
        east_value_retain(node);
        stack->items[stack->len++] = (FlattenFrame){.path = path, .node = node};
    }
    return true;
}

EastValue *east_tree_flatten(EastValue *roots, EastTreeChildrenFn children, void *ctx)
{
    static const char *names[] = {"path", "node"};
    FlattenStack stack = {0};
    EastValue *result = east_array_new(&east_null_type);
    if (!result || !flatten_push(&stack, NULL, roots)) goto oom;
    while (stack.len > 0) {
        FlattenFrame frame = stack.items[--stack.len];
        EastValue *fields[] = {frame.path, frame.node};
        EastValue *entry = east_struct_new(names, fields, 2, NULL);
        if (entry) {
            east_array_push(result, entry);
            east_value_release(entry);
        }
        EastValue *step = east_array_get(frame.path, east_array_len(frame.path) - 1);
        EastValue *own = entry ? children(ctx, frame.node, step) : NULL;
        bool pushed = own && flatten_push(&stack, frame.path, own);
        if (own) east_value_release(own);
        east_value_release(frame.path);
        east_value_release(frame.node);
        if (!entry || (own && !pushed)) goto oom;
        if (!own) goto fail;
    }
    free(stack.items);
    return result;
oom:
    east_builtin_error("out of memory");
fail:
    for (size_t i = 0; i < stack.len; i++) {
        east_value_release(stack.items[i].path);
        east_value_release(stack.items[i].node);
    }
    free(stack.items);
    if (result) east_value_release(result);
    return NULL;
}
