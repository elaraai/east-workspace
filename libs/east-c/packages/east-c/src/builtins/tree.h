/*
 * The walk the Array, Set and Dict `toTree` builtins share (#948) — the port
 * of libs/east/src/compile/builtins/tree.ts. Private to the builtins.
 */
#ifndef EAST_BUILTINS_TREE_H
#define EAST_BUILTINS_TREE_H

#include "east/types.h"
#include "east/values.h"
#include <stdbool.h>
#include <stddef.h>

/* Orders `toTree`'s build over each element's parent: parents[i] is the
 * source index of element i's parent, or -1 for a root (a `none` parent, or
 * an orphan whose parent key is not in the collection).
 *
 * `order` (n entries) receives the order build runs in — every element after
 * its children, siblings in source order, the roots' subtrees in source order
 * — found by an iterative walk, so a deep tree costs no stack.
 * `child_counts` (n entries) receives each element's number of children. An
 * element no root reaches lies on a cycle or below one; *cycle is then the
 * first element in source order ON a cycle, else -1. Returns false when out
 * of memory. */
bool east_tree_order(const ptrdiff_t *parents, size_t n, size_t *order, size_t *child_counts,
                     ptrdiff_t *cycle);

/* Builds one element's node from its children (an Array<N> the callee
 * borrows). Returns the node, owned, or NULL with a builtin error posted. */
typedef EastValue *(*EastTreeBuildFn)(void *ctx, size_t i, EastValue *children);

/* Runs build over east_tree_order's order; each element's children are the
 * top of the stack of built nodes, in source order, and the roots are what
 * remains. Returns the roots as an Array<N> (owned), or NULL with a builtin
 * error posted. */
EastValue *east_tree_build(const size_t *order, const size_t *child_counts, size_t n,
                           EastType *node_type, EastTreeBuildFn build, void *ctx);

/* The index of `key` among a Set's elements or a Dict's keys, which are in
 * East order, or -1 when it is not there. */
ptrdiff_t east_tree_sorted_index(EastValue *collection, EastValue *key);

/* Posts `toTree: <what> <key>`, the key printed as East prints a `key_type`
 * — the message every runtime raises. */
void east_tree_key_error(const char *what, EastValue *key, EastType *key_type);

#endif
