# `@elaraai/east-ui-patterns-components`

React (Chakra v3) renderers for the decision-quality patterns declared in [`@elaraai/east-ui-patterns`](../east-ui-patterns).

## What this package is

The React side of the East-UI extension symmetry. Each pattern's `EastUI.component` carrier in `@elaraai/east-ui-patterns` is paired with a React component here, registered against the carrier at module load via `implementUIComponent`.

```
patterns package    →    EastUI.component("DecisionBrief", DecisionBriefValueType)
                                  │
                                  │  registered via implementUIComponent
                                  ▼
this package        →    EastChakraDecisionBrief (React + Chakra)
```

The `<EastChakraComponent>` dispatcher in `@elaraai/east-ui-components` resolves any East UI value (including `Decision.Brief({...})`) to the registered renderer, decodes the schema-typed payload, and hands it off as `value: ValueTypeOf<typeof DecisionBriefValueType>`.

## Layout

```
src/
  decision/
    brief/
      view.tsx           — EastChakraDecisionBrief + implementUIComponent registration
      index.ts           — re-exports
  reference/             — Reference.* renderers (planned)
  judgement/             — Judgement.* renderers (planned)
  stakes/                — Stakes.* renderers (planned)
  index.ts               — side-effect imports of every view module
```

## Wiring

The package's `index.ts` side-effect imports each view module, which calls `implementUIComponent(...)` at module load. Consumers do **one** import to register every renderer:

```tsx
import "@elaraai/east-ui-patterns-components"; // registers all renderers

import { ChakraProvider } from "@chakra-ui/react";
import { system, EastChakraComponent } from "@elaraai/east-ui-components";
import { Decision } from "@elaraai/east-ui-patterns";

const value = Decision.Brief.Root({ /* ... */ });

<ChakraProvider value={system}>
    <EastChakraComponent value={value} />
</ChakraProvider>
```

## Build

```bash
pnpm build       # vite, outputs dist/{index.js, index.cjs, index.d.ts}
pnpm typecheck   # tsc --noEmit
pnpm lint
```

The `sideEffects` field in `package.json` lists the view modules so bundlers preserve their `implementUIComponent` calls during tree-shaking.

## Theme

This package consumes the canonical Elara Chakra v3 system from `@elaraai/east-ui-components`. The renderers express their styling via `textStyle="..."` / `layerStyle="..."` and the canonical `Button` / `Input` recipe variants — no inline `bg=` / `borderRadius=` chrome.

## Status

Beta. Decision.Brief is the worked example; further families land alongside their declarations in `@elaraai/east-ui-patterns`.
