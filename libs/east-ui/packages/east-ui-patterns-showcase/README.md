# @elaraai/east-ui-patterns-showcase

Authoritative spec + live mocks for east-ui decision-quality patterns. Real React + Chakra v3 components, location-based feedback persisted to SQLite for fast iteration with Claude.

## Run

```bash
# from monorepo root
pnpm install

# from this package directory
pnpm dev          # http://localhost:5173
```

The dev server mounts a small SQLite-backed feedback API at `/api/feedback` so the iteration loop (you give feedback in the UI → Claude reads the DB → Claude updates patterns and marks feedback actioned) is closed without leaving the app.

## Feedback workflow

Every section of every pattern spec has a feedback anchor — a "+ feedback" button that opens a small composer with a kind picker (`comment | reject | change | question | add`) and a body textarea. Submitting POSTs to `/api/feedback` and persists to `data/feedback.db`.

Feedback rows carry a `location_id` (e.g. `decide.briefing.purpose`) so they're anchored to a specific spec section. Each row has:

| field        | meaning                                                          |
|--------------|------------------------------------------------------------------|
| `id`         | autoincrement                                                     |
| `location_id`| where in the spec the feedback was placed                         |
| `pattern_id` | the pattern (e.g. `decide.briefing`)                              |
| `mode_id`    | the mode (e.g. `decide`)                                          |
| `kind`       | `comment` \| `reject` \| `change` \| `question` \| `add`          |
| `body`       | the feedback text                                                 |
| `status`     | `open` \| `actioned` \| `wontfix`                                 |
| `resolution` | Claude's note on how the feedback was addressed                   |
| `created_at` | ISO timestamp of submission                                       |
| `actioned_at`| ISO timestamp of resolution                                       |

### Claude's side

To list open feedback:

```bash
sqlite3 data/feedback.db "SELECT id, location_id, kind, body FROM feedback WHERE status = 'open' ORDER BY created_at;"
```

To mark feedback actioned with a resolution note:

```bash
sqlite3 data/feedback.db "UPDATE feedback SET status='actioned', resolution='Tightened the briefing rationale; reduced because-bullets to 2 max for routine archetype.', actioned_at=datetime('now') WHERE id=42;"
```

Or use the helper script:

```bash
node scripts/feedback-resolve.mjs 42 "Tightened the briefing rationale..."
```

## Stack

- **React 19**, **TypeScript 5.9**, **Vite 6**
- **@chakra-ui/react v3** — semantic tokens for Elara design language
- **react-router-dom v7** — one route per mode
- **better-sqlite3** — local feedback persistence (in `data/feedback.db`, gitignored)

## Layout

```
east-ui-patterns-showcase/
  data/                       # SQLite (gitignored)
  server/feedback-plugin.ts   # Vite middleware: /api/feedback CRUD
  src/
    main.tsx                  # bootstrap
    App.tsx                   # shell + nav
    theme/system.ts           # Chakra v3 system w/ Elara tokens
    spec/
      types.ts                # Feedback types (shared)
      useFeedback.ts          # React hook
      Feedback.tsx            # FeedbackAnchor + FeedbackCard
      PatternSpec.tsx         # PatternSpec + PatternSection wrappers
    routes/
      Index.tsx               # /
      Decide.tsx              # /decide
      [other modes ...]
    patterns/
      decide/
        RecommendationBriefing.tsx
        Stakes/Tag.tsx
        ...
    fixtures/
      decide.ts               # sample data for each pattern
```

## Adding a new pattern

1. Build the component in `src/patterns/<mode>/<Name>.tsx` with proper typed props.
2. Add sample data in `src/fixtures/<mode>.ts`.
3. Render in `src/routes/<Mode>.tsx` inside a `<PatternSpec>` with `<PatternSection>` blocks for purpose, mock, slots, behaviour, states, when-used, rationale.
4. Hot-reload picks it up. Drop `<FeedbackAnchor locationId="..." />` blocks alongside.

## Modes

- `/observe` — *"What needs my attention?"*
- `/predict` — *"If I act vs do nothing — what changes?"*
- `/diagnose` — *"Why is the rec what it is?"*
- `/decide` — *"Should I accept, modify, or override — and on what evidence?"*  ← anchor
- `/compare` — *"How does this differ from last time / from the runner-up?"*
- `/calibrate` — *"Was my judgement right?"*
- `/configure` — *"What inputs drive this?"*
- `/frame-trust` — *"Should I trust this; can I defend my decision later?"*
