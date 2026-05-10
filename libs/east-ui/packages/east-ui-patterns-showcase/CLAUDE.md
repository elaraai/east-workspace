# CLAUDE.md — `@elaraai/east-ui-patterns-showcase`

Authoritative spec + live mocks for east-ui decision-quality patterns. Real React + Chakra v3 components, location-based feedback persisted to SQLite for fast iteration.

This document is the **operating manual**: who the work is for, what's here, how the iteration loop runs, and how to extend the spec without breaking the contract.

---

## What this package is

A standalone Vite + React app under `libs/east-ui/packages/east-ui-patterns-showcase`. Its purpose is **single**: serve as the working spec for the patterns in `east-ui`'s decision-quality catalogue. Each pattern is a real typed React component; each spec page renders that component at full fidelity alongside its prose, slot table, behaviour list, states, archetype chips, and rationale.

It is **not** a published library yet — patterns live here while their contract is being refined. Once a pattern is stable, it gets lifted into `@elaraai/east-ui-patterns` (or wherever the eventual package lives).

Two reasons it's a real app and not static HTML:

1. **TypeScript prop types are the slot spec.** When `<RecommendationBriefing>` defines `RecommendationBriefingProps`, that interface IS the contract. The slot table on the spec page is hand-authored prose describing it, but the ground truth is the TS type.
2. **Real interactivity reveals contract gaps.** Sliders, popovers, hover-cards, drag — designing them in static HTML hides fakery. Building them as Chakra components forces the contract to be honest.

---

## Who the user is

The audience for the *patterns themselves* (not this app — the components when consumed in real LOB apps): a **frontline business decision-maker**.

- Demand planner, store ops lead, buyer, scheduler, category manager, pricing analyst, brand manager, account lead. **Not** a data scientist, OR engineer, or value-chain analyst.
- 5–15 minutes per decision, queue of dozens-to-hundreds per week.
- Carries private information the model cannot have — relationships, conversations, regulatory whispers.
- Accountable for outcomes. Years of domain judgement beside the model's math.

Their job: **commit a defensible decision quickly that combines what the model knows with what they know**, maximising overall and local objectives.

The platform's job in their language: *"Give me the evidence I need to trust, modify, or override this rec — fast — and let me show my working when someone asks."*

Every pattern in this catalogue serves this user. If a proposed pattern serves the implementer / analyst / data scientist instead — drop it. The catalogue is curated against this persona, not exhaustive.

---

## The seven modes

The catalogue is organised by analytical mode. Each mode answers one question for the user. Patterns live in exactly one mode; cross-references are explicit.

| Mode | Question | Anchor pattern | Status |
|---|---|---|---|
| **Observe** | What needs my attention? | `Decision.Queue` | not built |
| **Predict** | If I act vs do nothing — what changes? | `Predict.BaselineVsAction` | not built |
| **Diagnose** | Why is the rec what it is? | `Recommendation.WhyThisRec` | not built |
| **Decide** | Should I accept, modify, or override — and on what evidence? | `Recommendation.Briefing` | **anchor mode — built** |
| **Compare** | How does this differ from last time / the runner-up? | `Recommendation.WhatChanged` | not built |
| **Calibrate** | Was my judgement right? | `Track.Scorecard` | not built |
| **Configure** | What inputs drive this? | InputBand family | not built |
| **Frame & trust** | Should I trust this; can I defend my decision later? | `Trust.Stamp` + `DecisionJournal` | not built |

Decide is built first because it's where the new patterns live (`Recommendation.Briefing`, `Reference.*`, `Judgement.*`, `Stakes.*`). Other modes get built one at a time once Decide's vocabulary stabilises.

### Pattern families

When several patterns share a contract with different data sources, they collapse into a *family* with one shared component shape:

| Family | Members | Lives in |
|---|---|---|
| `Recommendation.*` | `Briefing`, `WhyThisRec`, `WhatChanged`, `BaselineVsAction` | Decide / Diagnose / Compare / Predict |
| `Reference.*` | `Similar`, `Peers`, `Base`, `Novelty`, `Lesson` | Decide |
| `Judgement.*` | `Prompt`, `KnowledgePanel`, `Gap`, `Inject` | Decide |
| `Stakes.*` | `Tag`, `Radius` | Decide |
| `Commit.*` | `Bar`, `Confirm`, `BatchBar`, `Approval` | Decide |
| `Track.*` | `Scorecard`, `Lesson`, `ModelLimits`, `Annotate`, `Retrain` | Calibrate |
| `Trust.*` | `Chip`, `Stamp`, `Footer`, `Trail` | Frame & trust |
| `Banner.*` | recipes for `Stale`, `Partial`, `ChangeSinceLastVisit`, `Guardrail` | Frame & trust |

---

## Project layout

```
east-ui-patterns-showcase/
  CLAUDE.md                       — this file
  README.md                       — short pitch + quick-start
  Makefile                        — every workflow as a make target
  package.json
  tsconfig.json
  vite.config.ts                  — wires in feedbackPlugin
  index.html

  data/                           — SQLite (gitignored)
    feedback.db                   — created on first /api/feedback request

  server/
    feedback-plugin.ts            — Vite plugin: /api/feedback REST against SQLite

  scripts/
    feedback-list.mjs             — CLI: list feedback rows
    feedback-resolve.mjs          — CLI: mark a row actioned with resolution note
    feedback-watch.mjs            — long-running watcher; emits JSONL on stdout

  src/
    main.tsx                      — bootstrap (ChakraProvider + Router)
    App.tsx                       — sidebar shell with mode list

    theme/
      system.ts                   — Chakra v3 system w/ Elara semantic tokens

    spec/                         — generic spec scaffolding (mode-agnostic)
      types.ts                    — Feedback, FeedbackInput, FEEDBACK_KINDS
      useFeedback.ts              — React hook: GET/POST/PATCH/DELETE
      Feedback.tsx                — FeedbackAnchor + FeedbackCard
      PatternSpec.tsx             — PatternSpec, PatternSection, Block,
                                    MockFrame, Prose, SlotTable,
                                    BehaviourList, StateGrid, ArchetypeChips

    routes/
      Index.tsx                   — landing page
      Decide.tsx                  — /decide spec page

    patterns/
      decide/
        RecommendationBriefing.tsx
        Stakes/Tag.tsx
        ...                       — to be added: Reference.*, Judgement.*, etc.

    fixtures/
      decide.tsx                  — sample data for Decide patterns
```

---

## Conventions

### Pattern components

Every pattern component lives at `src/patterns/<mode>/<Family>/<Name>.tsx` (or `src/patterns/<mode>/<Name>.tsx` if not in a family). Rules:

- **Typed props are the spec.** `interface FooProps { ... }` is exported and is the slot contract.
- **JSDoc above the component** restates the pattern's purpose in one paragraph and lists the slots.
- **No CSS-in-JS files; no styled-components.** Use Chakra's prop API: `bg="bg.surface"`, `borderColor="border.subtle"`, `colorPalette="brand"`, etc.
- **Tokens are semantic.** Reach for `bg.canvas`/`bg.surface`/`bg.muted`, `fg`/`fg.muted`/`fg.subtle`, `border.subtle`/`border.strong` before raw `gray.X`. Raw scales are fine for accents that aren't covered semantically (e.g. `green.700` for upside text).
- **Mono numerals.** Anything tabular (stakes, deltas, ranges) uses `fontFamily="mono"` + `fontVariantNumeric="tabular-nums"`.
- **Status colour pairs with an icon.** Never hue-only. The `glyph` pattern in mocks (`✓`, `!`, `×` on a circle) is the convention.

### Spec pages

Each route under `src/routes/<Mode>.tsx` is a long-form spec for that mode. Structure:

1. **Mode header** — eyebrow, title, lead paragraph, the question in italic with brand left-rail.
2. **Mode-level intro** — typically three `<PatternSection>` groups: "the decision-maker's job", "what evidence means", "cross-cutting commitments". Each prose chunk wrapped in a `<Block>` with its own feedback anchor.
3. **One `<PatternSpec>` per pattern**, in a fixed order:
   - `<PatternSection label="Purpose">` — 2–3 paragraphs, one `<Block>` each.
   - `<PatternSection label="Mocks">` — one `<Block>` per mock variant. Each mock wrapped in `<MockFrame>` with a small caption above.
   - `<PatternSection label="Slots">` — single `<Block>` containing a `<SlotTable>`.
   - `<PatternSection label="Behaviour">` — single `<Block>` containing a `<BehaviourList>`.
   - `<PatternSection label="States">` — single `<Block>` containing a `<StateGrid>`.
   - `<PatternSection label="When to use">` — intro `<Block>`, `<ArchetypeChips>` `<Block>`, notes `<Block>`.
   - `<PatternSection label="Rationale">` — one `<Block>` per non-obvious choice.

### Granularity rule

**One `<Block>` per chunk you'd want to react to independently.** That means:

- Each paragraph of prose → its own `<Block>` with a unique `locationId`.
- Each mock variant → its own `<Block>`.
- Each table / list / grid → its own `<Block>`.
- Each rationale point → its own `<Block>`.

Don't wrap multiple paragraphs in one `<Block>` — feedback would lose specificity. Don't wrap a single short sentence in its own `<Block>` — you'll get over-fragmented anchors. Aim for the unit *the user would point at and say "this part"*.

### Location ID convention

```
<modeId>.<patternId>.<section>.<chunk>
```

Examples:
- `decide.briefing.purpose.shape`
- `decide.briefing.mock.standard`
- `decide.briefing.rationale.three-reasons`
- `decide.intro.evidence.refclass`         (mode-level intro, no specific pattern)

Rules:
- Lowercase, kebab-case for the chunk segment.
- Use `intro` for mode-level (not pattern-specific) sections.
- Catch-all per pattern is `<patternId>.global` — auto-injected by `<PatternSpec>` at the bottom.
- Stable across rewrites. **Do not rename** an existing `locationId` once feedback has been written against it (orphans the rows).

### Theme tokens

Pre-wired in `src/theme/system.ts`:

| Token | Light | Dark |
|---|---|---|
| `bg.canvas` | `gray.50` | `gray.900` |
| `bg.surface` | `white` | `gray.800` |
| `bg.muted` | `gray.100` | `gray.700` |
| `fg` | `gray.900` | `gray.100` |
| `fg.muted` | `gray.600` | `gray.400` |
| `fg.subtle` | `gray.500` | `gray.500` |
| `border.subtle` | `gray.200` | `gray.700` |
| `border.strong` | `gray.300` | `gray.600` |

Brand scale: `brand.50–900` (deep teal, mid `#488e97`).
Neutral scale: `gray.50–900` (cool green-gray, NOT warm).
Accents: `green.X`, `orange.X`, `red.X`, `blue.X`, `purple.X` from Chakra defaults.

Fonts:
- `heading` — DM Sans (display)
- `body` — Inter Tight (UI)
- `mono` — JetBrains Mono (numerics, code)

---

## The feedback loop

### Storage

Local SQLite at `data/feedback.db`. Gitignored. Schema:

```sql
CREATE TABLE feedback (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  location_id  TEXT NOT NULL,
  pattern_id   TEXT,
  mode_id      TEXT,
  kind         TEXT NOT NULL,                 -- comment | reject | change | question | add
  body         TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'open',  -- open | actioned | wontfix
  resolution   TEXT,                          -- Claude's note on how addressed
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  actioned_at  TEXT
);
```

WAL mode is on. Indexed on `status`, `location_id`, `pattern_id`.

### API

Mounted by `server/feedback-plugin.ts` as Vite middleware:

| Endpoint | Behaviour |
|---|---|
| `GET /api/feedback?status=&locationId=&patternId=&modeId=` | List with optional filters |
| `GET /api/feedback/:id` | Single row |
| `POST /api/feedback` | Body: `{ locationId, kind, body, patternId?, modeId? }` |
| `PATCH /api/feedback/:id` | Body: `{ status?, resolution? }`. Auto-stamps `actioned_at` when status flips to `actioned`. |
| `DELETE /api/feedback/:id` | Hard delete |

### UI

Each `<Block>` renders a `<FeedbackAnchor>` below its content. Always-visible thin `+ feedback` bar with the `locationId` displayed in mono (subtle). Click → composer opens with kind picker and body textarea. Submit → POST → row appears immediately above the anchor. Mark Actioned, Reopen, or Delete from the row itself.

### Watcher

`scripts/feedback-watch.mjs` polls `data/feedback.db` every 1.5s using SQLite's `data_version` pragma to skip when nothing's changed. Emits JSONL on stdout:

```jsonl
{"ts":"...","event":"starting",...}
{"ts":"...","event":"seed","feedback":{...}}        // backlog at startup
{"ts":"...","event":"ready","backlogCount":3,"lastId":7}
{"ts":"...","event":"new","feedback":{...}}         // new submission
{"ts":"...","event":"status-change","id":5,"from":"open","to":"actioned",...}
```

Designed to be tailed by Claude's Monitor tool with a `grep` filter on `"event":"(new|status-change|error)"` so each actionable event becomes a chat notification.

### Iteration loop, end-to-end

1. **You** open the app, navigate to a spec page (e.g. `/decide`), drop feedback inline via the `+ feedback` button. Pick kind, type body, save.
2. The POST writes a row with `status='open'`.
3. **Watcher** detects the new row within ~1.5s, emits a JSONL line.
4. **Monitor** (filtered by `grep`) surfaces it as a chat notification to me.
5. **I** read the body + location, make the edit (in `Decide.tsx`, the relevant pattern component, etc.), and run:
   ```bash
   make resolve ID=42 NOTE='Tightened the second paragraph; cut to 2 sentences.'
   ```
   or use the CLI directly:
   ```bash
   sqlite3 data/feedback.db \
     "UPDATE feedback SET status='actioned', resolution='...', actioned_at=datetime('now') WHERE id=42;"
   ```
6. The watcher emits a `status-change` event; the UI re-fetches (5s polling on each anchor) and the row dims with a green "✓ actioned" strip showing my resolution note.
7. **You** verify by reloading or scrolling to the section. If I got it wrong, click **Reopen**.

---

## Adding a new pattern

1. **Build the component** at `src/patterns/<mode>/<Name>.tsx`. Export `interface <Name>Props` — that's the slot spec. Use Chakra's prop API. Ship 1–3 visual variants if the pattern has them (e.g. accent: brand / warn / danger).
2. **Add fixtures** in `src/fixtures/<mode>.tsx` (use `.tsx` if the fixture contains JSX). Multiple sample-prop sets, named for the variant they exercise.
3. **Render in the route** at `src/routes/<Mode>.tsx`. Wrap in a `<PatternSpec>` and follow the section convention above. Every chunk in its own `<Block>` with a stable `locationId`.
4. **Hot reload** picks it up. No server restart needed.

## Adding a new mode

1. Create `src/routes/<Mode>.tsx` mirroring `Decide.tsx`'s structure (header, intro sections, pattern specs).
2. Add the route in `src/main.tsx` to the router config.
3. Add patterns under `src/patterns/<mode>/`.
4. Update `src/App.tsx`'s `MODES` constant if displayed there (already includes all 8 modes).
5. Update this CLAUDE.md's "Status" column.

## Adding a new pattern family

1. Create the directory `src/patterns/<mode>/<Family>/` with `index.ts` re-exports.
2. Each member is a sibling file: `Similar.tsx`, `Peers.tsx`, etc.
3. Define a shared `*Common` props interface they all extend.
4. Document the family contract in this CLAUDE.md (the "Pattern families" table above).

---

## Workflows (Makefile cheat sheet)

```bash
make help              # full menu
make dev               # vite (foreground)
make dev-bg            # vite in background, log /tmp/east-ui-patterns-showcase-dev.log
make watch             # tail feedback.db (foreground; JSONL stdout)
make watch-bg          # background watcher
make list              # all OPEN feedback in pretty form
make list-actioned     # what I've already addressed
make resolve ID=42 NOTE='note about how it was addressed'
make reopen ID=42      # reopen actioned feedback
make rm ID=42          # delete a row
make db-shell          # sqlite3 REPL against data/feedback.db
make db-reset          # nuke the DB (destructive)
make typecheck         # tsc --noEmit (Chakra v3's globalCss has noisy types — expected)
make build             # production build
make clean             # remove dist + Vite cache
```

---

## What this is not

- **Not a published pattern library.** Don't import from `@elaraai/east-ui-patterns-showcase` elsewhere. Once a pattern stabilises, lift it to `@elaraai/east-ui-patterns`.
- **Not a generic showcase.** Patterns here are decision-quality patterns specifically — Decide / Predict / Calibrate, not generic UI parts.
- **Not east-ui itself.** east-ui is the IR-producing component layer (returns data structures describing UIs). This package is React-direct — it exists to design the contracts that will eventually be expressed as east-ui components.

---

## Style commitments (visual)

These are non-negotiable for new patterns. They make the catalogue feel like one product:

- **Cool green-gray neutrals** (the `gray.X` scale here), never warm-gray. Warm-gray reads "Apple/iOS"; we're "operations/clinical".
- **Deep teal brand** (`brand.500` = `#488e97`). Used for primary accents, left rails, focused state. Don't introduce parallel brand hues.
- **Hairline borders > heavy fills.** Prefer 1px `border.subtle` over background tints for grouping.
- **Soft pills** (`borderRadius="full"`) for status, deltas, freshness. Sharp rectangles for content cards.
- **No vibrant purple chrome.** Purple is reserved for category accents (e.g. role-coding in `AssignmentBoard`), never UI scaffolding.
- **Status colour ALWAYS paired with an icon.** Glyph + colour, never colour alone.

---

## Live state of the package

The dev server and the feedback watcher both run as long-lived background tasks under Claude's task system. Key tasks:

| Task ID | What | Lifecycle |
|---|---|---|
| (ephemeral) | Vite dev server | Started via `make dev-bg` or directly via `pnpm dev` |
| (ephemeral) | Feedback watcher | Started via `make watch-bg` or via Claude's Monitor with the JSONL → grep filter |

When working on this package, Claude should:

1. **Always start the watcher** under Monitor when picking up an iteration, so feedback events arrive automatically.
2. **Always cite the `locationId`** when responding to feedback (e.g. "Resolved #42 (`decide.briefing.rationale.three-reasons`): tightened the third sentence and removed the redundant clause.").
3. **Use `make resolve ID=… NOTE='…'`** rather than raw SQL, so the resolution timestamp gets stamped consistently.
4. **Keep `locationId`s stable.** Renaming an ID orphans existing feedback. If a section needs renaming, leave the old `locationId` and add the new one as an alias rather than swapping.
