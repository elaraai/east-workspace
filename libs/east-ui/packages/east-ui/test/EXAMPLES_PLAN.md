# East UI Examples Plan — the five-slot structure

The original file-by-file authoring plan that seeded this corpus was
retired when epic #455 consolidated the examples (755 → ~half) to the
**five-slot structure**. The canonical rules live in
[`EXAMPLES_AUTHORING.md §8`](../../../../../docs/conventions/EXAMPLES_AUTHORING.md#8-consolidation-the-five-example-slots-east-ui--e3-ui)
and the UI deltas in [`CLAUDE.md`](CLAUDE.md); this file is the working
summary for anyone adding or changing examples here.

## The five slots per component

| Slot | Name | Content |
|---|---|---|
| 1 | `<name>Basic` | Smallest meaningful usage — the search-index front door. |
| 2 | `<name>Variants` | ONE static enumeration panel: every enumerable visual variant as a captioned row (`VStack gap="4"` of rows; caption = mono-uppercase `Text`; each row is the demonstrated tree, fully capture-visible). |
| 3 | `<name>Configurator` | ONE interactive combo-panel (`Reactive` + `State.bind` switches/selects) for combinatorial spaces. Exemplars: `collections/table.examples.tsx` `tableSelection`, `collections/library.examples.tsx` `libraryLarge`, `collections/schematic.examples.tsx` `schematicInteractions`. Visually regression-guarded combinations may NOT hide behind a switch. |
| 4 | `<name><Behavior>` | One example per behavioral contract needing isolation: DnD, review chrome, slice binding, deep-linking, overlay stacking, reactive-drag grammars. |
| 5 | `<name>Stress` | Perf/scale demonstrations (virtualized rows, 500-unit schematic). |

Files with fewer than 5 examples are under the slot budget and stay
as-is.

## Panel construction

- Row caption idiom: `<Text textStyle="body-sm" fontFamily="mono" textTransform="uppercase" color="fg.muted">CAPTION</Text>`.
- Data fixtures hoist to module scope as `SCREAMING_SNAKE` consts
  (`<EXPORT>_DATA`, second arrays `<EXPORT>_<ROLE>_DATA`); East-generated
  data (`East.Array.range/generate`) may hoist as module-scope expression
  consts; `Date.now()`-dependent data stays in-body (the
  `no-build-time-clock` rule); no TS helper calls inside East bodies
  (east#990020).
- Merged reactive examples keep their whole `<Reactive>` trees and
  original State keys as panel rows.
- keywords = the union of the merged examples' keywords (dedup);
  descriptions enumerate the row labels.

## The examples↔tests contract

Every surviving export is wired in the sibling `*.spec.ts` via
`Assert.examples` (named keys), and every panel/merged export carries a
caption-presence test asserting the row count and every caption:

```ts
const panel = $.const(ex.fooVariants.fn() as ExprType<UIComponentType>);
const rows = $.const(panel.unwrap().unwrap("Stack").children);
$(Assert.equal(rows.size(), 4n));
$(Assert.equal(rows.get(0n).unwrap().unwrap("Stack").children.get(0n).unwrap().unwrap("Text").value, "SIZES"));
```

## Frozen names

Export names referenced from `east-ui-components/scripts/probe-*.ts`,
`snapshot.ts`, or `east-ui-showcase/tests/responsive/*` are frozen —
retarget the referencing script in the same PR or don't touch the name.
As of epic #455: `tooltipOverStickyTable`, `alignedStackAll`,
`splitterCollapseBelow`, `rosterInteractive`, `schematicNets`,
`storyBasic`, `storyStacked`, `drawerStackedNested`, `sliceTableChrome`,
`sliceChartChrome`, `sliceRail`, `sliceNarrow`, `sliceGanttChrome`, plus
the probe-collections target list (`tableBasic`, `tableColumnsVariants`,
`tableStyleVariants`, `tableSelection`, `tableReactivePagination`,
`tableExpandedRichDetail`, `tableInteractiveCallbacks`, `plannerPoint`,
`plannerEventStates`, `plannerColumns`, `plannerBucketsVariants`,
`plannerEventStyleVariants`, `ganttAxisVariants`, `ganttTaskVariants`)
and the DnD probes' `plannerLibraryDnd` / `ganttLibraryDnd`.

## Cascade for any consolidation / example change

1. Rewrite the sibling spec (examples↔tests contract).
2. Update probe/golden references in the same PR.
3. `make test && make lint` in `libs/east-ui`.
4. Re-bank responsive goldens if the component is in the catalog.
5. Regenerate the plugin search index (coordinate first).
6. Regenerate rendered design captures
   (`make east-ui-examples-html-all` + `node scripts/design-example-cards.mjs`).
