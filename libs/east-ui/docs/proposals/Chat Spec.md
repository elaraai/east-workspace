# Chat Spec — the Elara chat, written out

The anatomy, values, copy, motion and behaviour of the Elara chat concept, transcribed from
[`Chat Spec.html`](Chat%20Spec.html) so an implementation can be reviewed against text. The HTML is
the ground truth: where this document and the mock disagree, the mock wins and this document is
the bug. The design, the server and the phases are in issue #883; the deviations the
implementation makes from the mock are listed there, under "Mock → parts, and deviations", and
the smaller ones in §15.

Conventions used below:

- Every colour, radius, shadow, duration and easing is a token from
  `libs/east-ui/app_design_system/tokens/` (`--ink`, `--paper-2`, `--rule-strong`, `--brand-d`,
  `--shadow-md`, `--dur-fast`, `--ease-out`, …). A value written in px is the mock's literal value.
- **Label** means the design system's mono label: `--font-mono`, 9.5px, weight 600, uppercase,
  `--ink-4`. The letter-spacing is given per use (0.12em–0.16em).
- **Numerals** are always `--font-mono` with `font-feature-settings: "tnum" 1`.
- **Icon button N** means an N×N button, `display: grid; place-items: center`, no border,
  transparent background, `--ink-3` (or `--ink-4` where stated). On hover it takes `--paper-3` with
  `--ink`, and it transitions background and colour over `--dur-fast` with `--ease-out`.
- Font Awesome 6 icons are `fa-solid`.

## Contents

1. The Elara mark
2. Frame
3. Header, menus, notice
4. Thread: scroll, empty state, dividers
5. User message
6. Assistant message
7. Markdown
8. Tool-result widgets (frame, chart, table, stats, proposal, tool call; query-backed widgets)
9. Composer
10. Delete dialog
11. Streaming, scrolling and timing
12. Keyboard
13. Copy
14. The showcase page
15. Deviations from the mock

---

## 1. The Elara mark

The mark is a 152-dot matrix: an outer ring of 100 dots around a core of 52. It is the assistant's
avatar and its status: **idle** (static), **thinking** (an orbit round the ring while the core
pulses outward), and **writing** (a diagonal scan across every dot).

### 1.1 Geometry

| Property | Value |
|---|---|
| Drawing | `<svg viewBox="0 0 82.9 82.9" width={size} height={size} role="img">`, `display: block`, `overflow: visible`, `fill` = the tone colour |
| Wrapper | The `<svg>` sits in a `<span>` with `display: inline-flex; flex: none; line-height: 0; vertical-align: middle` |
| Dots | 152 `<circle r="2.2">` at the fixed coordinates in `ELARA_PTS` (`res/ElaraMark.dc.html`, verbatim in the mock). SHA-256 of that string: `11d026196f94da50ed72d80ae95626e9ec92c8bfbef19be0652bae1b32ae535d` |
| Grid | 25 columns and rows, x and y ∈ {2.2, 5.5, 8.7, …, 77.4, 80.7}, pitch ≈ 3.27 |
| Centre | C = (41.45, 41.45) |
| Ring / core split | d = hypot(x − C, y − C); **ring** when d > 23. Ring dots lie at d ∈ [30.14, 40.47] (100 dots), core dots at d ∈ [3.25, 17.61] (52 dots). No dot lies between 17.61 and 30.14, so the threshold sits in the gap |
| Per-dot phase values | `ang = (atan2(y − C, x − C) + π) / 2π` ∈ [0, 1), which is 0 at 9 o'clock and increases clockwise on screen (y points down) · `rad = min(1, d / 17.6)` ∈ [0.185, 1] for core dots · `diag = (x + y − 4.4) / 157` ∈ [0.187, 0.813] |
| Transform box | Each circle: `transform-box: fill-box; transform-origin: center` (the core scales about its own centre) |
| Size | Integer px, 12–160 in steps of 2, default 28. Used at 28 (assistant row), 52 (empty state) and 56 (showcase) |
| Tone → fill | `brand` → `--brand-d` (default) · `ink` → `--ink` · `paper` → `--paper` · `muted` → `--ink-4` |
| Accessible name | `aria-label` "Elara" when idle, "Elara · thinking" and "Elara · writing" otherwise |

### 1.2 Motion

| State | Which dots | Keyframes | Duration · timing | Per-dot `animation-delay` |
|---|---|---|---|---|
| idle | — | none | — | — |
| thinking | ring | `elaraOrbit`: `0% {opacity: 1}` `36% {opacity: .16}` `100% {opacity: .16}` | 1.6 s · `linear` · infinite | `(ang − 1) × 1.6 s` ∈ [−1.600, −0.021] |
| thinking | core | `elaraCore`: `0%, 100% {opacity: .22; transform: scale(.68)}` `50% {opacity: 1; transform: scale(1)}` | 1.6 s · `cubic-bezier(0.65, 0, 0.35, 1)` (= `--ease-in-out`) · infinite | `(−1.6 + rad × 0.8) s` ∈ [−1.452, −0.800] |
| writing | all | `elaraScan`: `0% {opacity: 1}` `28% {opacity: .24}` `100% {opacity: .24}` | 1.4 s · `linear` · infinite | `(diag − 1) × 1.4 s` ∈ [−1.138, −0.262] |

Delays are negative, so every dot starts mid-cycle and the pattern is visible from the first frame.
Delays are printed to 3 decimals (`toFixed(3)`).

How it reads:

- **Orbit.** A dot is brightest when `ang ≡ t / 1.6 s (mod 1)`. The bright head therefore travels
  clockwise from 9 o'clock, one lap per 1.6 s, with a tail that fades to 0.16 over 36 % of the lap.
- **Core.** Each core dot peaks (opacity 1, scale 1) half a period after its delay. The centre peaks
  first and the rim `0.8 s` later, so the core breathes outward. Its trough is opacity 0.22,
  scale 0.68.
- **Scan.** A bright band sweeps diagonally from the top-left (`x + y` small) to the bottom-right
  every 1.4 s, fading to 0.24 over 28 % of the period.

### 1.3 Reduced motion

When `prefers-reduced-motion: reduce` matches, no dot animates. In the thinking and writing states
every dot is drawn at **opacity 0.6**; idle dots stay at 1. The label still says the state. The
renderer's global reduced-motion reset shortens durations to 0.001 ms, which on an infinite
animation lands on arbitrary frames (the orbit's floor is 0.16). So the mark's recipe must set
`animation: none` explicitly under the media query.

### 1.4 Lifecycle

- The element is rebuilt only when (state, size, tone) changes, so re-renders mid-animation do not
  restart it.
- A state change restarts the pattern from its delay-derived phase.
- In the chat, a message maps to the mark as **thinking** before its first text, **writing** while
  text streams, and **idle** once it is done, stopped or failed (§6.2).

---

## 2. Frame

| Property | Value |
|---|---|
| Box | `position: relative`, width 100 %, column flex, `overflow: hidden` |
| Height | 800px in the mock. In product, the `height` / `maxHeight` sizing contract (#320) applies, with `height="fill"` as the default |
| Border / radius / fill | 1px `--rule-strong` · 10px · `--paper` |
| Text | `--ink`, `--font-body` |
| Theme | `data-theme="light" \| "dark"` on the frame when the host forces one; otherwise the frame inherits |
| Layers (z-index) | header 4 · jump button 4 · composer 3 · sources row 5 · provenance popover 6 · composer menu 10 · header menus 20 · dialog overlay 30 |

## 3. Header, menus, notice

### 3.1 Header bar

- **Bar.** `position: relative`, z 4, no flex growth, row, `align-items: center`, gap 12,
  min-height 60, padding `0 10 0 18`. Bottom border 1px `--rule`, fill `--paper`.
- **Left column.** Flex 1, min-width 0, column, gap 3.
  - **Title.** `--font-brand` 15px, weight 700, letter-spacing −0.01em, line-height 1.25, `--ink`,
    no wrap with an ellipsis. The text is the thread title.
  - **Meta line.** Row, gap 6. Label style (0.12em), no wrap, numerals tabular.
    - While a reply is running, it starts with the **working** marker, a 6px `--brand-d` dot
      pulsing (§11.4) followed by "WORKING" in `--brand-d` (gap 6), then a `·` separator.
    - Then `{surface title} · {subject} · {age}`, for example "BRISBANE DC · RUN #42 · 14 MIN AGO",
      with an ellipsis when it overflows.
    - `{age}` is "new" for a thread with no messages and "now" once its first message is sent. The
      product then counts from the last message: "{n} min ago", "{n} h ago" the same day,
      "yesterday", then "{n} d ago".
- **Buttons.** Three icon buttons 32 (radius 6, 13px icons) in a row with gap 2:

  | Icon | aria-label · title | Notes |
  |---|---|---|
  | `fa-clock-rotate-left` | Thread history · History | Toggles the history menu. `--paper-3` fill while it is open. `data-keep-open` |
  | `fa-pen-to-square` | New thread · New thread | Starts a new thread (§11.6) |
  | `fa-ellipsis` | More actions · More | Toggles the more menu. `--paper-3` fill while it is open. `data-keep-open` |

### 3.2 Menus

Both menus are `role="menu"`, `data-keep-open`. They sit at `position: absolute`,
`top: calc(100% + 6px)`, `right: 10`, z 20, with padding `6 0`, a 1px `--rule-strong` border,
radius 6, `--paper` fill and `--shadow-md`. Opening one closes the other, the composer menu and the
provenance popover.

**History menu** (width 300)

- **Heading.** "THREADS · {surface title}", padding `6 14 8`, label style at 0.16em.
- **One button per thread** (`role="menuitem"`), newest first. Full width, row, gap 10, padding
  `8 14`, left-aligned text. The current thread is filled `--brand-tint`; every row, the current one
  included, takes `--paper-3` on hover. Each holds a text column (gap 3) and the check:
  - the title, 13px/600 `--ink`, with an ellipsis;
  - the meta, `--font-mono` 9.5/500 at 0.08em, uppercase, `--ink-4`: "{when} · {n} MSG";
  - on the current thread, a trailing `fa-check` (11px, `--brand-d`).
- `{when}` is "Today 09:41", "Yesterday 15:20" or "Mon 21 Sep", and "Now" for a new thread with no
  messages. `{n}` counts the messages, not the dividers, and is live for the current thread.
- Selecting a row switches threads (§11.6).

**More menu** (width 232)

- **Heading.** "THREAD" (padding `6 14 6`).
- **Items** (`role="menuitem"`). Height 34, padding `0 14`, gap 10, 13px `--ink-2`. On hover the fill is `--paper-3` and
  the text `--ink`. Each has a leading icon 16px wide, 12px, `--ink-4`:
  - `fa-file-export` "Export transcript"
  - `fa-link` "Copy link"
- A 1px `--rule` separator with 6px vertical margin.
- `fa-trash-can` "Delete thread", in `--neg` (which also colours the icon); hover fill `--paper-3`.
- **Actions.** Export transcript and Copy link close the menu and show their notices (§13). Delete
  thread closes it and opens the dialog (§10).

### 3.3 Notice

The notice is an in-surface banner, not a toast, between the header and the thread (no flex
growth). It is a strip, `role="status"`, row, gap 10,
min-height 36, padding `0 10 0 18`, with a 1px `--brand-d` bottom border, a `--brand-tint` fill and
12.5px `--ink-2` text:

- `fa-circle-check` (12px, `--brand-d`);
- the message (flex 1);
- a dismiss button: icon button 24, radius 4, 11px `fa-xmark`, `--ink-3`, hover fill `--paper`,
  `aria-label="Dismiss"`.

It auto-dismisses after **2 800 ms**; only the latest notice's timer can clear it. The messages are
in §13.

## 4. Thread: scroll, empty state, dividers

- **Scroll area.** `position: absolute; inset: 0` inside a `flex: 1; min-height: 0` wrapper. It
  scrolls vertically (`overflow-y: auto`, `overflow-x: hidden`) with thin scrollbars
  (`scrollbar-color: var(--rule-strong) transparent`). It is a column with gap 22 and padding
  `20 18 28`.
- **Empty state.** Shown when the thread has no messages.
  - **Layout.** Centred in the scroll area with `margin: auto 0`. Column, centred, gap 16,
    padding `8 2`, centred text.
  - **Mark.** The Elara mark, idle, size 52.
  - **Title and body** stack in a centred column, gap 6.
  - **Title.** "Ask Elara about {subject}", 15px/700 `--ink`. The numerals in the subject are
    styled: in "run #42" only "#42" is mono.
  - **Body.** 12.5/1.5 `--ink-3`, max-width 300, `text-wrap: pretty`.
  - **Checklist.** Column, gap 5, 12.5px `--ink-3`. Each row is a mono `☐` in `--ink-4` with gap 8.
    Copy is in §13; the `/`, `/chart` and `@` in it are set mono `--ink`.
  - **Suggestions.** Column, gap 6, `padding-top: 4`, full width. Each is a button:
    - min-height 38, row, gap 10, padding `0 12`, 1px `--rule-strong` border, radius 6, `--paper`
      fill, 13px `--ink-2`, left-aligned text;
    - hover: border `--ink-3`, fill `--paper-2`;
    - a leading icon 14px wide, 11px `--ink-4`;
    - the text, with its numerals styled;
    - a trailing `fa-arrow-right` (10px, `--ink-4`).

    Each suggestion has its own icon. The mock's are `fa-triangle-exclamation` "Why is Thursday
    flagged in the Brisbane DC plan?", `fa-list-check` "Summarise week 40 risks" and
    `fa-code-compare` "Compare run #42 with run #41". Clicking one sends its text at once, without
    the composer's command or attachments, and the composer keeps its draft (§15).
- **Divider.** Row, gap 10, label style at 0.14em, tabular. A 1px `--rule` rule (flex 1) sits on
  each side of the label "TODAY · 09:41". In the mock a divider opens each thread; the product
  also opens each later day with one. The label is "Today", "Yesterday" or `ddd D MMM`, then
  `· HH:mm`.

## 5. User message

The row is a column aligned to the right (`align-items: flex-end`), gap 6, with `padding-left: 40`.
From top to bottom:

1. **Attachments** (if any). Wrapping row, right-justified, gap 6. Each tile:
   - height 36, row, gap 8, padding `0 12 0 10`, 1px `--rule-strong` border, radius 6, `--paper` fill;
   - the file icon (13px `--ink-3`: `fa-file-csv`, `fa-file-excel`, `fa-file-pdf`, …);
   - the name, 12px/600 `--ink`, over the meta (a column, gap 1);
   - the meta, mono 9.5 `--ink-4`, tabular: "{size} · {sha256 head…tail}", for example
     "18 KB · 3f9a…c21e".
2. **Bubble** (when there is text or a command).
   - Max-width 100 %, padding `9 12`, radius **8**, `--paper-3` fill, 13.5/1.55 `--ink`.
   - `white-space: pre-wrap`, `overflow-wrap: anywhere`, `text-wrap: pretty`.
   - A command renders first as "/chart " in mono 12px/600 `--brand-d`.
   - Numerals are styled, by the §7 pattern without its leading sign.
3. **Meta row.** Height 22, gap 2.
   - **Actions.** Opacity 1 while the row is hovered and no reply is running, else 0, with an
     opacity transition over `--dur-fast`. In order:
     - "COPIED" (label style, `--pos`, 0.14em, right padding 4) for 1 400 ms after a copy;
     - Edit: icon button 24, radius 4, 11px `fa-pen`, `--ink-4`, `aria-label="Edit message"`,
       title "Edit". Not while a reply is running;
     - Copy: `fa-copy`, which turns to `fa-check` while "COPIED" shows. `aria-label="Copy message"`,
       title "Copy". It copies `{command} {text}`; a later copy restarts the 1 400 ms.
   - **Time.** Mono 10px at 0.06em, `--ink-4`, left padding 4, as `HH:mm`.
   - **"· EDITED"** (label style, 0.12em) once the message has been edited and resent.
4. **Edit box** (replaces the bubble and meta row while editing).
   - Full-width column, gap 8, padding `10 12`, 1px `--brand-d` border, radius 8, `--paper` fill,
     `--shadow-focus`.
   - A textarea (`aria-label="Edit message"`): auto-focused, 3 rows, 13.5/1.55, no border or
     outline, no resize handle. It starts with the message's text; the command stays as it was.
   - Footer row, gap 8:
     - the hint "⏎ resend · esc cancel" (mono 9.5 `--ink-4`, flex 1);
     - **Cancel**: height 28, padding `0 10`, 1px `--rule-strong` border, radius 6, `--paper`,
       `--ink-2` 12.5px/500, hover border `--ink-3`;
     - **Resend**: height 28, padding `0 12`, 1px `--brand-d` border and `--brand-d` fill, `--paper`
       text at 12.5px/600, hover `--brand-dd`.
   - Resending needs non-empty text. It keeps the message's command and attachments, stamps the new
     time, marks it "· EDITED", drops every later message, and asks again.

## 6. Assistant message

### 6.1 Row

The row is laid out as follows:

- **Row.** `align-items: flex-start`, gap 12.
- **Avatar.** A 28×28 cell, grid-centred, holding the Elara mark at size 28 (§6.2).
- **Content.** A column (flex 1, min-width 0, gap 10) holding, in order:

1. **Name row.** min-height 28, gap 8.
   - "Elara": `--font-brand` 13.5px/700, −0.01em, `--ink`.
   - The time: mono 10 at 0.06em, `--ink-4`.
   - A flag, when the message stopped or failed: label style at 0.14em.
     - "· STOPPED" in `--ink-4`.
     - "· FAILED" in `--neg`.
2. **Summary toggle.** Shown when the message is not thinking, has not failed, and has at least one
   step.
   - **Button.** `align-self: flex-start`, inline row, gap 7, height 24, margin `−4 0 −4 −8`,
     padding `0 8`, radius 4. Label style at 0.12em.
   - **Hover.** `--paper-3` fill, `--ink-2` text.
   - **Contents.** `fa-list-check` (10px), then the text, then `fa-chevron-down` / `fa-chevron-up`
     (8px).
   - **State.** `aria-expanded` reflects the trace.
   - **Text** (§13):
     - "Thought {thoughtFor} s · {n} tool call(s)";
     - "Thought {thoughtFor} s · {n} step(s)" when no step used a tool (the mock prints "1 steps",
       §15);
     - "Stopped after {duration} s" when stopped before any text.
3. **Trace.** Shown while thinking, after a failure, or when expanded.
   - **Box.** Column, gap 7, padding `10 12`, radius 8, `--paper-2` fill. The 1px `--rule-strong`
     border is **dashed** while thinking or after a failure, and solid otherwise.
   - **Live head** (while thinking only): label style at 0.14em in `--brand-d`,
     "THINKING · STEP {i} OF {n}". `i` is the first step not yet done, 1-based, minimum 1.
   - **Steps in product.** The engine's steps (issue): "Reading thread context" first, then one per
     tool call, labelled per §13. While the reply is thinking and no step is running, the trace ends
     with a "Reasoning" row in the active state, as the mock's live mode shows it. The row is not
     stored, and `i` and `n` count it.
   - **Step rows.** Each row has min-height 18 and gap 8, holding:

     | Part | Style |
     |---|---|
     | Status cell | 14×14. `fa-check` 10px `--pos` when done; the pulsing dot (§11.4) when it is the active step; a 5×5 `--rule-strong` disc when pending |
     | Tool name (tool steps only) | Mono 11px/600, `--brand-d`, for example `query_run` |
     | Label | 12.5px with an ellipsis. `--ink-3` when done, `--ink` when active, `--ink-4` when pending |
     | Time | Mono 10 `--ink-4`: "{t.toFixed(1)} s", measured from the send |
4. **Body.** The Markdown renderer (§7), with the message's components and a caret while streaming.
5. **Stopped before answering.** Label style at 0.14em, shown when the user stopped the message
   before any text arrived.
6. **Error card.** `role="alert"`.
   - **Box.** Row, gap 10, padding `10 10 10 14`, 1px `--neg` border, radius 4, fill
     `color-mix(in oklch, var(--neg) 6%, transparent)`.
   - **Icon.** `fa-circle-exclamation` 14px `--neg`.
   - **Text.** "Request failed" (13px/600 `--ink`), then the error message (12.5/1.45 `--ink-3`).
   - **Retry.** Height 28, padding `0 10`, `--rule-strong` border, radius 6, `--paper`, `--ink-2`
     12.5px/500, hover border `--ink-3`. It regenerates the message.
7. **Sources** (done messages only). A row with `position: relative`, z 5, wrapping, gap 6.
   - **Label.** "SOURCES", label style at 0.14em, right padding 2.
   - **Chips.** Inline row, gap 6, height 22, padding `0 8`, radius 4.
     - Border 1px `--rule-strong` and fill `--paper`; while the chip's popover is open, border
       `--brand-d` and fill `--brand-tint`.
     - Mono 10px/600 at 0.06em, uppercase, `--ink-2`, tabular. Hover border `--ink-3`.
     - Contents: a 6px round dot in the freshness tone (`--pos` fresh, `--warn` stale), the label,
       then the meta at weight 500 in `--ink-4` ("14 MIN", "09:28", "2 D").
     - `data-keep-open`. Clicking toggles the provenance popover. Opening it closes the header
       menus and the composer menu.
   - **Provenance popover.** `role="dialog"`, `aria-label="Provenance"`, `data-keep-open`.
     - **Box.** `position: absolute`, `top: calc(100% + 10px)`, z 6, width 288, 1px `--rule-strong`
       border, radius 6, `--paper` fill, `--shadow-md`.
     - **Placement.** `left = clamp(chip.offsetLeft, 0, width − 288)`.
     - **Arrow.** 12×12, rotated 45°, at `top: −7`, with 1px `--rule-strong` left and top borders and
       a `--paper` fill. Its left edge is `clamp(chip.offsetLeft − left + chip.width / 2 − 6, 10, 266)`.
     - **Head.** Padding `12 14 10`, column, gap 4, bottom border `--rule`. It holds "PROVENANCE"
       (0.16em), the title (13px/600 `--ink`), and the status (label style at 0.12em in the status
       tone, after a 6px dot of the same tone).
     - **Rows.** Padding `6 14`. Each row: baseline, gap 12, padding `4 0`. The key is label style
       at 0.12em, 72 wide; the value is mono 11 `--ink`, tabular.
     - **Footer.** Padding `8 14 10`, top border `--rule`. A link button, 12.5px/600 `--brand-d`
       (hover `--brand-dd`): "{label} →". Clicking it closes the popover and runs the source's
       action:
       - **open** (the mock's "Open run" and "View source"): `onOpenSource`, else the URL in a new
         tab, and the notice "{title} opened in a new tab";
       - **add** (the mock's "Attach roster_v8.csv" on the stale roster): puts the newer input into
         the composer and focuses it. The mock attaches the file; in product the input is a
         context chip (§15).
8. **Actions** (done or stopped messages). Row, gap 2, margin `−2 0 0 −6`. Opacity 1 while hovered,
   on the last assistant message, or while "COPIED" shows; otherwise 0.
   - **Buttons.** Icon buttons 28, radius 6, 12px, `--ink-4`:
     - Copy (`aria-label="Copy answer"`, title "Copy"): `fa-copy`, which becomes `fa-check` in
       `--pos` for 1 400 ms. It copies the text with each component written as `[{title}]`.
     - Regenerate (`aria-label` and title "Regenerate"): `fa-rotate-right`. Only on the last
       assistant message, and only when no reply is running. It reruns the same request into the
       same message.
     - Helpful (`aria-label` and title "Helpful"): `fa-thumbs-up`.
     - Not helpful (`aria-label` and title "Not helpful"): `fa-thumbs-down`.

     The two rating buttons set `aria-pressed`. When on, the fill is `--brand-tint` and the colour
     `--brand-dd`. The rules:
     - Helpful toggles the "up" rating and closes the feedback panel.
     - Not helpful on a message rated "down" clears the rating and closes the panel. Otherwise it
       rates "down" and opens the panel, unless feedback was already sent.
   - **Trailing labels.** "COPIED" (`--pos`, 0.14em, left padding 6). After thumbs-down feedback is
     sent, "✓ FEEDBACK LOGGED · {subject}", with the check in `--pos` and the rest label style at
     0.12em. It shows only while the rating is "down".
9. **Feedback panel.** Opens on thumbs-down until feedback is sent, on a done or stopped message.
   - **Box.** Column, gap 10, padding 12, 1px `--rule-strong` border, radius 8, `--paper-2` fill.
   - **Head.** "WHAT WAS WRONG?" (0.14em) and a close button (icon button 24, 11px `fa-xmark`,
     `aria-label="Close feedback"`). Closing keeps the rating.
   - **Reason chips.** Multi-select: "Numbers are wrong", "Missing context", "Too long",
     "Not actionable".
     - Height 26, padding `0 10`, radius 4, 12px, hover border `--ink-3`; in product,
       `aria-pressed` (§15).
     - Selected: fill `--brand-tint`, border `--brand-d`, text `--brand-dd`.
     - Unselected: fill `--paper`, border `--rule-strong`, text `--ink-2`.
   - **Send feedback.** Right-aligned. Height 28, padding `0 12`, `--rule-strong` border, radius 6,
     `--paper`, `--ink-2` 12.5px/500. It is disabled (opacity 0.45, `cursor: not-allowed`) until at
     least one reason is chosen. Sending closes the panel and shows the trailing label.
10. **Follow-ups.** Last assistant message only, when it is done, no reply is running, and it has
    suggestions. A column, gap 6:
    - the label "FOLLOW UP" (0.14em);
    - a wrapping row (gap 6) of chips. Each chip: inline row, gap 7, height 28, padding `0 10`,
      `--rule-strong` border, radius 6, `--paper`, 12.5px `--ink-2`, hover border `--ink-3` and fill
      `--paper-2`. It holds the text (numerals styled) and a trailing `fa-arrow-right` (9px,
      `--ink-4`). Clicking one sends its text alone; the composer keeps its draft (§15).

### 6.2 States

`thinking → streaming → done`, or `→ stopped` / `→ error` from either of the first two.

| State | Mark | Name-row flag | Summary | Trace | Body | Sources · actions · follow-ups |
|---|---|---|---|---|---|---|
| thinking | thinking | — | — | open, dashed, live head | — | — |
| streaming | writing | — | shown (collapsed) | when expanded | text + caret | — |
| done | idle | — | shown | when expanded | full | all three |
| stopped | idle | · STOPPED | "Thought …" or "Stopped after …" | when expanded | kept prefix, no caret; or "Stopped before answering" | actions only |
| error | idle | · FAILED | — | open, dashed | — | — (the error card instead) |

A stopped body keeps exactly the text revealed when Stop was pressed. In product the client sends
the revealed length with the cancel, and the server cuts the stored answer there (issue);
components placed after the cut are dropped.

## 7. Markdown

The body is a column (gap 10, min-width 0), 13.5/1.6 `--ink`, `--font-body`. The parser works by
blocks:

| Block | Recognised by | Rendering |
|---|---|---|
| Paragraph | Consecutive non-blank lines (joined with spaces) | `text-wrap: pretty`, `overflow-wrap: anywhere` |
| Heading 1–2 | `#` / `##` | `--font-brand`, 16px / 15px, 700, −0.01em, `--ink`, padding-top 2, line-height 1.35 |
| Heading 3–4 | `###` / `####` | Label style: mono 10px, 600, 0.14em, uppercase, `--ink-4` |
| List | `-` `*` `+` or `N.` `N)` items; indentation ÷ 2 spaces gives the level (maximum 2), a tab counting as 2 spaces | Column, gap 4. Each item is a row, gap 8, `padding-left: level × 18px` |
| Task item | `[ ]` / `[x]` after the list marker | The marker ☐ / ☑; a done item's text is `--ink-4` and struck through |
| Quote | `>` lines; a non-blank line straight after one joins the quote | Padding `10 12`, **dashed** 1px `--rule-strong` border, radius 6, `--paper-2` fill, `--ink-2`, 13/1.55 (the design system's Inset role) |
| Code | Fenced with three backticks, with an optional language; an unclosed fence runs to the end | See below |
| Table | `\| … \|` followed by a separator line; rows run while lines start and end with `\|` | See below |
| Rule | `---`, `***` or `___` | 1px `--rule` |
| Widget | A line that is exactly `[[id]]` (`id` is word characters) | The component with that id (§8). Before its spec has arrived, a pending box (below). In product the engine puts every placeholder on its own line (issue) |

**List markers.** Each marker is mono 600, line-height 21.6px, tabular:

| Item | Marker | Min-width | Size | Colour |
|---|---|---|---|---|
| Bullet | "–" | 10 | 12px | `--ink-4` |
| Ordered | "N." | 18 | 12px | `--ink-4` |
| Task, open | ☐ | 10 | 13px | `--ink-4` |
| Task, done | ☑ | 10 | 13px | `--pos` |

A line indented at least two spaces after an item continues that item.

**Code block**

- **Frame.** 1px `--rule` border, radius 6, `--paper-2` fill, overflow hidden.
- **Header.** Height 28, padding `0 4 0 12`, bottom border `--rule`. It holds:
  - the language, label style at 0.14em, "text" when none is given;
  - a copy button (`margin-left: auto`): height 22, gap 6, padding `0 8`, radius 4, label style at
    0.12em, hover `--paper-3` and `--ink`. It shows `fa-copy` (10px) "COPY", which becomes
    `fa-check` "COPIED" in `--pos` for 1 400 ms. It copies the code without the caret.
- **Body.** `<pre>` with padding `10 12 12`, mono 11.5/1.65 `--ink-2`, tabular, `white-space: pre`,
  horizontal scroll.

**Table**

- **Frame.** 1px `--rule-strong` border, radius 6, horizontal scroll, `--paper` fill. The inner
  min-width is `columns × 92px`.
- **Grid.** The first column is `minmax(0, 1.4fr)`, the rest `minmax(0, 1fr)`.
- **Header row.** `--paper-2` fill, bottom border `--rule`. Cells: padding `7 10`, label style at
  0.14em, line-height 1.4. Bold markers are stripped from header text.
- **Body rows.** A top border `--rule` on every row but the first. Cells: padding `8 10`,
  12.5/1.45 `--ink`, `overflow-wrap: anywhere`, with inline markdown. A missing cell renders empty;
  cells past the header's count are dropped.
- **Alignment.** An explicit `:--:` (centre) or `--:` (right) wins. Otherwise a column after the
  first is right-aligned when every cell matches
  `^[\s▲▼+−-]*[$#]?[\d,.]+\s?(%|h|min|pts|lines/hr)?$` or is a dash (`—`, `–` or `-`).

**Pending widget.** Height 96, 1px **dashed** `--rule-strong` border, radius 8, centred label
"RENDERING COMPONENT" (0.14em).

**Inline markup**

| Markup | Rendering |
|---|---|
| `` `code` `` | Mono 0.88em, `--paper-3` fill, padding `1 5`, radius 4 |
| `**bold**` / `__bold__` | Weight 600, `--ink` |
| `*em*` | Colour `--ink-2` only, not italic (the design system allows italic only for muted "no data" values) |
| `[text](url)` | `--brand-d`, underline 1px thick with a 2px offset, `target="_blank"`, `rel="noreferrer"` |

Only `*em*` makes emphasis; `_em_` stays literal. Inside a heading, inline spans keep only their
font, weight, colour and numerals, so code there gets no fill. Link text gets no numeral styling.

**Numerals.** Outside code and link text, every match of
`[+−-]?[#$]?\d[\d,]*(?:[.:]\d+)*(?:[–-]\d[\d,]*(?:[.:]\d+)*)?%?` renders mono 0.93em, weight 500
(600 inside bold), tabular. Examples: `1,840`, `114%`, `10:00–14:00`, `#42`, `$0`, `−12`. A leading
sign is left out of the run when the character before it is a word character or `)` (so `P-118`
keeps its hyphen in the text).

**Streaming.** Before parsing a partial text:

1. Remove a trailing, unfinished placeholder (`[[` followed by word characters and at most one
   `]`, at the end).
2. If the text has an odd number of `**`, remove the last `**`.
3. If it has an odd number of single backticks (not counting fences), remove the last one unless
   it is part of a fence.

The caret is ▍ (mono 0.9em, `--brand-d`, left padding 1px). It is appended to:

- the last paragraph, heading or quote;
- the last list item;
- the end of the last code block's text, as a plain ▍ in the code's own style.

After a widget, a pending box, a rule or a table, it starts a new paragraph instead.

## 8. Tool-result widgets

### 8.1 Frame

- **Box.** Full width, 1px `--rule-strong` border, radius 8, `--paper` fill, overflow hidden.
- **Header.** min-height 34, row, gap 8, padding `0 4 0 12`, `--paper-2` fill, bottom border
  `--rule`. From left to right:

| Part | Chart | Table | Stats | Proposal |
|---|---|---|---|---|
| Icon (12px wide, 11px, `--ink-4`, `aria-hidden`) | `fa-chart-column` / `fa-chart-line` | `fa-table` | `fa-gauge-high` | `fa-code-pull-request` |
| Eyebrow (label style at 0.14em) | "CHART.COLUMN" / "CHART.LINE" | "TABLE" | "STAT" | "PROPOSAL · {id}" |
| Title (flex 1, 12px/600 `--ink-2`, ellipsis) | the spec title | the spec title | the spec title | — |
| Status (label style at 0.14em, 6px dot, right padding 4) | — | — | — | "PENDING" `--warn` · "APPLIED" `--pos` · "OVERRIDDEN" `--ink-4` |

The header then ends with two icon buttons:

- **Tool call.** Icon button 28, radius 6, 11px `fa-code`, `aria-label="Show tool call"`, title
  "Tool call". It is `--ink-4`; while its panel is open, fill `--brand-tint` and colour `--brand-dd`.
- **Copy data.** Icon button 28, 11px `fa-copy`, which becomes `fa-check` in `--pos` for 1 400 ms.
  `aria-label` and title "Copy data". It copies CSV (§8.6).

A query-backed widget also fills the status cell and adds a Refresh button before these two. The
value widget has its own header row. Both are product additions, specified in §8.7.

A new spec for the widget (the mock's `uid`) resets its local state: the hover, hidden series,
sort, selection, the open tool call panel and any unsaved proposal edits.

### 8.2 Chart

- **Body.** Padding `12 12 10`, column, gap 8. The plot is 168 high (the spec may override). Below it
  is the legend.
- **Legend.** A wrapping row, gap `2 14`. Each entry is a toggle button:
  - height 22, gap 7, `aria-pressed`, title "Toggle series", opacity 0.45 when the series is hidden;
  - a 14px-wide swatch, drawn as a 3px top border in the series colour (solid, or dashed for a
    dashed series);
  - the name, mono 10.5px/600 `--ink`;
  - an eye icon: `fa-eye` in `--brand-d` when shown, `fa-eye-slash` in `--ink-4` when hidden (9px).
- **Unit.** Right-aligned after the legend: mono 10 `--ink-4`, for example "lines/hr".

**Plot geometry**

| Element | Rule |
|---|---|
| Width / height | width = the widget's width − 24 (minimum 220), tracked with a `ResizeObserver` (a change over 1px re-renders; 380 before the first measure); height 168 |
| Margins | left 36, right 8, top 16, bottom 22 |
| Y domain | From `y0 = yMin` (0 by default) to `y0 + 4 × nice((max(values, band highs, ref) × 1.06 − y0) / 4)`, where `nice(v) = {1, 2, 2.5, 5, 10} × 10^⌊log10 v⌋` (the first ≥ v / 10^⌊log10 v⌋) |
| Grid | Horizontal lines at ticks 1–4: `--rule`, dashed `3 3` |
| Y ticks | 5 labels at x = left − 7 and y = tick + 3.5, right-aligned, mono 10/500 `--ink-4`, tabular. Values ≥ 1 000 print in thousands to at most 2 decimals ("1.5k", "1.84k"); smaller values to at most 1 decimal |
| X labels | Centred under each band at y = h − 5. When there are more than 8, only every `ceil(n / 7)`th is drawn. The hovered one is `--ink` |
| Baseline | 1px `--rule-strong` at y0 |
| Series colours | By `tone`, else by order: `--brand-d`, `--teal-500`, `--purple-500`, `--blue-500`, `--orange-500`. Tones: brand `--brand-d` · ink `--ink-3` · muted `--ink-5` · teal · purple · blue · orange · neg · pos · warn |
| Columns | Bar width `max(4, min(c > 1 ? 12 : 18, (band × 0.62 − 3(c − 1)) / c))`, 3px gap between a group's bars, rx 2. A hidden series is drawn at opacity 0.22 |
| Split over reference | When `splitOver` is set, each first-series bar above the ref is drawn in two parts: the series colour from 0 up to the ref, and the part above it in `--neg` (rx 2; the lower part is square) |
| Lines | Stroke width 1.75, round joins and caps. `dashed` → `5 4`. A hidden series is dashed at opacity 0.45. `area` → a fill under the line in `--brand-tint` at opacity 0.7 |
| Band (p10–p90) | A polygon from the highs to the reversed lows, `--brand-tint` at opacity 0.7. It hides with the series it belongs to (`bandOf`) |
| Reference line | Tone colour (default `neg`), stroke 1.2, dash `4 3`. The label is mono 10px/600 in the tone, right-aligned at x = w − right, y = line − 5 |
| Hover | Columns: a `--paper-3` band behind the hovered x. Lines: a vertical `2 2` `--ink-4` guide, plus a dot on each shown series (r 3.5, `--paper` fill, series-colour stroke 1.75). Pointer x is mapped to `floor(fraction × n)`, clamped to the bands. The plot has `cursor: crosshair`; leaving it clears the hover |
| Tooltip | `position: absolute`, top 2, 12px right of the hovered x (or left of it past the midpoint, using `translateX(−100%)`). min-width 136, padding `7 9`, radius 4, `--ink` fill, `--paper` text, `--shadow-md`, mono 10.5/1.6, tabular, no wrap, z 2, `pointer-events: none`. Title: label style at 0.12em, "{xLabel} {x}", or "{x}" without an `xLabel`. One row per shown series (gap 7): an 8×2 swatch, the name (flex 1), the value (left padding 12, 600, grouped, at most 1 decimal, plus the short unit). With `splitOver`, a last row "Over capacity  +{excess}" in `--neg` |

### 8.3 Table

- **Scroll.** The body scrolls horizontally, with an inner min-width of 320.
- **Columns.** The first is `minmax(0, 1.5fr)`, the rest `minmax(0, 1fr)`, unless a column sets
  `w`. A column is right-aligned when every value is numeric, unless `align` says otherwise; the
  first column never is. A value is numeric when it is a number or matches
  `^[\s▲▼+−-]*[$#]?\d[\d,.]*\s?(%|h|min|pts|k|s)?$`; a `{v}` cell tests its `v`, and status cells
  never are.
- **Header.** min-height 30. Each cell is a button: height 30, padding `0 10`, label style at 0.14em,
  `--ink-4`, or `--ink` when it is the sort column. Hover `--ink`. The sort glyph is ▲ / ▼ (8px).
  Clicking cycles ascending → descending → unsorted. Sorting compares numbers after stripping
  non-numeric characters, else lower-cased strings.
- **Rows.** min-height 36, top border `--rule`. The fill is `--paper-3` when the row is selected,
  with `--paper-2` on hover. A click toggles single selection, which follows the row through
  sorting.
- **Cells.** Padding `0 10`, no wrap, ellipsis.

  | Cell kind | Style | Colour |
  |---|---|---|
  | Text | 12.5px/400 | `--ink` in the first column, else `--ink-2` |
  | Numeric | Mono 12/500 | as text |
  | Status | 6px dot, then label style at 0.12em | the status tone |

  Any cell's `tone` overrides its colour.
- **Footer.** min-height 30, padding `0 12`, top border `--rule`, `--paper-2` fill, label style at
  0.12em, split to the left and right edges.
  - Left: "{n} ROWS", plus " · SORTED BY {COLUMN} ▲|▼" when a column is sorted.
  - Right: "1 SELECTED" while a row is selected.

### 8.4 Stats

- **Grid.** `repeat(auto-fit, minmax(110px, 1fr))`, gap 1, `--rule` fill (so the gaps read as
  hairlines).
- **Tile.** Column, gap 7, padding `12 12 11`, `--paper` fill. Top to bottom:
  - the label, label style at 0.12em, line-height 1.35;
  - the value, `--font-brand` 26px/700, −0.01em, line-height 1, tabular, `--ink`, followed on the
    same baseline (gap 3) by the unit, mono 11/500 `--ink-4`;
  - the delta, mono 10/600 in the tone (default `--ink-3`), for example "▼ 12 PTS VS NOW".
- **Count.** At most 4 tiles.

### 8.5 Proposal

- **Body.** Padding `14 12`, column, gap 12. It holds the parts below, in order.

**Summary**

- `--font-brand` 14.5px/600, −0.01em, line-height 1.4, `--ink`, `text-wrap: pretty`.
- The mock's text is "Move {n} picker(s) from Tue late shift to Thu {window}". The argument values
  in it are mono 13px/600, tabular.
- In product, the summary is a template over the mutation's arguments (see the issue).

**Guardrail**

- Shown while pending when an impact row trips a guard.
- `role="status"`. Row, gap 10, padding `9 12`, 1px `--warn` border, radius 4, fill
  `color-mix(in oklch, var(--warn) 6%, transparent)`, 12.5/1.45 `--ink-2`.
- `fa-triangle-exclamation` (12px `--warn`, top padding 2), then text with the reached figure in mono
  600 and the limit in mono at normal weight, for example "Tue late reaches 102%, above the 90%
  guardrail."

**Modify** (while pending, in modify mode)

- A two-column grid, `1fr` and `1.25fr`, gap 12. One field per editable argument.
- Each field is a column, gap 6: a label (0.12em), the control, then help in mono 10 `--ink-4`.

Integer stepper:

- Label "PICKERS TO MOVE"; help "Range 1–8 · default 5".
- A row, gap 4. The − and + buttons: 28×28, `--rule-strong` border (hover `--ink-3`), radius 6,
  `--paper`, `--ink-2`, `fa-minus` / `fa-plus` (10px), `aria-label` "Fewer pickers" / "More
  pickers" (in product "Decrease {field}" / "Increase {field}", §15). Each is disabled at its bound,
  at opacity 0.4.
- Between them, the value: min-width 40, height 28, `--rule-strong` border, radius 6, mono 13/600.
  Its fill is `--brand-tint` when the value differs from the default.

Variant segmented control:

- Label "THURSDAY WINDOW"; help "Applies to Thu only".
- Frame: padding 2, gap 2, `--rule-strong` border, radius 6, `--paper` fill.
- Segments (`aria-pressed`): flex 1, height 22, padding `0 4`, radius 4, mono 10.5/600, tabular. The active one is `--brand-tint` with
  `--brand-dd` text; the others are transparent with `--ink-3` text. Hover `--ink`.
- The mock's options are 08–12, 10–14 and 12–16; the summary shows the long form ("10:00–14:00").

**Impact rows** (hidden in override mode)

- A top border `--rule`. Each row is a grid of 76px, `1fr` and `auto`, gap 10, min-height 32, with a
  bottom border `--rule`.
- **Key.** Label style at 0.12em.
- **Value.** Mono 12/500, tabular, for example "114% → 96%". It is `--neg` over a hard limit,
  `--warn` over a guard, and `--ink` otherwise.
- **Delta pill.** Padding `2 6`, radius 4, mono 10/600, for example "▼ 18 PTS". The fill is
  `color-mix(in oklch, <tone> 8%, transparent)`, or `--paper-3` for a neutral delta.

**Override** (while pending, in override mode)

- The label "REASON · REQUIRED".
- Single-select reason chips (clicking the selected one clears it), styled like the feedback chips:
  "Local knowledge", "Data quality", "Policy constraint", "Other".
- A note textarea:
  - 2 rows, min-height 52, resizes vertically, padding `8 10`, `--rule-strong` border, radius 6,
    12.5/1.5;
  - focus: border `--brand-d` and `--shadow-focus`;
  - placeholder "Detail for the decision journal (optional)".

**Applied**

- `role="status"`. Row, gap 10, padding `10 10 10 14`, 1px `--brand-d` border, radius 4,
  `--brand-tint` fill.
- `fa-circle-check` (14px `--brand-d`).
- "Applied to plan draft" (13px/600), then the meta line in mono 10 at 0.04em, `--ink-3`:
  "Run #43 queued · {HH:mm}[ · modified]".
- **Undo**, styled like Retry.

**Overridden**

- Column, gap 6, padding `10 12`, 1px `--rule` border, radius 6, `--paper-2` fill.
- The label "OVERRIDE · JOURNALED".
- The reason, as "{reason}[ · {note}]", 13/1.5 `--ink`.
- A row: the meta "Journaled {HH:mm} · by you" (mono 10 `--ink-4`), then **Reopen** (link style,
  `--brand-d`, 12.5px/600).

**Footer, while pending**

- Right-aligned row, gap 8, padding `10 12`, top border `--rule`, `--paper-2` fill.
- A note on the left (margin-right auto), label style at 0.12em. It reads "CONF 0.81 · RUN #42" in
  `--ink-4` normally, and "{k} FIELD(S) MODIFIED" in `--brand-d` once the Modify fields differ from
  the proposal.
- The commit cluster, left to right with increasing commitment:
  - **Override.** Height 30, padding `0 12`, 1px `--ink-3` border, `--paper`, `--ink-2`
    12.5px/**600**, hover fill `--paper-3`.
  - **Modify.** A toggle, height 30, padding `0 12`, 12.5px/500, `aria-pressed`. When active: border
    `--brand-d`, fill `--brand-tint`, text `--brand-dd`. When inactive: `--rule-strong`, `--paper`,
    `--ink-2`.
  - **Apply.** Height 30, padding `0 14`, `--brand-d` fill and border, `--paper` text 12.5px/600,
    hover `--brand-dd`.

**Footer, in override mode**

- **Cancel** (link style, `--brand-d`).
- **Submit override**, styled like Override. It is disabled at opacity 0.45 until a reason is
  chosen.

**Transitions**

| From | Action | To |
|---|---|---|
| pending | Modify | pending, modify mode (toggles) |
| pending | Override | pending, override mode (toggles) |
| pending | Apply | applied, stamped with the time |
| override mode | Cancel | pending |
| override mode | Submit override (needs a reason) | overridden, stamped with the time |
| applied | Undo | pending |
| overridden | Reopen | pending |

The widget's state persists with the message (the mock's `onWidgetState`). Reopening a thread
therefore shows it applied or overridden.

### 8.6 Tool call panel and copy data

**Tool call panel**

- Toggled by the `fa-code` header button. Top border `--rule`, `--paper-2` fill.
- **Head.** Height 30, padding `0 12`, label style at 0.14em. It holds `fa-screwdriver-wrench`
  (9px) and "TOOL CALL", then, on the right, `{name}()` in `--brand-d` at 0.02em, not uppercased.
- **Body.** A `<pre>` with max-height 220, scrolling, padding `0 12 12`, mono 11/1.6 `--ink-2`,
  `white-space: pre`.
- **Contents.** The mock prints the call's input as JSON. In product it is the East text rendering
  of the typed input (issue Decision 9).
- **Query** (query-backed widgets only, §8.7). A second head and body follow, styled like the
  first:
  - the head holds `fa-filter` (9px) and "QUERY", then, on the right, the datasets the query read,
    joined with " · ", in `--ink-3` at 0.02em, not uppercased;
  - the body is the jq program (`source.program`), verbatim.

  Each body scrolls on its own, at max-height 220. The query shows even when the call's input
  already carries it (a render call made with `query`), so every query-backed widget reads the same
  way.

**Copy data (CSV)**

| Widget | CSV |
|---|---|
| Chart | Header `x,{series…}`, then one row per x |
| Table | The column labels, then rows. A cell object contributes its value, or its status word |
| Stats | `label,value+unit,delta` |
| Proposal | `id,summary,status` |
| Value | Not CSV: the value as East text (§8.7) |

A refreshed widget copies the data it currently shows (§8.7). A field holding a comma, quote or
newline is quoted as RFC 4180 says; the mock never quotes (§15). The mock's proposal row is
`P-118,move {n} pickers Tue late → Thu {window},{status}`.

### 8.7 Product additions: query-backed widgets

None of this is in the mock. Issue #883 specifies the behaviour (Decision 21, rules W12, W14 and
W15); this section fixes the anatomy.

**Which widgets.** A chart, table, stats or value widget is *query-backed* when its spec carries a
`source`: the jq program, the datasets it read, and the pinned hash of each input
(`QuerySourceType`). An input's `name` is its dataset path as `workspaceStatus` reports it, for
example `.inputs.demand`. Proposals are never query-backed.

**Value widget.** The mock has no value widget. It uses the §8.1 frame:

- the icon is `fa-folder-tree`, the eyebrow "VALUE", and the title the spec title;
- the body is the production `<ValueTree>`, read-only, over the result handle, and paged;
- Copy data copies the value as East text, fetched through the handle.

**Refresh status.** It fills the header's status cell, styled as in §8.1 (label style at 0.14em, a
6px dot in the tone, right padding 4):

| State | When | Text · tone | Dot |
|---|---|---|---|
| none | Every pinned hash matches the workspace | — (the header is the mock's) | — |
| stale | Any input's current hash differs from its pinned hash | "STALE" · `--warn` | static |
| refreshing | A refresh is in flight | "REFRESHING" · `--brand-d` | the pulse (§11.4) |
| live | The last refresh succeeded | "LIVE · UPDATED {HH:mm}" · `--pos` | static |
| failed | The last refresh failed | "REFRESH FAILED" · `--neg`, with the error message as the `title` | static |

| From | Event | To |
|---|---|---|
| none or live | An input's hash moves | stale |
| stale or failed | Refresh | refreshing |
| refreshing | The route returns a spec | live |
| refreshing | The route fails | failed |

**Current hashes.** They come from the page's dataset cache (`ReactiveDatasetCache`), which already
polls `workspaceStatus` for hash-gated change detection. While mounted, the widget adds a hash-only
watch on each input (issue W14): the poll reads the hash and never downloads the dataset. After a
refresh, the widget compares against the refreshed spec's pinned hashes. With no dataset cache in
the tree, the status never shows.

**Refresh button.**

- Icon button 28, radius 6, 11px `fa-rotate-right`, `--ink-4`.
- `aria-label="Refresh from current data"`, title "Refresh".
- It sits before the Tool call button, and shows only in the stale and failed states.
- Clicking it posts `…/messages/:m/components/:c/refresh`. On success the widget redraws from the
  returned spec:
  - series hidden in the legend stay hidden, matched by name;
  - a table keeps its sort and clears its selection;
  - Copy data copies the redrawn data;
  - the tool call panel is unchanged.
- The stored message is unchanged. After a reload the widget shows the answer's own data again,
  and is stale if the inputs still differ.

**Drag source.** Chart, table, stats and value widgets, query-backed or not, are drag sources on
the shared grammar. They use `useDragSourceItem` from `east-ui-components/src/dnd/drag-layer.tsx`,
and are draggable only when the page mounts a drag layer.

- **Identity.** The library id is `chat-results:{surface id}`, for example
  `chat-results:brisbane`. The item key is `{message id}:{component id}`, for example `m12:c1`.
  The drag label is the widget title.
- **Handle.** The header's icon, eyebrow and title, marked `data-drag-handle`, with
  `cursor: grab` while draggable. The status and the buttons are not part of it.
  - The frame takes the pointer-down and starts a drag only when it lands inside the handle. The
    drag layer marks the element that took the pointer-down, so `data-dragging` lands on the frame.
  - The handle is not a `data-drag-grip`: grips set `touch-action: none`, which would stop a
    finger on a widget header from scrolling the thread.
  - A mouse drag starts on pointer-down.
  - A touch drag starts after the drag layer's 300 ms long-press.
  - Esc cancels.
- **While dragging.** The frame, marked `data-dragging`, drops to opacity 0.4, as a Library card
  does.
- **Ghost.** The Library recipe's `ghost` slot (`theme/slot-recipes/library.ts`), holding the
  widget title.
- **Drop.** A host target that lists `chat-results:{surface id}` in its `sources` receives an
  `add`. It reads the widget with `handle.component(key)`: the spec, including `source` when the
  widget is query-backed.

## 9. Composer

- **Area.** `position: relative`, z 3, no flex growth. Column, gap 8, padding `10 12 12`, top border
  `--rule`, `--paper` fill.

### 9.1 Menu (commands and context)

**Box.** `role="listbox"`, `data-keep-open`. Positioned `absolute` at `left: 12`, `right: 12`,
`bottom: calc(100% + 6px)`, z 10. Padding `6 0`, `--rule-strong` border, radius 6, `--paper` fill,
`--shadow-md`.

**Head.** Padding `4 12 6`, label style at 0.16em.

- On the left, "COMMANDS" or "ADD CONTEXT".
- On the right, the query as typed: "/{q}" or "@{q}", at weight 500 and 0.04em, not uppercased.

**Options.** `role="option"`, `aria-selected`. Row, gap 10, min-height 34, padding `0 12`. The
active option is filled `--paper-3`. Each option holds:

| Part | Style |
|---|---|
| Icon | 16px wide, 12px, `--ink-3` |
| Label | Mono 12px/600 `--ink`, tabular |
| Description | 12px `--ink-4`, with an ellipsis |
| Check (context only) | `fa-check` 11px `--brand-d`, when the item is already a chip |

- Hovering an option makes it active. It is picked on mousedown, with the default prevented so the
  textarea keeps focus. Picking focuses the textarea again.

**Empty and footer.**

- With no matches: "No matches", 12.5px `--ink-4`, padding `8 12`.
- Footer: `margin-top: 4`, padding `6 12 2`, top border `--rule`, mono 9.5 `--ink-4`:
  "↑↓ navigate · ⏎ select · esc close".

**Filtering.**

| Menu | An item matches when |
|---|---|
| Commands | its id starts with `q`, or its description contains `q` (case-insensitive) |
| Context | its label contains `q` (case-insensitive), or its id contains `q` |

**Picking.**

- **A command.** Sets the command pill and clears the draft, unless the menu was opened from a
  button.
- **A context item.** Toggles the chip, and removes the typed `@q` from the draft, unless the menu
  was opened from a button.

**Opening.**

- **Typing.** A draft that is exactly `/{q}`, with no command set, opens Commands. A word starting
  `@{q}` at the end of the draft opens Add context. Each keystroke detects again: the active option
  resets to the first, and a menu opened by typing closes when the draft stops matching.
- **Buttons.** The `@` button, the "+ Add" chip and the `/` button toggle the menus. These use
  mousedown with the default prevented. Opening one closes the header menus and the popover and
  focuses the textarea. A menu opened by a button stays open while typing.

### 9.2 Context row

The row wraps, with gap 6 and min-height 22. It holds, in order:

- **Label.** "CONTEXT", at 0.14em.
- **Chips**, one per context item:
  - inline row, gap 6, height 22, padding `0 3 0 8`, radius 4;
  - `--brand-tint` fill, `--brand-dd` text, mono 10px/500, no wrap, tabular;
  - the icon (9px), the label, then a remove button (16×16, radius 3, 8px `fa-xmark`, hover fill
    `--paper`, `aria-label="Remove context"`).
- **"+ Add".** A dashed 1px `--rule-strong` chip: height 22, padding `0 8`, radius 4, mono 10/500
  `--ink-4`, with `fa-plus` (8px) and "Add" (gap 5). Hover: border `--ink-3`, text `--ink-2`.
- **Initial chips.** The surface's pinned items, the mock's "Plan · week 40" and "Brisbane DC".

### 9.3 Input box

**Box.** Column, 1px border, radius 6, `--paper` fill. Unfocused, the border is `--rule-strong`
with no shadow. Focused, the border is `--brand-d` with `--shadow-focus`. Both transition over
`--dur-fast`.

**Attachments** (when there are any). A wrapping row, gap 6, padding `10 10 0`. Each tile:

- row, gap 8, min-width 176, max-width 100 %, height 38, padding `0 4 0 10`, radius 6, `--paper-2`
  fill;
- a 1px `--rule-strong` border, **dashed** while uploading and solid once done;
- the icon (14px `--ink-3`) and the name (12px/600, ellipsis);
- while uploading, a 4px progress track (`--paper-3`, radius 2) with a `--brand-d` fill (its width
  transitions over `--dur-fast`, linear), and the percentage in mono 9.5;
- once done, the meta in mono 9.5: "{size} · sha256 {head…tail}";
- a remove button (22×22, radius 4, 10px `fa-xmark`, `--ink-4`, hover `--paper-3` and `--ink`,
  `aria-label="Remove attachment"`).

A file with the same name as one already attached is not added again. The mock's Attach cycles
through three demo files. In product it opens the browser's file picker (several files; PDF,
images, CSV and text, issue P8). A failed upload keeps its tile with a `--neg` border and the error
as its meta, and is left out of the send.

**Input row.** Row, `align-items: flex-start`, gap 6, padding `10 12 2`.

- **Command pill** (while a command is set):
  - inline row, gap 4, height 22, padding `0 3 0 7`, radius 4, `--brand-tint` fill, `--brand-dd`
    text, mono 11px/600;
  - the label (for example "/chart") and a clear button (16×16, 8px `fa-xmark`,
    `aria-label="Clear command"`).
- **Textarea:**
  - `rows="1"`, flex 1, min-height 22, max-height 132, `box-sizing: border-box`;
  - no border, outline or resize handle; `overflow-y: auto`; padding `1 0`;
  - 13.5px with a 20px line height, `--ink`;
  - `aria-label="Message Elara"`, `data-keep-open`;
  - after each change its height is set to `auto`, then to `min(scrollHeight, 132)`.

**Placeholder**, first rule that applies:

1. While busy: "Elara is answering · esc to stop".
2. With a command set: the command's hint.
3. When the thread has messages: "Ask a follow-up".
4. Otherwise: "Ask about {subject}".

**Toolbar.** Row, gap 2, padding `4 6 6`. On the left, three icon buttons 32 (radius 6):

| Button | Content | Opens with | aria-label · title |
|---|---|---|---|
| Attach | `fa-paperclip` (13px) | click | Attach file · Attach |
| Context | `fa-at` | mousedown, `data-keep-open` | Add context · Context |
| Commands | "/" in mono 14px/600 | mousedown, `data-keep-open` | Commands · Commands |

**Right cluster** (`margin-left: auto`, gap 10):

- **Hint.** Mono 9.5 `--ink-4`, no wrap. A key cap followed by a label:
  - the key cap: min 16×16, padding `0 4`, 1px `--rule-strong` border with a 2px bottom border,
    radius 4, `--paper-2` fill, 9.5px/600 `--ink-3`;
  - while busy: "esc" · "stop";
  - while an attachment uploads: "⏎" · "uploading";
  - otherwise: "⏎" · "send · ⇧⏎ line".
- **Send / Stop.** Exactly one shows:

  | Shown when | Button |
  |---|---|
  | Not busy, and the message can be sent | Send (enabled) |
  | Not busy, and it cannot | Send (disabled) |
  | Busy | Stop |

  | Button | Style | Content | aria-label |
  |---|---|---|---|
  | Send | 32×32, radius 6, `--brand-d` fill, `--paper` text; hover `--brand-dd` | `fa-arrow-up` (13px) | Send |
  | Send, disabled | `--paper-3` fill, `--ink-5` text, default cursor | `fa-arrow-up` | Send |
  | Stop | 1px `--ink-3` border, `--paper` fill, `--ink` text; hover `--paper-3` | `fa-stop` (11px) | Stop generating |

A message **can be sent** when no reply is running, no attachment is uploading, and there is text,
an attachment or a command.

## 10. Delete dialog

**Overlay.** `position: absolute; inset: 0`, z 30, a centred grid with padding 24, filled
`color-mix(in oklch, var(--paper-3) 72%, transparent)`. Clicking the overlay cancels.

**Dialog.** `role="dialog"`, `aria-modal="true"`, `aria-label="Delete thread"`. Clicks inside it do
not propagate to the overlay.

- **Box.** Width 100 % up to 360. Column, gap 12, padding 20, 1px `--rule-strong` border, radius 10,
  `--paper` fill, `--shadow-lg`.
- **Contents**, top to bottom:

  | Part | Style | Text |
  |---|---|---|
  | Eyebrow | Label style at 0.16em, `--neg` | "CANNOT BE UNDONE" |
  | Title | `--font-brand` 20px/700, −0.015em, line-height 1.2 | "Delete this thread?" |
  | Body | 13/1.55 `--ink-3`, `text-wrap: pretty` | §13 |

- **Buttons.** Right-aligned, gap 8, top padding 4:
  - **Cancel.** Height 32, padding `0 12`, `--rule-strong` border, radius 6, `--paper`, `--ink-2`
    13px/500.
  - **Delete thread.** Height 32, padding `0 14`, `--brand-d` fill and border, `--paper` text
    13px/600, hover `--brand-dd`.
- **Rules.** There is no close ×; Esc cancels (§12). This follows the design system's Dialog rules.

## 11. Streaming, scrolling and timing

### 11.1 Reveal pacing

The mock reveals the reply's full text at a fixed pace, ticking every **24 ms**:

- **Per tick.** It reveals `chars` characters, plus 2 more with probability 0.3.
- **Speeds.**

  | Speed | Step | Chars per tick |
  |---|---|---|
  | slow | 900 ms | 2 |
  | normal | 480 ms | 4 |
  | fast | 220 ms | 9 |

  The step (with ±30 % jitter) paces the canned trace.
- **Placeholders.** When the revealed prefix ends inside `[[…`, the reveal jumps to the closing `]]`
  and pauses **420 ms**, so a component appears as a unit.

In product the text streams from the server in bursts. The engine flushes a `text` event every
50 ms or 256 characters, and the turn stream delivers each one as it is appended. On the polling
fallback, a poll's events arrive together. So the reveal keeps the mock's look with a catch-up
rule:

- per 24 ms tick it reveals `max(4, ceil(backlog / 12))` characters;
- the placeholder jump and the 420 ms pause are unchanged;
- the caret shows while the reveal is behind the received text, or while the reply is still
  writing.

### 11.2 Following the bottom

- **At bottom** means `scrollHeight − scrollTop − clientHeight < 48`. It is re-evaluated on scroll.
- While at the bottom, each reveal tick scrolls to the bottom (instantly).
- **Jump button.** Shown when not at the bottom and the thread has messages.
  - **Box.** `position: absolute`, left 50 %, bottom 12, `translateX(−50%)`, z 4. Row, gap 6,
    height 28, padding `0 10`, `--rule-strong` border, radius 6, `--paper` fill, `--shadow-md`;
    hover border `--ink-3`.
  - **Text.** Label style at 0.12em in `--ink-2`, after `fa-arrow-down` (9px): "LATEST", or
    "NEW REPLY" while a reply is running.
  - **Action.** Smooth-scrolls to the bottom.
- Sending or resending sets "at bottom" and scrolls to the bottom.

### 11.3 Initial scroll

`initial-scroll="bottom"` scrolls to the end after mount. The mock retries at 0, 120, 500 and
1 200 ms while components size themselves. Switching threads scrolls to the top after 60 ms.

### 11.4 The pulse

The working marker (§3.1) and the active trace step (§6.1) use a 6×6 `--brand-d` dot:

| Property | Value |
|---|---|
| Animation | `eastPulse` for 1.2 s, `cubic-bezier(0.65, 0, 0.35, 1)`, infinite |
| Keyframes | `0%, 100% { opacity: 1 }`, `50% { opacity: .35 }` |
| Reduced motion | The dot shows static |

### 11.5 Timing values

- `thoughtFor` is the time from send to the first text; `duration` is send to done. Both are in
  seconds, to 1 decimal.
- A step's time is measured from the send.
- The mock's canned thinking reveals one step per `step × (0.7 … 1.3)`.

### 11.6 Threads

| Event | Behaviour |
|---|---|
| New thread | Stops a running reply, saves the current thread, starts an empty one titled "New thread" (age "new", when "Now") at the top of the history, and focuses the composer |
| First message in a thread | The title becomes the text, or with no text the command's description, with whitespace collapsed and cut to 44 characters. A "TODAY · HH:mm" divider opens the thread, its age becomes "now" and its when "Today HH:mm" |
| Selecting a thread | Stops a running reply first, closes the menus, the popover and any edit, and scrolls to the top after 60 ms |
| Delete | Removes the thread, opens a fresh "New thread", and shows the "Thread deleted" notice |

## 12. Keyboard

| Key | Where | Action |
|---|---|---|
| ⏎ | Composer, no menu | Send, if allowed |
| ⇧⏎ | Composer | Newline |
| esc | Composer, while busy | Stop the reply |
| ⌫ | Empty composer with a command | Clear the command |
| ↑ | Empty composer, not busy | Edit the last user message |
| ↑ / ↓ | Menu open | Move the active option (wraps) |
| ⏎ / tab | Menu open, with matches | Pick the active option. With no matches, ⏎ sends |
| esc | Menu open | Close the menu |
| ⏎ | Edit box | Resend |
| esc | Edit box | Cancel the edit |
| esc | Anywhere, with the dialog open, or a header menu or popover open and focus inside the chat | Close it |
| Mouse down | Outside any `[data-keep-open]` element in the chat | Close menus and popovers |

All composer keys are ignored during IME composition (`isComposing`).

## 13. Copy

**Empty state**

| Part | Text |
|---|---|
| Title | "Ask Elara about {subject}" |
| Body | "Answers cite the run, its sources and assumptions. Charts, tables and proposals render inline." |
| Checklist | "Ask why a window is flagged" · "Type / for commands such as /chart" · "Type @ to add context" |

**Commands.** The mock's defaults:

| Command | Icon | Description | Hint | Instruction to the model |
|---|---|---|---|---|
| /explain | `fa-circle-question` | Explain a flagged metric | Metric or window to explain | — |
| /compare | `fa-code-compare` | Compare two runs or periods | Periods or runs to compare | — |
| /chart | `fa-chart-column` | Answer with a chart | What to chart | "Answer with render_chart." |
| /table | `fa-table` | Answer with a table | What to tabulate | "Answer with render_table." |
| /scenario | `fa-code-fork` | Draft a what-if scenario | Describe the change | — |
| /summarise | `fa-list-ul` | Summarise this thread | Optional focus | — |

The model reads a message as `{command} {text}`, followed by the command's instruction when it has
one. A message with a command and no text asks the command's description.

**Trace step labels** (product; the mock's canned labels are in `CH_CANNED`)

| Step | Label |
|---|---|
| The first step | "Reading thread context" |
| `describe`, `summarize` | The dataset's name |
| `check_query` | "check query" |
| `run_query` | The call's `label`, for example "Thu demand by window" |
| `call_function` | The function's name |
| `render_chart` | "{kind} · {n} series", for example "column · 1 series" |
| `render_table` | "{n} rows" |
| `render_stats` | "{n} values" |
| `render_value` | The title |
| `propose_change` | The proposal id, for example "P-118" |
| `read_context`, `edit_context` | The chip's label |
| `search_examples`, `read_skill` | The query, or the skill's name |
| `suggest_follow_ups` | No step |
| The row shown while thinking (§6.1) | "Reasoning" |

**Placeholders**

| When | Text |
|---|---|
| Busy | "Elara is answering · esc to stop" |
| Thread has messages | "Ask a follow-up" |
| Empty thread | "Ask about {subject}" |

**Notices**

| After | Text |
|---|---|
| Deleting a thread | "Thread deleted" |
| Exporting | "Transcript exported as Markdown" |
| Copying a link | "Link copied to clipboard" |
| Opening a source | "{title} opened in a new tab" |

**Delete dialog body**

> "{n} message(s) and their tool calls are removed from history. Decisions already applied to the
> plan are not reverted."

**Error.** The mock's message is "Connection lost while querying the run. No partial answer was
kept."

**Export.** The transcript is Markdown:

1. `# {title}`, then `{surface title} · {subject}`.
2. Per message, `**You · HH:mm**` or `**Elara · HH:mm**`, then the text. A component is written as
   `[{title}]`. Blocks are separated by a blank line.
3. The file is named after the title: each run of non-word characters becomes "-", then the name
   is lower-cased and ".md" appended, for example `thursday-capacity-flag.md`.

## 14. The showcase page

- **Page.** `--paper-2` fill, padding `40 32 72`, max-width 1480, column, gap 32.
- **Head.** A wrapping row (gap `24 48`, aligned to the bottom): the text column (flex
  `1 1 420px`, gap 10), then the mark trio.
  - Eyebrow: "COMPONENT · ASSISTANT CHAT" (mono 11px/600, 0.14em, `--brand-d`).
  - Title: "Elara chat" (`--font-brand` 36px/700, −0.02em, line-height 1.1).
  - Lede (14px/1.6 `--ink-3`, max-width 640): "LLM conversation surface for interrogating a run.
    Answers stream as markdown and render East UI components through tool calls. Proposals commit
    through Override · Modify · Apply."
- **Mark trio.** Three 160px columns in a grid framed by 1px `--rule-strong` (radius 10,
  `--paper`), divided by 1px `--rule`. Each column (padding `20 12 14`, gap 14) shows the mark at
  56px above its caption: the state (mono 10/600, 0.14em, uppercase, `--ink`) over the note (mono
  9.5 `--ink-4`, tabular):

  | State | Caption |
  |---|---|
  | IDLE | Static mark |
  | THINKING | Orbit + core · 1.6 s |
  | WRITING | Diagonal scan · 1.4 s |
- **"TRY".** Above a 1px `--rule` top border (padding-top 16, gap 10): the label "TRY" (mono
  10/600, 0.14em, `--ink-4`), then a grid `repeat(auto-fill, minmax(260px, 1fr))`, gap `8 28`.
  Each item is a baseline row, gap 10, 12.5/1.5 `--ink-3`: a key cap (min-width 18, padding `0 5`,
  1px `--rule-strong` border with a 2px bottom, radius 4, `--paper`, mono 10/600 `--ink-2`,
  centred; icons 9px) and its sentence:

  | Key | Sentence |
  |---|---|
  | ⏎ | Send. Freeform questions go to the live model with tools. |
  | / | Command menu, e.g. /chart or /table. ↑ ↓ ⏎ to pick. |
  | @ | Add or remove a context chip. |
  | ↑ | Edit your last message from an empty composer. |
  | esc | Stop an answer mid-stream. |
  | `fa-code` | Reveal the tool call behind a rendered chart or table. |
  | `fa-list-check` | Expand the thinking trace under an answer. |
  | ● | Click a source chip for its provenance. |
  | `fa-code-pull-request` | Modify the proposal, then Apply or Override with a reason. |
- **Instances.** A wrapping row, gap 28, of three chats, each `flex: 0 1 460px` (minimum 340) and
  800 high. Each sits under a label row (gap 10): its number (mono 11/600 `--ink`, tabular) and its
  label (mono 10/600, 0.14em, uppercase, `--ink-4`):

  | # | Label | Thread | Theme | Scroll |
  |---|---|---|---|---|
  | 01 | Thread · light | "Thursday capacity flag" | light | top |
  | 02 | Thread · dark · scrolled to proposal | the same thread | dark | bottom |
  | 03 | New thread · empty state | new | light | top |

- **Props.** `liveModel` (true: uses `window.claude.complete` when it exists), `simulateError`
  (false) and `streamSpeed` (normal).
- **The mock's data** is the fixture for the product's examples (issue P5), replayed through the
  scripted provider. It is all in `Chat Spec.html`:
  - three threads: "Thursday capacity flag", "Dock 4 dwell time" and "Overtime vs plan · week 38";
  - the canned answers, with their components, steps, sources and follow-ups (`CH_CANNED`);
  - the sources' provenance (`CH_CHIPS`), the context items (`CH_CTX`), the demo files
    (`CH_FILES`) and the follow-up texts (`CH_SUG`).

## 15. Deviations from the mock

The larger deviations are listed in the issue. These are the small ones, where the mock takes a
demo shortcut or slips:

| Mock | Product | Why |
|---|---|---|
| A suggestion or follow-up clears the composer's draft, command and attachments | They stay | A click should not lose a half-written message |
| "Thought 2.1 s · 1 steps" | "1 step" | Plural agreement |
| Once every step is done, the live head reads "STEP 1 OF n" | The "Reasoning" row stays active until the text starts (§6.1) | The head always points at a live row |
| The stale roster's link attaches `roster_v8.csv` | An `add` action puts the newer input in the context row | In e3 a newer input is a dataset or record, not a file |
| Feedback reason chips have no `aria-pressed` | They set it | They are toggles |
| The link underline is 1px thick only in paragraphs and lists | 1px everywhere | One link style |
| Copy data never quotes CSV fields | RFC 4180 quoting | Labels can hold commas |
| The stepper's labels are "Fewer pickers" / "More pickers" | "Decrease {field}" / "Increase {field}" | Fields are generic |
