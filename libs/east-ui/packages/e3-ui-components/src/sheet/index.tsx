/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Sheet's shared state and its parts — the planning spreadsheet (`Sheet
 * Spec.md` §6): decode, the row source (both arms), the local data layer
 * (edits over the decoded rows until the source writes back), THE state
 * machine, the effect runner, the copilot runner (§6.2), and what they draw —
 * the toolbar's items · the sticky two-line header · virtualised rows · the
 * docked strip · the footer.
 *
 * The Sheet itself — `<Sheet>`, the `Sheet` extension `@elaraai/e3-ui`
 * declares (#1216) — is `EastChakraSheet` (`frame/index.tsx`): one
 * `BuilderFrame` whose regions hold these parts.
 *
 * Three parts over one shared state (SB4, #1181). `SheetProvider` builds the
 * store, the editing session, the lens and the selection, every hook in the
 * order it always ran, and the frame places what it builds: the toolbar's
 * items (`useSheetToolbarItems()`) in its one toolbar, `SheetGrid` — the
 * header, the rows and the strip, inside `SheetRoot` — in main, which it
 * fills, scrolling its own rows, and the footer (`useSheetFooter()`'s props)
 * in its footer, driving one grid (SB5). Its banners read the session
 * through `useSheetHistory()` (#1184), so the history item shows no error of
 * its own. What the frame hands the parts besides is {@link SheetHost}: the
 * columns the viewer hides, the drops the sheet takes, and what its rail
 * counts each source in.
 *
 * A host with chrome of its own — the Record's title, status line, Add,
 * Delete and footer (#1533) — takes the toolbar's items as parts
 * (`useSheetToolbarParts()`) and lays out its own row of them, and reads the
 * rows as its chrome counts and changes them (`useSheetEntries()`): the rows
 * drawn, how many the narrowing shows of how many the record holds, the last
 * gesture's notice, and a gesture that adds a row and one that removes rows,
 * each one step of the history. It hears each step of the history as it is
 * taken (`SheetHost.onHistory`), to say what the step did in its own words.
 *
 * Its narrowing is one rail over the sheet's `Slice.bindRecords` (#1345):
 * the sheet's rows are its `rows` source's record, every one in the record's
 * order, paged from it, and the source's narrowing is drawn over them as the
 * lens (#1349, `use-lens.ts`) — a filtered spreadsheet: e3 places the
 * narrowing's rows from the source's index, the lens reads the record's
 * segments that hold them near the view, and it draws only the rows the
 * narrowing keeps, one after another, each at its row number, a band at their
 * own pitch standing for those not read yet. A saved view holds every
 * source's narrowing, by the source's name, with a grouped sheet's folds.
 *
 * A row the narrowing hides is reached by clearing the filters that hide it
 * (the shared hidden pick, `shared/schedule/hidden.ts`, `hidden-pick.tsx`):
 * Search Records' line for it, and an issue's line in the Issues tab, name the
 * `rows` source's choices that hide it, as the rail words them — asked of e3
 * through the record's indexes, at the lens's revision, and `· hidden by the
 * filters` until it has said — and a pick of it, or Go to issue on it, clears
 * just them, every other choice kept (every choice, while e3 has not said
 * which): a rail change like any other, which a saved view's tab marks dirty
 * and Esc there reverts. The ring lands on the row once the narrowing they
 * leave draws it, at its row number, the lens's jump landing it.
 *
 * A source-bound transaction session retains draft gestures and history —
 * the editing session every editable collection shares (`src/editing/`,
 * #879), with its history bar in the toolbar, in the sheet's words.
 * onPatch observes each completed gesture; onApply submits a checked batch.
 * Overlays retire only after the source acknowledges the committed result.
 * Function values come from the latest render; submitted callbacks remain
 * captured until their request resolves.
 *
 * The Sheet's memo compares with `equivalentFor` (#809), so a value whose
 * only change is a closure — a swapped provider, an `onPatch` over new data —
 * still re-renders, and every function is taken from the latest value
 * (§6.2). The derivations that own local state (the decoded rows, the
 * controlled selection) key on the value's DATA identity instead, and the
 * transaction session on its source and schema, so such a change never
 * resets them; the copilot's memo is keyed on the value's identity.
 *
 * Grouped rows (#740): the source rows are GROUPS; the body draws each
 * group's band over its lines (pseudo rows tagged with their group), one
 * blank line per open group during the insertion migration. A write on a line
 * rewrites its group (`lineCommit` / `lineInsert` / `lineRemove` carry the
 * whole group after the edit, a line's address as its position); a
 * summary field commits the group. Explicit insertion controls create groups.
 *
 * A line may carry SUB ROWS (#844): read-only rows under the line that
 * share none of its columns, outside the row space, opened by the line's
 * chevron or Space. A gesture
 * that folds or opens moves rows with a short slide, and the rows it brings
 * into view drop in; nothing moves on a scroll, a lens change or a view
 * switch, and nothing at all under reduced motion.
 *
 * The frame's drops (`SheetHost.drop`, #1187) make each row a drop target on
 * the sheet's surface and each row's gutter a grip: its library's templates
 * insert at a seam, its author's cards set their cells on a row or a band,
 * and a row, a line or a group moves to another seam —
 * each drop one transaction, planned by `drop.ts` from the rows as they
 * stand, and the ghost saying where it lands, or why it can't.
 *
 * On a coarse pointer, a frame too narrow for the touch gutter beside the
 * first column FOLDS the gutter (#1215, `gutter.ts`): each row's actions go
 * into one 44 px row-actions button — its grip, and a tap's menu of its
 * decisions and the inserts at it — and the seams offer no chips.
 *
 * `useSheet` builds the parts from hooks, each in a module of its own and
 * each handed what the hooks before it give, called in the order they always
 * ran: the decoded value (`use-decode.ts`); the rows and their editing
 * session (`use-session.ts`); the body the grid walks (`use-body.ts`); the
 * state machine (`use-machine.ts`); saving edits (`use-writes.ts`); the
 * copilot (`use-copilot.ts`); the effect runner (`use-effects.ts`); the
 * gestures that wait for an open editor (`use-gestures.ts`); the pointer and
 * the keyboard (`use-input.ts`); the open editor (`use-open-editor.ts`); what
 * the frame shows while rows are read (`use-reading.ts`); where the view goes
 * (`use-jumps.ts`); the view tabs (`use-view-tabs.tsx`); what is said of the
 * ring's cell (`use-ring.ts`); the rows' scroll (`use-scroll.tsx`); what each
 * row is handed (`use-row-parts.ts`); the action buttons (`use-actions.tsx`);
 * drawing the rows (`use-rows.tsx`); the side panel (`use-inspector.tsx`);
 * drag and drop (`use-drops.ts`); and the parts as the frame places them
 * (`use-assembled.tsx`). What they build is declared in `parts.ts`.
 */

import { createContext, useContext, type ReactNode, type RefObject } from "react";
import { Box } from "@chakra-ui/react";
import { getSomeorUndefined, type ToolbarItem } from "@elaraai/east-ui-components";
import { DensityProvider } from "@elaraai/east-ui-components/internal";
import type { SheetFooterProps } from "./Footer.js";
import type { SheetToolbarParts } from "./Toolbar.js";
import type { SheetRootValue } from "./values.js";
import { useSheetDecode } from "./use-decode.js";
import { useSheetSession } from "./use-session.js";
import { useSheetBody } from "./use-body.js";
import { useSheetMachine } from "./use-machine.js";
import { useSheetWrites } from "./use-writes.js";
import { useSheetCopilot } from "./use-copilot.js";
import { useSheetEffects } from "./use-effects.js";
import { useSheetGestures } from "./use-gestures.js";
import { useSheetInput } from "./use-input.js";
import { useSheetOpenEditor } from "./use-open-editor.js";
import { useSheetReading } from "./use-reading.js";
import { useSheetJumps } from "./use-jumps.js";
import { useSheetViewTabs } from "./use-view-tabs.js";
import { useSheetRing } from "./use-ring.js";
import { useSheetScroll } from "./use-scroll.js";
import { useSheetRowParts } from "./use-row-parts.js";
import { useSheetActions } from "./use-actions.js";
import { useSheetRows } from "./use-rows.js";
import { useSheetInspector } from "./use-inspector.js";
import { useSheetDrops } from "./use-drops.js";
import { useSheetAssembled } from "./use-assembled.js";
import type { SheetEntries, SheetHistory, SheetHost, SheetInspect, SheetLoadingFacts, SheetOptimiseParts, SheetParts, SheetPhoneLibrary } from "./parts.js";

export type {
    SheetOptimiseParts, SheetParts, SheetEntries, SheetPhoneLibrary, SheetLoadingFacts, SheetHistory, SheetHost,
    SheetRowChanges, SheetHostRowProps, SheetHostHeaderProps, SheetHostLayout, SheetHostEmptyProps, SheetHostStripCell,
    SheetHostStripProps, SheetGridHost, SheetCellEditorAt, SheetInspectPlace, SheetInspectTarget, SheetSelected,
    SheetDuplicateOptions, SheetInspectWrite, SheetInspect,
} from "./parts.js";

export type { SheetRootValue, SheetRowValue, SheetCellValue } from "./values.js";

/**
 * Builds the sheet's shared state and the parts it lays out: the root's
 * whole body, its hooks in the order they always ran.
 */
function useSheet(value: SheetRootValue, storageKey: string, host: SheetHost): SheetParts {
    const sheetDecode = useSheetDecode(value, host);
    const sheetSession = useSheetSession(value, storageKey, host, sheetDecode);
    const sheetBody = useSheetBody(sheetDecode, sheetSession);
    const sheetMachine = useSheetMachine(value, sheetDecode, sheetSession, sheetBody);
    const sheetWrites = useSheetWrites(sheetDecode, sheetSession, sheetBody);
    const sheetCopilot = useSheetCopilot(sheetDecode, sheetSession, sheetBody, sheetMachine);
    const sheetEffects = useSheetEffects(sheetDecode, sheetSession, sheetBody, sheetMachine, sheetWrites, sheetCopilot);
    const sheetGestures = useSheetGestures(host, sheetDecode, sheetSession, sheetBody, sheetMachine, sheetWrites,
        sheetEffects);
    const sheetInput = useSheetInput(sheetDecode, sheetSession, sheetBody, sheetMachine, sheetEffects, sheetGestures);
    const sheetOpenEditor = useSheetOpenEditor(sheetDecode, sheetSession, sheetBody, sheetMachine);
    const sheetReading = useSheetReading(sheetDecode, sheetSession, sheetBody);
    const sheetJumps = useSheetJumps(value, sheetDecode, sheetSession, sheetBody, sheetMachine, sheetEffects);
    const sheetViewTabs = useSheetViewTabs(sheetDecode, sheetSession, sheetBody, sheetMachine, sheetOpenEditor);
    const sheetRing = useSheetRing(sheetDecode, sheetSession, sheetBody, sheetMachine, sheetOpenEditor);
    const sheetScroll = useSheetScroll(sheetDecode, sheetSession, sheetBody, sheetMachine, sheetEffects,
        sheetOpenEditor, sheetReading, sheetRing);
    const sheetRowParts = useSheetRowParts(host, sheetDecode, sheetSession, sheetBody, sheetMachine, sheetEffects,
        sheetGestures, sheetReading, sheetRing, sheetScroll);
    const sheetActions = useSheetActions(host, sheetDecode, sheetSession, sheetBody, sheetMachine, sheetWrites,
        sheetEffects, sheetInput);
    const sheetRows = useSheetRows(sheetDecode, sheetSession, sheetBody, sheetGestures, sheetInput, sheetOpenEditor,
        sheetViewTabs, sheetRing, sheetScroll, sheetRowParts, sheetActions);
    const sheetInspector = useSheetInspector(value, sheetDecode, sheetSession, sheetBody, sheetMachine, sheetWrites,
        sheetCopilot, sheetEffects, sheetGestures, sheetOpenEditor, sheetJumps, sheetViewTabs, sheetActions);
    const sheetDrops = useSheetDrops(sheetDecode, sheetSession, sheetBody, sheetMachine, sheetWrites, sheetCopilot,
        sheetEffects, sheetGestures, sheetRowParts, sheetInspector);
    return useSheetAssembled(value, sheetDecode, sheetSession, sheetBody, sheetMachine, sheetEffects, sheetGestures,
        sheetInput, sheetOpenEditor, sheetReading, sheetJumps, sheetViewTabs, sheetRing, sheetScroll, sheetRowParts,
        sheetActions, sheetRows, sheetInspector, sheetDrops);
}

const SheetContext = createContext<SheetParts | undefined>(undefined);

/** The shared state the parts read; a part outside a {@link SheetProvider} is a mistake of the frame's, and throws. */
function useSheetParts(): SheetParts {
    const parts = useContext(SheetContext);
    if (parts === undefined) throw new Error("A Sheet part is placed outside a SheetProvider");
    return parts;
}

export interface SheetProviderProps {
    /** The Sheet root value. */
    value: SheetRootValue;
    /** Storage key prefix for persisting component state. */
    storageKey: string;
    /** What the frame hands the parts: the columns hidden, and the drops taken; nothing by default. */
    host?: SheetHost | undefined;
    /** Where the frame places the parts. */
    children: ReactNode;
}

const NO_HOST: SheetHost = {};

/**
 * Provides the sheet's one shared state (SB4): the store, the editing
 * session, the lens and the selection, for the parts below it, wherever the
 * frame places them (SB5). The declared density reaches every one of them.
 */
export function SheetProvider({ value, storageKey, host = NO_HOST, children }: SheetProviderProps) {
    const parts = useSheet(value, storageKey, host);
    const provided = <SheetContext.Provider value={parts}>{children}</SheetContext.Provider>;
    const densityTag = getSomeorUndefined(value.density)?.type;
    return densityTag !== undefined
        ? <DensityProvider value={densityTag}>{provided}</DensityProvider>
        : provided;
}

/**
 * Reads the toolbar's items (§7) in the row's order and on its fold ladder:
 * the view tabs, the count, the key search, the slice's rail, the scope badge
 * and the history item. The frame lays them out with
 * the shared `Toolbar`, and puts {@link useSheetToolbarRef}'s ref on the
 * element that holds them.
 *
 * @returns The items, a falsy entry for each the sheet has no use for.
 */
export function useSheetToolbarItems(): ReadonlyArray<ToolbarItem | false | undefined> {
    return useSheetParts().toolbar.items;
}

/**
 * Reads the toolbar's items as parts (#1533) — the view tabs, the count line,
 * the key search, the rail, the scope badge, the Elara eye and the history
 * item, each with its forms and its fold ranks — for a host that lays out a
 * row of its own from some of them: the Record's title, the rail, its status
 * line, Add and Delete, and the history.
 *
 * @returns The parts, `undefined` for each the sheet has no use for
 */
export function useSheetToolbarParts(): SheetToolbarParts {
    return useSheetParts().toolbar.parts;
}

/**
 * Reads the rows as a host's own chrome counts and changes them (#1533): the
 * rows drawn, how many the narrowing shows of how many the record holds, the
 * last gesture's notice, the gestures recorded, and the host's Add and
 * Delete.
 *
 * @returns The rows' counts, the notice and the two gestures — the gestures stable
 */
export function useSheetEntries(): SheetEntries {
    return useSheetParts().entries;
}

/**
 * Reads the ref for the element that holds the toolbar's items: ⌘F and ⌘/
 * in the grid put the focus on the key search in it — its box, or, folded to
 * its icon, the box in its popover (#1221) — else on the first search box.
 *
 * @returns The ref, for the element the frame lays the items out in.
 */
export function useSheetToolbarRef(): RefObject<HTMLDivElement | null> {
    return useSheetParts().toolbar.ref;
}

/**
 * Reads the footer's props: the counts, the key hint, the live message and
 * what the loading line says of a paged source, for the footer the frame
 * places.
 *
 * @returns The props of the sheet's footer.
 */
export function useSheetFooter(): SheetFooterProps {
    return useSheetParts().footer;
}

/**
 * Reads how the frame shows a paged source being read (#1398): its cold load
 * — the frame's skeleton, at the rows' pitch — and a read in flight after it,
 * which leaves everything live and the region being read busy.
 *
 * @returns The facts the frame takes as `loading`, `busy` and `loadingPitch`
 */
export function useSheetLoading(): SheetLoadingFacts {
    return useSheetParts().loading;
}

/**
 * Reads the editing session and its history actions, for the frame's
 * banners (`SessionBanners`), which show the session's state, their Retry
 * and Discard run as the history item's do.
 *
 * @returns The session, and the actions' runner
 */
export function useSheetHistory(): SheetHistory {
    return useSheetParts().history;
}

/**
 * Reads what the inspector pane shows of the sheet and the gestures it
 * makes (#1188): what is selected — one row, line or band, several rows, or
 * nothing — each target's draft against what the record holds, the batch's
 * issues, and the writes, each one transaction as typing in the grid is.
 *
 * @returns The sheet's inspector facts and gestures
 */
export function useSheetInspect(): SheetInspect {
    return useSheetParts().inspect;
}

/**
 * Reads what the frame places of a run of the app's optimiser (#1409, #1418):
 * the banner the result lands with, for the banners slot before the
 * session's, and the landing — the ref, the attributes and the styles for
 * the frame's own root, under which the cascade is measured and from which
 * the cells' flares, the glow and the counts' flash are drawn.
 *
 * @returns The run's parts for the frame
 */
export function useSheetOptimise(): SheetOptimiseParts {
    return useSheetParts().optimise;
}

/**
 * Reads what the library pane calls on a card's ⏎ (#1187, SB45): the card,
 * by its library and its key, taken as a drop below the ring's row — a
 * template inserted after it, an author's card's cells set on it — or, where
 * that is refused, why, in the footer.
 *
 * @returns The ⏎ — stable
 */
export function useSheetDropEnter(): (library: string, key: string) => void {
    return useSheetParts().enter;
}

/**
 * Reads what a phone's Library reads of the sheet, and the taps it makes (`Mobile Sheet Spec.md` SH11, R7).
 *
 * @returns What a card's tap acts on, whether a card is what it holds now, the tap, and the go to a column
 */
export function useSheetPhoneLibrary(): SheetPhoneLibrary {
    return useSheetParts().phoneLibrary;
}

/**
 * Renders the element the grid is laid in: the sheet's root, its recipe's
 * root styles, and the attributes its rows' styles key on (`data-sheet`,
 * `data-lens`, `data-view`, `data-moving`, …). It fills the frame's main
 * region, and the grid in it scrolls its own rows.
 */
export function SheetRoot({ children }: { children: ReactNode }) {
    const { styles, root } = useSheetParts();
    return (
        <Box css={styles.root} data-sheet data-sheet-partial={root.partial ? "" : undefined} data-copilot={root.copilot ? "" : undefined}
            data-lens={root.lens ? "" : undefined} data-view={root.view} data-moving={root.moving ? "" : undefined}>
            {children}
        </Box>
    );
}

/**
 * Renders the grid with its strip: the header, the rows, the insertion
 * controls, and the strip docked under them — or, when the source failed
 * before any row landed, why, with its Retry (#853).
 */
export function SheetGrid() {
    const parts = useSheetParts();
    return parts.failure ?? parts.grid;
}
