# Browser floor: ES2023, for iPhones back to iOS 16.4

**Applies to:** every package a browser runs — `east`, `east-web-std`,
`east-ui`, `e3-ui`, `east-ui-components`, `e3-ui-components`, the showcase,
and what an app's bundle takes of e3 (`e3`, `e3-types`, `e3-api-client`, and
with e3-web `e3-web`, `e3-core`, `e3-api-server`, `e3-rack`).

## The rule

An app built on East opens on iPhones back to **iOS 16.4** (ruled 12 Nov
2026). Every browser on an iPhone — Safari, Chrome, Edge, Firefox — runs on
the system's own engine, so the phone's iOS, never the browser's version,
decides which JavaScript it has: a page that works in Edge on one phone can
fail in Edge on another. That engine has every built-in of ES2023 and few of
what came after. So:

**Code a browser runs names no built-in newer than ES2023.**

A built-in the engine lacks is `undefined` there, and the first call throws.
East's `SortedMap` and `SortedSet` — every Dict and Set a page holds — called
`Iterator.from` whenever one was iterated. `Iterator` reached iPhones in iOS
18.4; on anything older, every page stopped at its first draw with `Can't find
variable: Iterator`, in every release until this rule.

## What is newer

TypeScript's library is the list: whatever it declares in `lib.es2024.*.d.ts`,
`lib.es2025.*.d.ts` or `lib.esnext.*.d.ts`. The ones most easily reached for:

| Built-in | Edition |
|---|---|
| `Iterator`, `Iterator.from`, and the iterator helpers — `.map` `.filter` `.take` `.drop` `.flatMap` `.reduce` `.toArray` `.forEach` `.some` `.every` `.find` on what `keys()`, `values()`, `entries()` or a generator returns | ES2025 |
| The Set methods — `union` `intersection` `difference` `symmetricDifference` `isSubsetOf` `isSupersetOf` `isDisjointFrom` | ES2025 |
| `Promise.try`, `RegExp.escape`, `Float16Array`, `Math.f16round`, `Intl.DurationFormat`; a regular expression's modifier groups and a group name used twice | ES2025 |
| `Object.groupBy`, `Map.groupBy`, `Promise.withResolvers`, `ArrayBuffer`'s `transfer` and `resize`, `isWellFormed`, a regular expression's `v` flag | ES2024 |
| `Array.fromAsync`, `Map`'s `getOrInsert`, `Uint8Array`'s base64 and hex, `Error.isError`, `Temporal`, `Symbol.dispose` | proposals |

An iPhone on iOS 16.4 has a handful of these (`Array.fromAsync`, a resizable
`ArrayBuffer`, `isWellFormed`). The rule is the edition all the same: it is
one line to hold, and nothing here needs them.

Spreading or looping over an iterator is ES2015 and fine: `[...map.keys()]`,
`for (const [k, v] of map)`, `Array.from(set)`. Chaining a method onto one is
not: `map.keys().map(…)` is `[...map.keys()].map(…)`.

## How it is held

| Packages | Held by |
|---|---|
| `e3`, `e3-types`, `e3-api-client`, `e3-web`, `e3-core`, `e3-api-server`, `e3-rack`, the showcase | Their `tsconfig.json` compiles against `lib: ES2022`: the compiler refuses a newer built-in. |
| `east`, `east-web-std`, `east-ui`, `e3-ui`, `east-ui-components`, `e3-ui-components` | They compile against the newest library, so the lint rule **`east-floor/browser-floor`** (`libs/east/eslint/browser-floor.js`, in each package's `eslint.config.js`) refuses one. |
| `east` | `make -C libs/east test-floor`, in CI: East's whole suite on an engine with the newer built-ins taken away (`libs/east/test/floor/`). |

A new package a browser runs takes one of the first two.

**The lint rule** reads types. A name is newer exactly when every declaration
of what it resolves to is in one of TypeScript's newer library files, so it
keeps no list of its own: `set.union(…)` on a built-in Set is refused and the
same call on East's `SortedSet` is not; `values.map(…)` on an Array passes and
on a Map's iterator is refused. A type costs nothing at run time and is not
read (`ReadonlySetLike<T>` in a signature). Its cases are
`libs/east/test/lint/browser-floor.spec.ts`. It gives no exemption by comment.

**The floor's engine** is what holds a value typed `any`, where no rule can
see — and East's runtime is `any` throughout. `test/floor/es2023.ts` lists
the newer built-ins by where they live at run time and deletes them before
anything else loads; `test/floor/floor.spec.ts` reads TypeScript's library and
fails while it declares a built-in the list does not account for, so an
upgrade of TypeScript says what to add. A spec that needs a newer built-in
skips that case on the floor's engine, as `src/containers/iterators.spec.ts`
does — it runs every container both ways.

## Doing without, and reading one where it is

Most uses have a plain form of ES2023 or before: a spread, a loop,
`Array.from`, a `Map` filled in a loop. Where the built-in is worth having on
an engine that has it — East's containers return the engine's own iterators,
with their helpers, wherever there are any — read it through a property this
code types as optional, and handle its absence:

```ts
interface IteratorBuiltin {
    from<T>(source: Iterator<T> | Iterable<T>): IteratorObject<T, undefined, unknown>;
}

export function builtinIterator<T>(source: IterableIterator<T>): IteratorObject<T, undefined, unknown> {
    const builtin = (globalThis as { Iterator?: IteratorBuiltin }).Iterator;
    if (builtin === undefined || typeof builtin.from !== "function") {
        return source as unknown as IteratorObject<T, undefined, unknown>;
    }
    return builtin.from(source);
}
```

The read resolves to this code's own declaration, never the library's, so the
rule passes it and the compiler makes the code say what happens without it
(`libs/east/src/containers/iterators.ts`). Read it at each call, never once
as the module loads.

## What none of this holds

- **The web platform.** A DOM or CSS feature has no edition and no versioned
  declaration: check its Safari on iOS column before using one newer than
  16.4, and guard it as the renderers guard theirs — `typeof
  el.checkVisibility === "function"`, `typeof requestIdleCallback ===
  "function"` — with a path that works without it. An event an older engine
  never fires (`scrollend`) needs its fallback too: a scroll's rest is asked of
  `libs/east-ui/packages/e3-ui-components/src/shared/scroll-rest.ts`
  (`onScrollRest`), which hears the event where the engine has it and waits
  for the scroll to stand still where it has none.
- **Syntax.** An app's bundler lowers syntax to its build target and adds no
  built-in: the target is the app's to set no newer than the phones it serves.
- **What an app bundles besides East.** A dependency that names a newer
  built-in fails the same way; no check here reads it.
- **A value typed `any`**, outside `east`.

A release that touches any of these is opened on an iPhone, or a Simulator, at
the floor before it ships.
