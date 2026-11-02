# Trees from flat rows, and recursion

`toTree`, `flattenTree`, and when recursion is safe. Part of the `east` skill.

## Trees from flat rows, and recursion

`toTree` builds nested data — any depth, your own node type — from rows that
name their key and their parent's key. `build` runs once per row, children
first; the result is the roots in source order.

```typescript
const Row = StructType({ id: StringType, parent: OptionType(StringType), name: StringType });
const Node = RecursiveType(self => StructType({ name: StringType, children: ArrayType(self) }));

const nest = East.function([ArrayType(Row)], ArrayType(Node), ($, rows) =>
    rows.toTree(Node, ($, r) => r.id, ($, r) => r.parent, ($, r, _i, children) => ({ name: r.name, children })));
```

- A row whose parent is `none` is a root, and so is an orphan (its parent key
  is not in the rows). A repeated key ❗ `toTree: duplicate key <key>`; a cycle
  ❗ `toTree: cycle through key <key>` — both before any `build`.
- A non-recursive `Node` folds bottom-up: `IntegerType` with
  `children.sum().add(1n)` is each root's subtree size.

`flattenTree` is the way back: every node of nested data, each with its path
of keys (a Dict's) or indices (an Array's) from its root, depth first — each
node before its descendants, siblings in key or array order. `children` names
a node's children, of the collection's own type.

```typescript
const Part = RecursiveType(self => StructType({ name: StringType, cost: FloatType, parts: DictType(StringType, self) }));

const flat = East.function([DictType(StringType, Part)], ArrayType(StructType({ path: ArrayType(StringType), name: StringType })), ($, parts) =>
    parts.flattenTree(($, part) => part.unwrap().parts).map(($, e) => ({ path: e.path, name: e.node.unwrap().name })));
// [{ path: ["pump"], … }, { path: ["pump", "motor"], … }, { path: ["pump", "motor", "rotor"], … }, { path: ["pump", "seal"], … }]

// A rollup at every root: toTree over the paths, a node's parent its path less its last key
const totals = East.function([DictType(StringType, Part)], ArrayType(FloatType), ($, parts) =>
    parts.flattenTree(($, part) => part.unwrap().parts).toTree(FloatType,
        ($, e) => e.path,
        ($, e) => East.greater(e.path.size(), 1n).ifElse(() => some(e.path.slice(0n, e.path.size().subtract(1n))), () => none),
        ($, e, _i, children) => children.sum().add(e.node.unwrap().cost)));
```

- The result is an Array of `{ path, node }`, not a Dict keyed by path: a Dict
  key is immutable, and a path is an Array.
- `children` runs once per node, in the result's order. The walk is iterative;
  each path is an array of its own, so a chain n deep holds n(n+1)/2 path
  elements.
- **Recursion** — a function calling itself through a captured variable
  (`$.let(fn, FunctionType(...))`, then `$.assign(fn, East.function(...))`) —
  is for shallow depths, in the hundreds. Deeper, a call ❗
  `call stack exhausted: East calls nested too deeply`, a catchable error on
  every runtime. Walk deep data with `$.while`, `toTree` or `flattenTree`, which are iterative;
  the C and Python runtimes still bound a recursive VALUE's depth to tens of
  thousands of levels.
