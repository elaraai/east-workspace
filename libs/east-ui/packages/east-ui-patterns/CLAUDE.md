# CLAUDE.md — `@elaraai/east-ui-patterns`

Decision-quality UI patterns for East. Pure East declarations, no React.

## What this package is

The East-side declaration of every decision-quality pattern. Each pattern is an `EastUI.component(name, schema, …)` carrier whose schema is a canonical East type. Pattern authors use the public factory (`Decision.Brief({ … })`) to produce a `UIComponent` IR; renderers (in `@elaraai/east-ui-patterns-components`) implement how that IR draws.

This package has **no React, no Chakra, no DOM dependencies**. East programs depending on it can ship to non-React surfaces (terminal, native, PDF) using a different renderer package.

## Conventions

### Per-pattern file layout

```
src/<family>/<pattern>/
  types.ts        — East types: <Pattern>ValueType, sub-types, escape hatches.
  component.ts    — <Family>.<Pattern> = EastUI.component(name, schema, …)
                    Public Root factory wrapping Component.Root with ergonomic args.
  index.ts        — re-exports
```

### Naming

- East types: `<Pattern>ValueType` (e.g. `DecisionBriefValueType`), and sub-types like `DecisionBriefReasonType`, `DecisionBriefAccentType`.
- The carrier: `<Family>.<Pattern>.Component` (e.g. `Decision.Brief.Component`). Renderers register against `.Component`.
- The factory: `<Family>.<Pattern>` is callable — it accepts `SubtypeExprOrValue<<Pattern>ValueType>` and returns `ExprType<UIComponentType>`.

### String-typed slots accept GitHub-flavored markdown

Any field of type `StringType` in a pattern's schema is rendered as inline GFM markdown (`**bold**`, `*italic*`, `` `code` ``, `[link](url)`, `~~strike~~`). Block-level markdown is not supported in inline slots — multi-paragraph slots, when they exist, are explicitly typed as `ArrayType(StringType)` with one paragraph per element.

### Variant tags

Where a pattern has a small enum of choices (e.g. `DecisionBriefAccentType` is `"brand" | "warn" | "danger"`), use `VariantType({ brand: NullType, warn: NullType, danger: NullType })`. Renderers switch on `.type`.

### Optional slots

Use `OptionType(T)` (which is `VariantType({ some: T, none: NullType })`). Pattern authors pass `some(value)` or `none`. Renderers unwrap with `.type === "some" ? .value : fallback`.

## Authoring a new pattern

1. **Declare the slot types** in `src/<family>/<pattern>/types.ts`:
   ```typescript
   import { StructType, StringType, OptionType, ArrayType } from "@elaraai/east";

   export const MyPatternValueType = StructType({
       title: StringType,
       items: ArrayType(StringType),
       // …
   });
   ```

2. **Wrap as an EastUI.component** in `src/<family>/<pattern>/component.ts`:
   ```typescript
   import { EastUI } from "@elaraai/east-ui";
   import { MyPatternValueType } from "./types.js";

   export const MyPatternComponent = EastUI.component(
       "MyPattern",
       MyPatternValueType,
       { optional: true },  // renderer registration not required at compile-time
   );
   ```

3. **Re-export through the family namespace** in `src/<family>/index.ts`:
   ```typescript
   import { MyPatternComponent } from "./mypattern/component.js";

   export const MyFamily = {
       MyPattern: Object.assign(MyPatternComponent.Root, {
           Component: MyPatternComponent,
           Schema: MyPatternValueType,
       }),
   };
   ```

4. **Register a renderer** in `@elaraai/east-ui-patterns-components`:
   ```tsx
   import { implementUIComponent } from "@elaraai/east-ui-components";
   import { MyFamily } from "@elaraai/east-ui-patterns";
   import { EastChakraMyPattern } from "./view";

   implementUIComponent(MyFamily.MyPattern.Component, EastChakraMyPattern);
   ```

## Build

`tsc`. No Vite (this package emits pure ESM with no JSX). Output goes to `dist/src/` to match the package.json `main` entry.

```bash
pnpm build       # tsc — emits dist/
pnpm test        # build + lint + node --test
pnpm lint
```

## Status

Beta. Decision.Brief is the worked example; Reference.*, Judgement.*, Stakes.* land one at a time as the contract proves out.
