# `@elaraai/east-ui-patterns`

Decision-quality UI patterns for the East language. Pattern declarations only — pure East types and `EastUI.component` carriers, with no React or Chakra dependency. The React renderers live in [`@elaraai/east-ui-patterns-components`](../east-ui-patterns-components).

## What's a "decision-quality pattern"?

A reusable UI shape that helps a frontline business decision-maker accept, modify, or override a model recommendation with confidence — fast, with reasoning captured for accountability. Each pattern in this package is one such shape, declared as an `EastUI.component(name, schema, …)` so that:

- **East programs author them as data.** `Decision.Brief({ value: { … } })` returns a `UIComponent` IR that east-ui dispatches.
- **Renderers are swappable.** Today, Chakra+React via `@elaraai/east-ui-patterns-components`. Tomorrow, terminal / native / PDF — same value type, different renderer.
- **Slot contracts are East types.** No prop drilling against React types; `ValueTypeOf<typeof Decision.Brief.Component.schema>` is the slot type.

## Layout

```
src/
  decision/
    brief/
      types.ts       — DecisionBriefValueType (StructType)
      component.ts   — Decision.Brief = EastUI.component("DecisionBrief", DecisionBriefValueType)
      index.ts       — re-exports
  reference/         — Reference.* family (planned)
  judgement/         — Judgement.* family (planned)
  stakes/            — Stakes.* family (planned)
  index.ts           — namespace bundles
```

Each pattern is a folder under its family. The `types.ts` file is the contract; `component.ts` wraps it as an `EastUI.component`; `index.ts` re-exports the public surface.

## Authoring a pattern (East-side)

```typescript
import { East, UIComponentType } from "@elaraai/east-ui";
import { Decision } from "@elaraai/east-ui-patterns";

const myScreen = East.function([], UIComponentType, ($) => {
    return Decision.Brief({
        claim: "Move 3 SE shifts from **Patel** → **Cho** for week of May 11",
        because: [
            { reason: "SE-1 forecast +14% vs base", accent: some("13.6k vs 11.9k units") },
            // ...
        ],
        upside: "**−$8.4k** overtime saved this week",
        risks:    none,
        unknowns: none,
        stakes:   { /* … */ },
        ask:      { apply: { label: "Apply", key: some("⏎") }, /* … */ },
        accent:   some(variant("brand", null)),
    });
});
```

## Wiring a renderer (React-side)

In `@elaraai/east-ui-patterns-components`:

```tsx
import { implementUIComponent } from "@elaraai/east-ui-components";
import { Decision } from "@elaraai/east-ui-patterns";
import { EastChakraDecisionBrief } from "./decision/brief/view";

implementUIComponent(Decision.Brief.Component, EastChakraDecisionBrief);
```

The renderer module's `index.ts` side-effect imports each registration so the dispatcher resolves them at module load.

## Family namespaces

| Family       | Lives in    | Purpose |
|--------------|-------------|---------|
| `Decision.*` | Decide / Observe / Frame & trust | Brief, Queue, Journal — "things about the user's decision" |
| `Reference.*`| Decide      | Similar, Peers, Base, Novelty, Lesson — "context from comparable past" |
| `Judgement.*`| Decide      | Prompt, KnowledgePanel, Gap, Inject — "human input alongside the rec" |
| `Stakes.*`   | Decide      | Tag, Radius — "decision consequence in human terms" |

Built one at a time. Decision.Brief is the first and the worked example.

## Build

```bash
pnpm build       # tsc, outputs dist/src
pnpm test        # build + lint + node --test
pnpm lint
```

## Status

Beta. The Decision.Brief contract is in flight; expect changes until it hits 1.0.
