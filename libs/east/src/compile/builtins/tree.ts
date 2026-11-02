/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/* The walks the Array, Set and Dict `toTree` builtins, and the Array and Dict
 * `flattenTree` builtins, share. */

/**
 * The walk behind `toTree`, over each element's parent: `parents[i]` is the
 * source index of element i's parent, or -1 for a root (a `none` parent, or
 * an orphan whose parent key is not in the collection).
 *
 * `order` is the order `build` runs in — every element after its children,
 * siblings in source order, the roots' subtrees in source order — found by
 * an iterative walk from each root, so a deep tree costs no stack. An
 * element no root reaches lies on a cycle or below one; `cycle` is then the
 * first element in source order ON a cycle, else -1. `childCounts[i]` is how
 * many children element i has.
 *
 * @internal
 */
export function treeOrder(parents: Int32Array): { order: Int32Array, childCounts: Int32Array, cycle: number } {
  const n = parents.length;
  // each element's children, contiguous and in source order
  const childCounts = new Int32Array(n);
  let rootCount = 0;
  for (let i = 0; i < n; i++) {
    const p = parents[i]!;
    if (p < 0) rootCount += 1;
    else childCounts[p]! += 1;
  }
  const childStart = new Int32Array(n + 1);
  for (let i = 0; i < n; i++) childStart[i + 1] = childStart[i]! + childCounts[i]!;
  const children = new Int32Array(n - rootCount);
  const roots = new Int32Array(rootCount);
  const fill = childStart.slice(0, n);
  for (let i = 0, r = 0; i < n; i++) {
    const p = parents[i]!;
    if (p < 0) roots[r++] = i;
    else children[fill[p]!++] = i;
  }
  // the post-order: a stack of elements, each with the next child to visit
  const order = new Int32Array(n);
  const stack = new Int32Array(n);
  const next = childStart.slice(0, n);
  let emitted = 0;
  for (let r = 0; r < rootCount; r++) {
    let top = 0;
    stack[0] = roots[r]!;
    while (top >= 0) {
      const v = stack[top]!;
      if (next[v]! < childStart[v + 1]!) {
        stack[++top] = children[next[v]!++]!;
      } else {
        order[emitted++] = v;
        top -= 1;
      }
    }
  }
  if (emitted === n) return { order, childCounts, cycle: -1 };
  // An unreached element's parent is unreached too, so following parents
  // from one ends on a cycle. Walk from each unvisited element in source
  // order, stamping the walk's elements; meeting this walk's own stamp
  // closes a new cycle, which is marked all the way round.
  const stamp = new Int32Array(n);
  for (let k = 0; k < emitted; k++) stamp[order[k]!] = -1;
  const onCycle = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    if (stamp[i] !== 0) continue;
    let v = i;
    while (stamp[v] === 0) {
      stamp[v] = i + 1;
      v = parents[v]!;
    }
    if (stamp[v] === i + 1) {
      let u = v;
      do {
        onCycle[u] = 1;
        u = parents[u]!;
      } while (u !== v);
    }
  }
  return { order, childCounts, cycle: onCycle.indexOf(1) };
}

/**
 * Runs `toTree`'s `build` over {@link treeOrder}'s order; each element's
 * children are the top of the stack of built nodes, in source order, and the
 * roots are what remains.
 *
 * @internal
 */
export function buildTree(order: Int32Array, childCounts: Int32Array, build: (i: number, children: any[]) => any): any[] {
  const built: any[] = [];
  for (let k = 0; k < order.length; k++) {
    const i = order[k]!;
    const children = built.splice(built.length - childCounts[i]!, childCounts[i]!);
    built.push(build(i, children));
  }
  return built;
}

/**
 * The walk behind `flattenTree`: every node of a tree of any depth, depth
 * first — each node before its descendants, siblings in the order their
 * collection holds them — by an explicit stack, so a deep tree costs no stack.
 *
 * `roots` are the root nodes, each with its step: its key, or its index.
 * `visit` sees each node with its path of steps from its root, a new array of
 * its own, and then `children` gives the node's own children, with their
 * steps, which are visited before the node's next sibling.
 *
 * @internal
 */
export function walkTree<S, N>(
  roots: readonly (readonly [S, N])[],
  children: (node: N, step: S) => readonly (readonly [S, N])[],
  visit: (path: S[], node: N) => void,
): void {
  // The nodes still to visit, the next on top: a node's children are pushed last first.
  const stack: [S[], N][] = [];
  for (let i = roots.length - 1; i >= 0; i--) stack.push([[roots[i]![0]], roots[i]![1]]);
  while (stack.length > 0) {
    const [path, node] = stack.pop()!;
    visit(path, node);
    const own = children(node, path[path.length - 1]!);
    for (let i = own.length - 1; i >= 0; i--) stack.push([[...path, own[i]![0]], own[i]![1]]);
  }
}
