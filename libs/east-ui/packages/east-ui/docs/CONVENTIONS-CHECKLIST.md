# Conventions checklist

A one-page author checklist for every new primitive or pattern PR. Based on
`docs/design-plans/0-conventions.md`. If a box is unchecked, explain why in
the PR description; patterns are consistent for a reason.

## IR shape

- [ ] **States (§0.1).** If the primitive carries a `state` field, it accepts
      `StateValueType` from `src/contracts/index.ts` and the renderer handles
      all seven values: `ready | loading | empty | stale | error | disabled |
      permission-denied`. Fallback surfaces per the table in
      `docs/design-plans/0-conventions.md` §3.1.
- [ ] **Patch typing (§0.8).** If the primitive is commit-adjacent (mutates
      application state on a primary action), its operation is typed as
      `PatchTypeOf<TState>`, not an opaque callback. See
      `docs/design-plans/2.3-decide.md` §3.0.
- [ ] **Semantic `colorPalette`.** When the primitive's meaning is
      state-bearing (Alert / Banner / Status / DeltaPill / FreshnessChip),
      the palette accepts semantic tokens (`success | warning | danger | info
      | neutral`) as well as hue tokens.

## Renderer contracts

- [ ] **Paired icon (§0.3).** Any renderer that displays a `StatusToken`
      calls `resolvePairedIcon(status, showIcon?)` from
      `east-ui-components/src/contracts/paired-icon.ts`. Colour is never the
      only signal.
- [ ] **Hover intent (§0.5).** Any hover-to-open primitive (Tooltip,
      ToggleTip, HoverCard, Menu-on-hover) reads delays from
      `resolveHoverIntent(token)` — no per-component timing.
- [ ] **Reduced motion (§0.2).** Any animation or pulse / shimmer visual
      checks `usePrefersReducedMotion()` and degrades to `none` when the
      hook returns `true`.
- [ ] **Density / verbosity cascade.** Primitives that vary by density or
      verbosity read `useDensity()` / `useVerbosity()` from the context
      first, falling back to the component's explicit prop override.
- [ ] **Focus ring.** Focusable surfaces resolve their ring via
      `FocusStyleType` → `toFocusRingProps()` — no hand-rolled outlines.

## Accessibility

- [ ] **Keyboard path.** Full operation without a mouse; documented per
      primitive (arrow keys, Enter / Space, Escape, Tab).
- [ ] **ARIA.** Correct `role`, `aria-label` / `aria-labelledby`, live
      regions for state transitions.
- [ ] **Hit target.** 24×24 px compact, 32×32 px comfortable, 44×44 px touch.
- [ ] **DnD keyboard parity (§0.2).** If the primitive uses `DnD.Draggable`,
      a keyboard fallback is wired: Space pickup, arrow move, Space drop,
      Escape cancel.

## Visual / responsive

- [ ] **Minimum width ≥ 320 px.** Renders without clipping inside the
      narrowest host pane.
- [ ] **Colour escape hatches.** Every visually-distinct slot has an
      explicit colour prop under the component's `style` struct, not a raw
      top-level prop. Palette still wins ergonomics; `style.*` wins control.

## Documentation

- [ ] **TypeDoc.** Every exported symbol has `@remarks` / `@property` /
      `@example` blocks matching `src/style/scheme.ts` / `badge/types.ts`.
- [ ] **Enforcement header.** Every renderer file carries the
      `Enforcement:` JSDoc header listing where each applicable contract
      is enforced (IR factory vs renderer vs Chakra default).

## Tests

- [ ] **Spec + examples.** `test/<cat>/<name>.spec.ts` +
      `test/<cat>/<name>.examples.ts` exist. Examples omit `returns` for UI
      outputs; spec wires examples via `Assert.examples(test, { ... })`
      with named keys.
- [ ] **IR round-trip.** At least one test per variant / struct-field
      covering construction + `.hasTag` / `.unwrap` assertions.
- [ ] **Renderer smoke.** The renderer's visual output is exercised in the
      showcase and, where possible, at least one automated test.

## Breaking changes (§0.7)

- [ ] **No compat shims.** Renames / signature changes / deletions land in
      a single PR with every caller updated. No re-export aliases, no
      deprecation warnings.
- [ ] **If breaking, labelled.** PR title / description flag the break so
      consumers pinning against the prior version know.
