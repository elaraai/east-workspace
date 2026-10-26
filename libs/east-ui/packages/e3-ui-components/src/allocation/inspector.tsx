/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Inspector (`Allocation Spec.md` §8, §9.8, A55–A64, #1331): the end
 * pane's two tabs. Details shows a refused drop's note (A40), the drop list
 * during a drag or a pick (A34), else the selection — a bin (A56–A59), a free
 * slot (A60), a reservation (A61), a resource (A62) — else the summary (A63);
 * Issues groups every issue with its fix (A64). A bin's Assigned to holds its
 * parts (A70–A74, #1332): each part's quantity a field, the remainder in
 * warn, `Split…` to put the remainder — or, with none, some of a part — on
 * another resource (`split.tsx`, #1362), and Find a fit.
 * The bin's own fields — those no role maps — are the bin kind's: its form
 * over its `fields` (`FieldForm`), or its own `inspector` over the row, in
 * place of the quantity and the rows (#1372). A bin's key is printed first
 * among its facts, and a reservation's in a section of its own: what Search
 * Records finds them by (#1398). Every edit is one of the
 * board's commands, a draft of the bins' session until Save; every fit is the
 * app's answer; every figure and word is e3-ui's or `inspector-model.ts`'s. The parts are the shared inspector's — its head,
 * its sections, its counts — with FieldForm, the Chooser, the anchored
 * popover, the banner, the segments, the stepper and the meter; the
 * `allocationInspector` recipe owns every style.
 *
 * @packageDocumentation
 */

import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, type ReactNode } from "react";
import { Box, Button, chakra, useSlotRecipe } from "@chakra-ui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
    faArrowRight, faArrowsSplitUpAndLeft, faChevronDown, faChevronUp, faCircleCheck, faCircleExclamation, faLinkSlash, faMagnifyingGlass, faMinus, faPlus,
    faRotateLeft, faTriangleExclamation, faXmark,
} from "@fortawesome/free-solid-svg-icons";
import { DateTimeType, FloatType, OptionType, StringType, StructType, none, some, variant, type SortedMap, type option } from "@elaraai/east";
import { Fields, type FieldSpecValue } from "@elaraai/east-ui";
import {
    BannerView, EastChakraComponent, FieldForm, fieldFormMessages, useDropCell, useFormatters, useTrackedEvaluation, type BuilderFrameDock,
    type FieldFormWords,
} from "@elaraai/east-ui-components";
import { Chooser, formatDatePattern } from "@elaraai/east-ui-components/internal";
import { ScheduleInspectorHead } from "../shared/schedule/inspector-head.js";
import { Seg } from "../shared/schedule/segments.js";
import { linkedQuantity, remainderOf, splitOf, type AllocationCommands } from "./actions.js";
import { resourceChoices } from "./choices.js";
import { dropTarget, landing, placeAsk, rowCoord, type AllocationDrag, type Grip, type Refusal, type Target } from "./drag.js";
import type { AllocationFit } from "./fit.js";
import {
    CHECKING, alternativesOf, bannersOf, batchLine, binCode, binStatus, bookOptions, dropHeadOf, factsOf, fixLabel, groupLine, issueGroups, matesOf,
    narrowingNote, rankedFits, reservationStatus, reserveOptions, resourceStatus, stepHelp, summaryHints, summaryLine, summaryStats, verdictLine, wasLine,
    type BookOption, type InspectorBanner, type InspectorStatus, type InspectorWords, type ResourceAt,
} from "./inspector-model.js";
import type { AllocationMessages } from "./messages.js";
import {
    allocationWords, compareFloat, partsOf, type AllocationDomain, type AllocationValue, type Bin, type Context, type Day, type Issue, type Load,
    type ResourceLine, type Selection, type Slot,
} from "./model.js";
import { a, one, other } from "./nouns.js";
import { SplitPopover } from "./split.js";
import { RESERVE_PROBE } from "./table.js";
import { resourceAxis } from "./timeline-layout.js";
import { countedIssues } from "./toolbar.js";

type Styles = Record<string, Record<string, unknown>>;

/**
 * The Bin section's fields (A57): its key, printed — what Search Records finds it by (#1398) — its lane and its time, each
 * drawn by the board in the shared field, and its quantity.
 */
const BIN_FIELDS = StructType({ key: StringType, lane: StringType, at: DateTimeType, quantity: FloatType });
/** A reservation's own field: its key, printed (#1398). */
const RESERVATION_FIELDS = StructType({ key: StringType });
/** A printed field takes no edit. */
const NO_EDIT = () => {};
/** A part's field (A71): its quantity, an Option so its Clear unlinks it. */
const PART = OptionType(FloatType);
/** A bin's parts as a struct: a field per part, named by its resource's key, as the bin's parts are keyed — the key the shared field shows. */
const partsType = (keys: readonly string[]) => StructType(Object.fromEntries(keys.map(key => [key, PART])));

/** The Inspector's args: what the board knows, and what it can do. */
export interface InspectorArgs {
    value: AllocationValue;
    domain: AllocationDomain;
    context: Context;
    /** The plan day. */
    day: Date;
    /** The day as drafted, and as the record holds it. */
    plan: Day;
    held: Day | undefined;
    loads: SortedMap<string, Load>;
    lines: ReadonlyMap<string, ResourceLine>;
    slots: readonly Slot[];
    /** Every issue: the built-in checks', then the app's. */
    issues: readonly Issue[];
    layout: "timeline" | "table";
    selection: Selection | undefined;
    /** An inspection: what a click in the inspector selects, showing it in Details (A8). */
    inspect: (next: Selection) => void;
    drag: AllocationDrag;
    fit: AllocationFit;
    commands: AllocationCommands;
    /** The day without a bin, and with a probe reservation in a free slot: what a reservation's and a free slot's questions are asked of. */
    without: (bin: string) => Day;
    reserving: (lane: string, at: Date) => Day;
    /** What the narrowing shows of each source; `none`, every row. */
    shown: { lanes: option<Set<string>>; resources: option<Set<string>>; arrivals: option<Set<string>> };
    /** A refused drop's reason (A40), and its dismissal. */
    refusal: Refusal | undefined;
    dismissRefusal: () => void;
    /** The bin whose resource Chooser is open in the pane (A8, A21, A64), and opening or closing it. */
    chooser: string | undefined;
    setChooser: (bin: string | undefined) => void;
    /** Books the picked arrival onto a resource, as a click on a ranked resource does (A11, A36). */
    book: (target: Target) => void;
    /** The day's first free slot, of the lanes that show (A36). */
    firstFree: () => { lane: string; at: Date } | undefined;
    /** The open tab, the board's. */
    tab: string;
    onTab: (tab: string) => void;
    storageKey: string;
    /** Finds a fit for a bin's unallocated quantity (A74, #1332): with none — no Library's Resources tab to show the fits in — nothing offers it. */
    onFind?: ((bin: string) => void) | undefined;
    /** Whether a bin's find is asked and its answer for the drafts as they are is on its way: its button reads `Finding…`. */
    finding?: ((bin: string) => boolean) | undefined;
    /** The board's message table: what a bin's Details call its key. */
    m: AllocationMessages;
}

/** What every part reads. */
interface Part { args: InspectorArgs; styles: Styles; words: InspectorWords; horizonEnd: Date }

/** `1 issue`, `3 issues`. */
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
const timeText = (at: Date) => formatDatePattern("HH:mm", at);
const dayLong = (at: Date) => formatDatePattern("ddd D MMM", at);

/**
 * The end pane (see the module docs).
 *
 * @param args - See {@link InspectorArgs}
 * @returns The pane, or `undefined` when the board has no inspector
 */
export function useAllocationInspector(args: InspectorArgs): BuilderFrameDock | undefined {
    const recipe = useSlotRecipe({ key: "allocationInspector" });
    const styles = useMemo(() => recipe({}) as unknown as Styles, [recipe]);
    const { value, context } = args;
    const board = allocationWords();
    const unit = context.unit;
    const words = useMemo((): InspectorWords => ({
        nouns: value.labels, quantity: v => board.quantity(v, unit), number: v => board.quantity(v, ""),
        lane: key => value.lanes.find(l => l.key === key)?.label ?? key, load: (fill, row) => board.load(fill, row, unit),
    }), [value.labels, value.lanes, board, unit]);
    // The Timeline's resource axis's end: what `none planned to` names (A58, A85).
    const horizon = value.settings.horizon;
    const horizonEnd = useMemo(() => resourceAxis(args.day, Number(board.ms(horizon.before)), Number(board.ms(horizon.after))).to, [args.day, board, horizon]);
    if (!value.inspector) return undefined;
    const count = countedIssues(args.issues).length;
    // A drag shows Details, where its drop list is (A22, A34); the viewer's tab comes back as it ends.
    const dragging = args.drag.grip !== undefined;
    const part: Part = { args, styles, words, horizonEnd };
    return {
        label: "Inspector", icon: "sliders", size: "320px", persist: "local", active: args.selection !== undefined,
        // The rail's badge is the issues' count (A55), and its mark says there are some.
        ...(count > 0 ? { badge: count, mark: { icon: "triangle-exclamation", label: plural(count, "issue"), tone: "warning" as const } } : {}),
        tab: dragging || args.tab !== "issues" ? "details" : "issues", onTabChange: args.onTab,
        tabs: [
            { key: "details", label: "Details", body: <Box css={styles.root} data-allocation-inspector="details"><Details {...part} /></Box> },
            { key: "issues", label: "Issues", count, body: <Box css={styles.root} data-allocation-inspector="issues"><IssuesTab {...part} /></Box> },
        ],
    };
}

/** Details (A55): the refusal's note, the drop list during a drag or a pick, else what is selected, else the summary. */
function Details(part: Part) {
    const { args, styles } = part;
    const dragging = args.drag.grip !== undefined;
    const subject = args.drag.subject;
    const inspected = dragging ? undefined : selected(part);
    return <>
        {args.refusal !== undefined && !dragging && <Box css={styles.refusal} data-allocation-refusal="">
            <BannerView status="warning" icon={{ prefix: "fas", name: "triangle-exclamation" }} title={args.refusal.word} description={args.refusal.text}
                dismissible onDismiss={args.dismissRefusal} />
        </Box>}
        {subject !== undefined && <DropList {...part} subject={subject} dragging={dragging} />}
        {inspected ?? (subject === undefined && <Summary {...part} />)}
    </>;
}

/** What the selection shows, or `undefined` for none — a bin the drafts removed included. */
function selected(part: Part): ReactNode | undefined {
    const { selection, plan } = part.args;
    if (selection === undefined) return undefined;
    if (selection.type === "bin") {
        const bin = plan.bins.get(selection.id);
        if (bin === undefined) return undefined;
        return bin.arrival.type === "none" ? <ReservationDetails key={selection.id} {...part} id={selection.id} bin={bin} />
            : <BinDetails key={selection.id} {...part} id={selection.id} bin={bin} />;
    }
    if (selection.type === "slot") return <SlotDetails key={`${selection.lane}|${selection.at}`} {...part} lane={selection.lane} at={new Date(selection.at)} />;
    return part.args.context.resources.has(selection.key) ? <ResourceDetails key={selection.key} {...part} resource={selection.key} /> : undefined;
}

/** The resources a bin is on, or one inspected: their rows, loads and lines. */
function resourcesAt(args: InspectorArgs, keys: readonly string[]): ResourceAt[] {
    return keys.flatMap(key => {
        const row = args.context.resources.get(key), load = args.loads.get(key), line = args.lines.get(key);
        return row === undefined || load === undefined || line === undefined ? [] : [{ row, load, line }];
    });
}

/** A head's status, as the shared head draws it. */
const statusOf = (status: InspectorStatus) => ({ label: status.word, tone: { type: status.tone }, ring: status.ring });

/** The banners, each the shared banner in its section (A56, A62). */
function Banners({ styles, banners }: { styles: Styles; banners: readonly InspectorBanner[] }) {
    return <>{banners.map((banner, i) => <Box key={i} css={styles.banner} data-allocation-banner={banner.title}>
        <BannerView status={banner.status} icon={{ prefix: "fas", name: banner.status === "error" ? "circle-exclamation" : "triangle-exclamation" }}
            title={banner.title} description={banner.text} />
    </Box>)}</>;
}

/**
 * The drop list (A34, A86): what is dragged or picked, the three best fits as
 * drop targets — each a Book while a pick waits for its click — and the
 * layout's hint.
 */
function DropList({ subject, dragging, ...part }: Part & { subject: Grip; dragging: boolean }) {
    const { args, styles, words } = part;
    const { drag, context } = args;
    const head = dropHeadOf({
        subject, dragging, layout: args.layout, day: args.day, plan: args.plan, held: args.held, context, loads: args.loads, lines: args.lines,
        quantity: drag.asked?.quantity, basis: drag.answer?.basis, firstFree: dragging ? undefined : args.firstFree(), words,
    });
    const fits = head.fits ? rankedFits(drag.answer, drag.ranks, context) : [];
    return <>
        <Box css={styles.head} data-allocation-drop-head="">
            <Box css={styles.eyebrow}>{head.eyebrow}</Box>
            <Box css={styles.name}>{head.title}</Box>
            {head.meta !== "" && <Box css={styles.when}>{head.meta}</Box>}
        </Box>
        <Box css={styles.section} data-allocation-drop-list="">
            {fits.map(fit => <DropRow key={fit.key} {...part} target={{ kind: "resource", resource: fit.key }} rank={fit.rank} name={fit.name} why={fit.why} book={!dragging} />)}
            {head.fits && fits.length === 0 && <Box css={styles.absent} data-allocation-drop-none="">
                {args.fit.error !== undefined ? "fits unavailable" : drag.answer === undefined ? CHECKING : `no ${one(words.nouns.resource)} has a gap that fits`}
            </Box>}
            <Box css={styles.line} data-allocation-drop-hint="">{head.hint}</Box>
        </Box>
    </>;
}

/**
 * A fit in the drop list: a drop target as its resource's row is (A26) — the
 * board's one drop target, so a drag resting on it draws the resource's links
 * and marks its bins as its row does (A29, A65) — and with a pick its Book (A34).
 */
function DropRow({ args, styles, target, rank, name, why, book }: Part & { target: Extract<Target, { kind: "resource" }>; rank: number; name: string; why: string; book: boolean }) {
    const { drag } = args;
    const { veto, options } = dropTarget(drag, target);
    const ref = useDropCell(drag.enabled ? rowCoord(drag.surface, target.resource) : null, false, veto, undefined, options);
    return <Box ref={ref} css={styles.dropRow} data-allocation-drop-row={target.resource}>
        <Box as="span" css={styles.dropRank}>{rank}</Box>
        <Box as="span" data-drop-row="name">{name}</Box>
        <Box as="span" data-drop-row="action">{book && args.commands.canEdit() && <Button size="xs" variant="outline" onClick={() => args.book(target)}>Book</Button>}</Box>
        <Box as="span" data-drop-row="why">{why}</Box>
    </Box>;
}

/** A bin (A56–A59): its head and actions, its banners, the Bin section, Assigned to, the other gaps that fit, its arrival's details and its `was` line. */
function BinDetails({ id, bin, ...part }: Part & { id: string; bin: Bin }) {
    const { args, styles, words } = part;
    const { context, held, domain, commands, issues, day, plan, fit } = args;
    const nouns = words.nouns;
    const editable = commands.canEdit();
    const committed = held?.bins.get(id);
    const draft = committed === undefined || !domain.sameBin(committed, bin);
    const parts = partsOf(bin);
    const current = parts[0]?.key;
    const at = resourcesAt(args, parts.map(p => p.key));
    const status = binStatus(bin, committed, domain.sameBin, at.map(r => r.line));
    const code = binCode(context, bin);
    const arrival = bin.arrival.type === "some" ? context.arrivals.get(bin.arrival.value) : undefined;
    const banners = bannersOf({ issues, bin: { id, code }, resources: at, day, words });
    // Its connector's question (A23, F1): asked as the bin was selected; its answer ranks the other gaps (A59).
    const asked = placeAsk(plan, { kind: "port", bin: id });
    const alternatives = alternativesOf(asked === undefined ? undefined : fit.answer(asked.ask), current, context);
    const moves = linkedQuantity(bin, undefined)?.from !== undefined;
    // Find a fit (A74): a bin's action while its parts leave some of it unallocated. It edits nothing, so a day that takes no edit offers it too.
    const find = args.onFind !== undefined && compareFloat(remainderOf(bin), 0) > 0 ? args.onFind : undefined;
    return <>
        <ScheduleInspectorHead styles={styles} kind={{ name: committed === undefined ? "New bin" : `Bin ${id}`, icon: "box" }} title={`${code} · ${words.quantity(bin.quantity)}`}
            when={arrival?.meta.type === "some" ? arrival.meta.value : undefined} status={statusOf(status)} pending={status.pending}>
            {(editable || find !== undefined) && <Box css={styles.headActions} data-allocation-bin-actions="">
                {editable && bin.parts.size > 0 && <Button size="xs" variant="outline" onClick={() => commands.unlink(id)}><FontAwesomeIcon icon={faLinkSlash} />Unlink</Button>}
                {editable && committed !== undefined && draft && <Button size="xs" variant="outline" onClick={() => commands.revert(id)}><FontAwesomeIcon icon={faRotateLeft} />Revert</Button>}
                {editable && <Button size="xs" variant="outline" onClick={() => commands.remove(id)}><FontAwesomeIcon icon={faXmark} />Back to {nouns.arrival.other}</Button>}
                {find !== undefined && <Button size="xs" variant="outline" data-allocation-find="" onClick={() => find(id)}>
                    <FontAwesomeIcon icon={faMagnifyingGlass} />{args.finding?.(id) === true ? "Finding…" : "Find a fit"}
                </Button>}
            </Box>}
        </ScheduleInspectorHead>
        <Banners styles={styles} banners={banners} />
        <BinSection {...part} id={id} bin={bin} committed={committed} />
        <AssignedTo {...part} id={id} bin={bin} current={current} at={at[0]} />
        <Box css={styles.section} data-allocation-alternatives="">
            <Box css={styles.sectionHead}>{bin.parts.size > 0 ? "Other gaps that fit" : "Gaps that fit"}</Box>
            {alternatives === undefined ? <Box css={styles.absent}>{fit.error !== undefined ? "fits unavailable" : CHECKING}</Box>
                : alternatives.length === 0 ? <Box css={styles.absent}>no other free gap is long enough</Box>
                    : alternatives.map(o => <Box key={o.key} css={styles.option} data-ranked="" data-allocation-alternative={o.key}>
                        <Box as="span" css={styles.rank}>{o.rank}</Box>
                        <Box css={styles.optionText}><Box css={styles.optionName}>{o.name}</Box><Box css={styles.optionLine} title={o.why}>{o.why}</Box></Box>
                        {editable ? <Button size="xs" variant="outline" onClick={() => commands.link(id, o.key, undefined)}>{moves ? "Move" : "Link"}</Button> : <span />}
                    </Box>)}
        </Box>
        {arrival !== undefined && arrival.details.length > 0 && <Box css={styles.section} data-allocation-details="">
            <Box as="dl" css={styles.rows}>{arrival.details.map((detail, i) => <Fragment key={i}>
                <Box as="dt" css={styles.rowLabel}>{detail.label}</Box><Box as="dd" css={styles.rowValue} data-text="">{detail.value}</Box>
            </Fragment>)}</Box>
        </Box>}
        {draft && <Box css={styles.was} data-allocation-was=""><span>{wasLine(committed, context, words)}</span></Box>}
    </>;
}

/**
 * The Bin section (A57): its key, printed — what Search Records finds it by
 * (#1398) — its lane — the shared segments, a change its lane's slot in the
 * same hour — its time — the shared stepper, a slot at a time — and its
 * quantity, each a field of the shared form; then the row's own
 * fields, the bin kind's form over its `fields`, and the app's columns as
 * rows — or, with the bin kind's own `inspector`, that form over the row in
 * place of the quantity, the fields and the rows.
 */
function BinSection({ id, bin, committed, ...part }: Part & { id: string; bin: Bin; committed: Bin | undefined }) {
    const { args, styles, words } = part;
    const { value, slots, plan, commands, day, context, shown } = args;
    const nouns = words.nouns;
    const editable = commands.canEdit();
    const form = value.bin.kind.inspector.type === "some" ? value.bin.kind.inspector.value : undefined;
    // Its lane's slots, in time order, and the one it is in.
    const laneSlots = useCallback((lane: string) => slots.filter(s => s.lane === lane), [slots]);
    const own = laneSlots(bin.lane);
    const index = own.findIndex(s => s.bins.includes(id));
    const { move } = commands;
    const toSlot = useCallback((lane: string, k: number) => {
        const slot = laneSlots(lane)[k];
        if (slot !== undefined) move(id, lane, landing(slots, plan, lane, slot.at, id));
    }, [laneSlots, move, id, slots, plan]);
    // The lanes the narrowing shows, and its own (A92).
    const lanes = value.lanes.filter(l => shown.lanes.type === "none" || shown.lanes.value.has(l.key) || l.key === bin.lane);
    // The quantity a split or partly allocated bin keeps is what its parts take; a bin wholly on one resource takes its part with it.
    const parts = partsOf(bin);
    const whole = parts.length === 1 && compareFloat(parts[0]!.quantity, bin.quantity) === 0;
    const min = whole ? 0 : parts.reduce((n, p) => n + p.quantity, 0);
    const help = stepHelp(own, bin.lane, value.every, day, words);
    const quantityLabel = nouns.quantity;
    const keyLabel = args.m.binKey();
    const specs = useMemo(() => Fields.specs(BIN_FIELDS, {
        key: Fields.readonly({ label: keyLabel }),
        lane: Fields.text({ label: nouns.lane.one }),
        at: Fields.readonly({ label: "Bin time", help }),
        quantity: Fields.number({ label: quantityLabel, min, step: 1, ...(context.unit === "" ? {} : { unit: context.unit }) }),
    }, form !== undefined ? ["quantity"] : []), [keyLabel, nouns.lane.one, help, quantityLabel, min, context.unit, form]);
    const stepper = useSlotRecipe({ key: "stepper" })({ tone: "neutral", size: "md" }) as unknown as Styles;
    const hourly = value.every.type === "hours" && compareFloat(value.every.value, 1) === 0;
    const earlier = hourly ? "One hour earlier" : "One slot earlier", later = hourly ? "One hour later" : "One slot later";
    const renderControl = useCallback((spec: FieldSpecValue): ReactNode | undefined => {
        if (spec.path[0] === "lane") {
            return <Seg fullWidth label={nouns.lane.one} scope="allocation" name="inspector-lane" items={lanes.map(l => ({ key: l.key, label: l.label, disabled: !editable }))}
                active={bin.lane} onPick={lane => { if (lane !== bin.lane) toSlot(lane, Math.max(0, index)); }} />;
        }
        if (spec.path[0] === "at") {
            return <Box css={stepper.root} data-allocation-stepper="">
                <chakra.button type="button" css={stepper.button} aria-label={earlier} title={earlier} disabled={!editable || index <= 0}
                    onClick={() => toSlot(bin.lane, index - 1)}><FontAwesomeIcon icon={faMinus} /></chakra.button>
                <Box as="span" css={stepper.value} data-allocation-time="">{timeText(bin.at)}</Box>
                <chakra.button type="button" css={stepper.button} aria-label={later} title={later} disabled={!editable || index < 0 || index >= own.length - 1}
                    onClick={() => toSlot(bin.lane, index + 1)}><FontAwesomeIcon icon={faPlus} /></chakra.button>
            </Box>;
        }
        return undefined;
    }, [nouns.lane.one, lanes, editable, bin.lane, bin.at, toSlot, index, own.length, stepper, earlier, later]);
    const { setQuantity } = commands;
    const onChange = useCallback((path: readonly string[], next: unknown) => { if (path[0] === "quantity") setQuantity(id, next as number); }, [setQuantity, id]);
    const shownValue = useMemo(() => ({ key: id, lane: bin.lane, at: bin.at, quantity: bin.quantity }), [id, bin.lane, bin.at, bin.quantity]);
    // What the drafts began from: the bin as the day holds it, or nothing for a new one, every field of which is a draft.
    const baseline = useMemo(() => committed === undefined ? {} : { key: id, lane: committed.lane, at: committed.at, quantity: committed.quantity }, [committed, id]);
    return <Box css={styles.fields} data-allocation-bin-section="">
        <Box css={styles.sectionHead}>Bin</Box>
        <FieldForm specs={specs} value={shownValue} baseline={baseline} onChange={onChange} readOnly={!editable} renderControl={renderControl} />
        {form !== undefined ? <CustomBin {...part} id={id} bin={bin} form={form} /> : <>
            <RowFields {...part} id={id} bin={bin} committed={committed} />
            <ValueRows {...part} bin={bin} />
        </>}
    </Box>;
}

/** The row's own fields (`Builder Interfaces Spec.md` §1, rule 2): the bin kind's form over its `fields`, each edit one command, a draft until Save. */
function RowFields({ args, id, bin, committed }: Part & { id: string; bin: Bin; committed: Bin | undefined }) {
    const { value, commands } = args;
    const { field } = commands;
    const onChange = useCallback((path: readonly string[], next: unknown) => { field(id, path, next); }, [field, id]);
    if (value.bin.kind.fields.length === 0) return null;
    return <FieldForm specs={value.bin.kind.fields} value={bin.row} baseline={committed?.row ?? {}} onChange={onChange} readOnly={!commands.canEdit()} />;
}

/** The app's columns as rows (A57): each column's text, in warn-text 600 when its tone warns; read through the app's callbacks over the bin's row. */
function ValueRows({ args, styles, bin }: Part & { bin: Bin }) {
    const { value, domain } = args;
    const read = useCallback(() => {
        const bytes = domain.encodeRow(bin.row);
        return value.columns.map(column => {
            const tone = column.tone.type === "some" ? column.tone.value(bytes) : undefined;
            return { key: column.key, label: column.label, text: column.text(bytes), warn: tone?.type === "some" && (tone.value.type === "warning" || tone.value.type === "danger") };
        });
    }, [value.columns, domain, bin.row]);
    const { result } = useTrackedEvaluation(read);
    // A column that fails shows nothing, as the Table's does.
    if (!result.ok || result.value.length === 0) return null;
    return <Box as="dl" css={styles.rows} data-allocation-values="">{result.value.map(row => <Fragment key={row.key}>
        <Box as="dt" css={styles.rowLabel}>{row.label}</Box>
        <Box as="dd" css={styles.rowValue} data-tone={row.warn ? "warning" : undefined}>{row.text}</Box>
    </Fragment>)}</Box>;
}

/** The bin kind's own form (`Schedule.events(record, { …, inspector })`): over the bin's row, its writer one command of the bins' session — a draft until Save, never a write of the record. */
function CustomBin({ args, styles, id, bin, form }: Part & { id: string; bin: Bin; form: Extract<InspectorArgs["value"]["bin"]["kind"]["inspector"], { type: "some" }>["value"] }) {
    const { domain, commands, storageKey } = args;
    // The writer stays the same function while the bin does: the latest commands run it.
    const live = useRef(commands);
    live.current = commands;
    const bytes = useMemo(() => domain.encodeRow(bin.row), [domain, bin.row]);
    const write = useCallback((edited: Uint8Array): null => { live.current.row(id, edited); return null; }, [id]);
    const read = useCallback(() => form(bytes, write), [form, bytes, write]);
    const { result } = useTrackedEvaluation(read);
    if (!result.ok) return <Box role="alert" css={styles.error}>The bin form could not be rendered.</Box>;
    return <chakra.fieldset css={styles.edits} disabled={!commands.canEdit()} data-allocation-bin-form="">
        <Box css={styles.custom}><EastChakraComponent value={result.value} storageKey={`${storageKey}.inspector.bin.${id}`} /></Box>
    </chakra.fieldset>;
}

/** The shared meter's track, its fill in the load's tone, and the min tick (A58). */
function Meter({ styles, at, tone }: { styles: Styles; at: ResourceAt; tone: "brand" | "warning" | "danger" }) {
    const meter = useSlotRecipe({ key: "meter" })({ thickness: "md", tone }) as unknown as Styles;
    const { row, load } = at;
    const fill = row.max > 0 ? Math.min(100, load.fill / row.max * 100) : 0, tick = row.max > 0 ? Math.min(100, row.min / row.max * 100) : 0;
    return <Box css={styles.meter} data-allocation-meter="" role="img" aria-label={`${row.label}: ${Math.round(fill)}% of its max`}>
        <Box css={meter.track}><Box css={meter.fill} style={{ width: `${fill}%` }} /></Box>
        <Box css={styles.meterTick} style={{ left: `${tick}%` }} data-allocation-min="" />
    </Box>;
}

/** Before · Hold · Next fill (A58, A62). */
function Facts({ styles, at, words, day, horizonEnd }: { styles: Styles; at: ResourceAt; words: InspectorWords; day: Date; horizonEnd: Date }) {
    const facts = factsOf(at, day, horizonEnd, words);
    return <Box as="dl" css={styles.rows} data-allocation-facts="">
        <Box as="dt" css={styles.rowLabel}>Before</Box><Box as="dd" css={styles.rowValue}>{facts.before}</Box>
        <Box as="dt" css={styles.rowLabel}>Hold</Box><Box as="dd" css={styles.rowValue} data-absent={facts.hold.absent ? "" : undefined}>{facts.hold.text}</Box>
        <Box as="dt" css={styles.rowLabel}>Next fill</Box><Box as="dd" css={styles.rowValue} data-tone={facts.next.warn ? "warning" : undefined}>{facts.next.text}</Box>
    </Box>;
}

/** A resource's bins today (A58, A62): a click selects one; the inspected one bold. */
function Mates({ args, styles, words, resource, current }: Part & { resource: string; current: string | undefined }) {
    const mates = matesOf(args.plan, args.held, resource, args.context, words);
    if (mates.length === 0) return <Box css={styles.absent}>no bins today</Box>;
    return <Box css={styles.mates} data-allocation-mates="">{mates.map(mate => <chakra.button key={mate.id} type="button" css={styles.mate} title={mate.tip}
        data-current={mate.id === current ? "" : undefined} data-allocation-mate={mate.id} onClick={() => args.inspect({ type: "bin", id: mate.id })}>
        <span data-mate="time">{mate.time}</span><span data-mate="lane">{mate.lane}</span><span data-mate="code">{mate.code}</span><span data-mate="quantity">{mate.quantity}</span>
    </chakra.button>)}</Box>;
}

/**
 * Assigned to (A58): the resource field — its name, or `+ Choose a resource`
 * in warn — which opens the shared Chooser in the pane, every section of it
 * the fit's answer, as the Table's chevron does (A48); then the fill and its
 * meter, the group line, Before · Hold · Next fill, the resource's bins today
 * and the batch line. Not linked: the field, and the layout's hint.
 */
function AssignedTo({ id, bin, current, at, ...part }: Part & { id: string; bin: Bin; current: string | undefined; at: ResourceAt | undefined }) {
    const { args, styles, words, horizonEnd } = part;
    const { commands, context, fit, chooser, setChooser, day } = args;
    const nouns = words.nouns;
    const editable = commands.canEdit();
    const open = chooser === id && editable;
    // The question the Table's resource cell asks (A48): the bin placed with what its link carries.
    const quantity = linkedQuantity(bin, current)?.quantity ?? bin.quantity;
    const ask = useMemo(() => variant("place", { subject: variant("bin", id), quantity }), [id, quantity]);
    const { ask: asking } = fit;
    useEffect(() => { if (open) asking(ask); }, [open, ask, asking, args.plan]);
    const sections = open ? resourceChoices({ context, words, binRow: true, current, answer: fit.answer(ask), shown: args.shown.resources }) : [];
    // Closed from its keys or by a choice, the Chooser gives the focus back to the field, as a popover gives it to its trigger:
    // the field drawn once it has closed, linked or not.
    const fieldRef = useRef<HTMLButtonElement>(null);
    const refocus = useRef(false);
    useLayoutEffect(() => {
        if (!refocus.current || open) return;
        refocus.current = false;
        fieldRef.current?.focus({ preventScroll: true });
    });
    const close = () => { refocus.current = true; setChooser(undefined); };
    const name = current === undefined ? undefined : context.resources.get(current)?.label ?? current;
    const field = <chakra.button ref={fieldRef} type="button" css={styles.resourceField} data-unlinked={current === undefined ? "" : undefined} data-allocation-resource-field=""
        disabled={!editable} aria-haspopup="listbox" aria-expanded={open} title={`Choose the ${one(nouns.resource)} · the same list as the Table’s chevron`}
        onClick={() => setChooser(open ? undefined : id)}>
        <span>{name ?? `+ Choose ${a(nouns.resource)}`}</span>
        {editable && <FontAwesomeIcon icon={open ? faChevronUp : faChevronDown} />}
    </chakra.button>;
    const choices = open && <Chooser sections={sections} placeholder={`Find ${a(nouns.resource)}`} surface="inline" autoFocus
        onChoose={key => { close(); if (key !== current) commands.link(id, key, current); }} onClose={close} />;
    // `Split…` (A71, #1362) on every bin with something to split: the remainder, or with none some of its largest part, onto another resource.
    const remainder = remainderOf(bin);
    const split = editable && splitOf(bin) !== undefined ? <SplitPopover id={id} bin={bin} context={context} plan={args.plan} commands={commands} fit={fit} words={words}
        shown={args.shown.resources} trigger={label => <chakra.button type="button" css={styles.link} data-allocation-split-open="" title={label}>
            <FontAwesomeIcon icon={faArrowsSplitUpAndLeft} />Split…
        </chakra.button>} /> : undefined;
    const opener = current !== undefined && at !== undefined
        ? <chakra.button type="button" css={styles.link} onClick={() => args.inspect({ type: "resource", key: current })}>Open {one(nouns.resource)}<FontAwesomeIcon icon={faArrowRight} /></chakra.button>
        : undefined;
    const head = <Box css={styles.sectionRow}>
        <Box css={styles.sectionHead}>Assigned to</Box>
        {(split !== undefined || opener !== undefined) && <Box as="span" css={styles.sectionActions}>{split}{opener}</Box>}
    </Box>;
    if (current === undefined || at === undefined) {
        return <Box css={styles.section} data-allocation-assigned="">
            {head}
            <Box css={styles.sectionRow}>{field}</Box>
            {choices}
            <Box css={styles.line}>{args.layout === "table" ? "Or use the chevron on its row in the table." : `Or drag the bin’s connector onto ${a(nouns.resource)} row.`}</Box>
        </Box>;
    }
    const tone = at.line.over ? "danger" : at.line.under ? "warning" : undefined;
    return <Box css={styles.section} data-allocation-assigned="">
        {head}
        <Box css={styles.sectionRow}>{field}<Box as="span" css={styles.fill} data-tone={tone} data-allocation-fill="">{words.load(at.load.fill, at.row)}</Box></Box>
        {choices}
        <Meter styles={styles} at={at} tone={tone === "danger" ? "danger" : tone === "warning" ? "warning" : "brand"} />
        <Box css={styles.line}>{groupLine(at.row, words)}</Box>
        <Facts styles={styles} at={at} words={words} day={day} horizonEnd={horizonEnd} />
        <Box css={styles.sectionHead}>On this {one(nouns.resource)} today</Box>
        <Mates {...part} resource={current} current={id} />
        <Box css={styles.line} data-allocation-batch="">{batchLine(at.load, words)}</Box>
        <Parts {...part} id={id} bin={bin} remainder={remainder} />
    </Box>;
}

/**
 * A bin's parts (A70, A71): each part's quantity a field of the shared form,
 * in its resources' order, labelled by its resource; its Clear unlinks the
 * part, as nothing on it does; each holds at most itself and the remainder.
 * Then what the parts leave unallocated, in warn. Every edit is a command.
 */
function Parts({ args, styles, words, id, bin, remainder }: Part & { id: string; bin: Bin; remainder: number }) {
    const { context, commands, held } = args;
    const editable = commands.canEdit();
    const code = binCode(context, bin);
    const keys = useMemo(() => [...bin.parts.keys()], [bin.parts]);
    // Each part's field: its resource's name, from none to what it holds and the remainder together.
    const specs = useMemo(() => Fields.specs(partsType(keys), Object.fromEntries(keys.map(key => [key,
        Fields.number({ label: context.resources.get(key)?.label ?? key, min: 0, max: (bin.parts.get(key) ?? 0) + remainder, step: 1,
            ...(context.unit === "" ? {} : { unit: context.unit }) })]))), [keys, bin.parts, remainder, context]);
    const value = useMemo(() => Object.fromEntries(keys.map(key => [key, some(bin.parts.get(key)!)])), [keys, bin.parts]);
    // What the drafts began from: the parts as the day holds the bin, none where it held nothing.
    const committed = held?.bins.get(id);
    const baseline = useMemo(() => committed === undefined ? undefined : Object.fromEntries(keys.map(key => {
        const was = committed.parts.get(key);
        return [key, was === undefined ? none : some(was)];
    })), [committed, keys]);
    const { setPart, unlink } = commands;
    const onChange = useCallback((path: readonly string[], next: unknown) => {
        const key = path[0];
        if (key === undefined || !bin.parts.has(key)) return;
        const part = next as option<number>;
        if (part.type === "none") unlink(id, key); else setPart(id, key, part.value);
    }, [bin.parts, id, setPart, unlink]);
    // The form's Clear is a part's Unlink, in the Table's words for it (A84).
    const format = useFormatters();
    const formWords = useMemo((): FieldFormWords => ({ ...format, m: { ...fieldFormMessages, clear: ({ label }) => `Unlink ${code} from ${label}` } }), [format, code]);
    return <Box css={styles.parts} data-allocation-parts="">
        <Box css={styles.sectionHead}>Parts</Box>
        <FieldForm specs={specs} value={value} baseline={baseline} onChange={onChange} readOnly={!editable} words={formWords} />
        {compareFloat(remainder, 0) > 0 && <Box css={styles.remainder} data-allocation-remainder="">{words.quantity(remainder)} unallocated</Box>}
    </Box>;
}

/** One booking or reservation in a list (A60, A61): its name and figure, its line, and its button. */
function ListOption({ styles, name, quantity, line, warn, children, testid }: { styles: Styles; name: string; quantity: string; line: string; warn: boolean; children: ReactNode; testid: string }) {
    return <Box css={styles.option} data-allocation-option={testid}>
        <Box css={styles.optionText}>
            <Box css={styles.optionName}><span>{name}</span><span data-option="quantity">{quantity}</span></Box>
            <Box css={styles.optionLine} data-tone={warn ? "warning" : undefined} title={line}>{line}</Box>
        </Box>
        {children}
    </Box>;
}

/** A free slot (A60): what it is, every arrival it can book, the five best resources to reserve it on, and the hint. */
function SlotDetails({ lane, at, ...part }: Part & { lane: string; at: Date }) {
    const { args, styles, words } = part;
    const { commands, fit, plan, held, context, day, slots, loads, shown } = args;
    const nouns = words.nouns;
    const editable = commands.canEdit();
    // The question a free row's resource cell asks (A48): a reservation in the slot.
    const of = args.reserving(lane, at);
    const ask = useMemo(() => variant("place", { subject: variant("bin", RESERVE_PROBE), quantity: 0 }), []);
    const { ask: asking } = fit;
    useEffect(() => { asking(ask, of); }, [ask, of, asking]);
    const reserve = reserveOptions(fit.answer(ask, of), loads, context, shown.resources, words);
    const books = bookOptions({ plan, held, context, day, shown: shown.arrivals, words });
    const where = landing(slots, plan, lane, at, undefined);
    const run = (option: BookOption) => option.grip.kind === "arrival" ? commands.book(option.grip.arrival, lane, where, undefined) : commands.restore(option.grip.bin, lane, where, undefined);
    return <>
        <ScheduleInspectorHead styles={styles} kind={{ name: "Slot", icon: "clock" }} title={`${words.lane(lane)} · ${timeText(at)}`}
            when={`${dayLong(day)} · no ${one(nouns.arrival)} · no ${one(nouns.resource)}`} status={{ label: "Free", tone: { type: "neutral" }, ring: false }} />
        <Box css={styles.section} data-allocation-book="">
            <Box css={styles.sectionHead}>Book {a(nouns.arrival)}</Box>
            {books.length === 0 ? <Box css={styles.absent}>no {other(nouns.arrival)} to book</Box>
                : books.map(o => <ListOption key={o.key} styles={styles} name={o.code} quantity={o.quantity} line={o.line} warn={o.warn} testid={o.key}>
                    {editable ? <Button size="xs" variant="outline" onClick={() => run(o)}>Book</Button> : <span />}
                </ListOption>)}
        </Box>
        <Box css={styles.section} data-allocation-reserve="">
            <Box css={styles.sectionHead}>Reserve {a(nouns.resource)}</Box>
            {reserve === undefined ? <Box css={styles.absent}>{fit.error !== undefined ? "fits unavailable" : CHECKING}</Box>
                : reserve.length === 0 ? <Box css={styles.absent}>no {one(nouns.resource)} has a gap that fits</Box>
                    : reserve.map(o => <ListOption key={o.key} styles={styles} name={o.name} quantity={o.range} line={o.line} warn={false} testid={o.key}>
                        {editable ? <Button size="xs" variant="outline" onClick={() => commands.reserve(lane, where, o.key)}>Reserve</Button> : <span />}
                    </ListOption>)}
            <Box css={styles.line}>Or drag {a(nouns.arrival)} or {a(nouns.resource)} from the library onto this row.</Box>
        </Box>
    </>;
}

/**
 * A reservation (A61): what it is, the resource it holds with Remove and
 * `Open resource →`, its fill and meter, every arrival checked against the
 * resource — one take of it, asked of the day without the reservation — its
 * `was` line and Revert.
 */
function ReservationDetails({ id, bin, ...part }: Part & { id: string; bin: Bin }) {
    const { args, styles, words } = part;
    const { commands, fit, plan, held, context, day, domain, shown, drag } = args;
    const nouns = words.nouns;
    const editable = commands.canEdit();
    const committed = held?.bins.get(id);
    const status = reservationStatus(bin, committed, domain.sameBin);
    const resource = partsOf(bin)[0]?.key;
    const at = resource === undefined ? undefined : resourcesAt(args, [resource])[0];
    const name = resource === undefined ? undefined : context.resources.get(resource)?.label ?? resource;
    // What the resource takes (A61, ruled 17 Oct): one question, of the day without the reservation it would fill.
    const of = args.without(id);
    const ask = useMemo(() => resource === undefined ? undefined : variant("take", { resource }), [resource]);
    const { ask: asking } = fit;
    useEffect(() => { if (ask !== undefined) asking(ask, of); }, [ask, of, asking]);
    const answer = ask === undefined ? undefined : fit.answer(ask, of);
    const books = bookOptions({ plan, held, context, day, shown: shown.arrivals, words });
    // A committed bin the drafts removed is checked as its own drag into the reservation is: its own question, asked once the pane has rendered.
    const target: Target = { kind: "lane", lane: bin.lane, at: bin.at, card: id };
    const { verdict } = drag;
    useEffect(() => { for (const o of books) if (o.grip.kind === "removed") verdict(o.grip, target); },
        // The bookings and the drafts are the questions.
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [plan, id]);
    const lineOf = (o: BookOption) => {
        if (resource === undefined) return { line: o.line, warn: o.warn, enabled: true };
        if (o.grip.kind === "arrival") return verdictLine(answer?.arrivals.get(o.grip.arrival));
        const v = drag.peek(o.grip, target);
        return v.pending ? verdictLine(undefined) : v.allowed ? { line: v.reason ?? o.line, warn: false, enabled: true } : { line: `doesn’t fit · ${v.reason ?? v.caption}`, warn: true, enabled: false };
    };
    const run = (o: BookOption) => o.grip.kind === "arrival" ? commands.fillWith(id, o.grip.arrival) : commands.restoreInto(o.grip.bin, id);
    const draft = committed !== undefined && !domain.sameBin(committed, bin);
    // Its key, printed, as a bin's is among its facts: what Search Records finds it by (#1398) — a new one's a draft, as its every field is.
    const keyLabel = args.m.binKey();
    const keySpecs = useMemo(() => Fields.specs(RESERVATION_FIELDS, { key: Fields.readonly({ label: keyLabel }) }), [keyLabel]);
    const keyValue = useMemo(() => ({ key: id }), [id]);
    const keyBaseline = useMemo(() => committed === undefined ? {} : { key: id }, [committed, id]);
    return <>
        <ScheduleInspectorHead styles={styles} kind={{ name: committed === undefined ? "New reservation" : "Reserved slot", icon: "bookmark" }}
            title={`${words.lane(bin.lane)} · ${timeText(bin.at)}`} when={name === undefined ? `Reserved · no ${one(nouns.arrival)} yet` : `Reserved on ${name} · no ${one(nouns.arrival)} yet`}
            status={statusOf(status)} pending={status.pending} />
        <Box css={styles.fields} data-allocation-reservation="">
            <Box css={styles.sectionHead}>{args.m.reservation()}</Box>
            <FieldForm specs={keySpecs} value={keyValue} baseline={keyBaseline} onChange={NO_EDIT} readOnly />
        </Box>
        <Box css={styles.section} data-allocation-assigned="">
            <Box css={styles.sectionRow}>
                <Box css={styles.sectionHead}>Assigned to</Box>
                <Box as="span" css={styles.sectionRow}>
                    {editable && <Button size="xs" variant="outline" title="Remove the reservation · the slot becomes free" onClick={() => commands.remove(id)}><FontAwesomeIcon icon={faXmark} />Remove</Button>}
                    {resource !== undefined && <chakra.button type="button" css={styles.link} onClick={() => args.inspect({ type: "resource", key: resource })}>Open {one(nouns.resource)}<FontAwesomeIcon icon={faArrowRight} /></chakra.button>}
                </Box>
            </Box>
            {at !== undefined && <>
                <Box css={styles.sectionRow}>
                    <Box as="span" css={styles.resourceName}>{at.row.label}</Box>
                    <Box as="span" css={styles.fill} data-tone={at.line.over ? "danger" : undefined} data-allocation-fill="">{words.load(at.load.fill, at.row)}</Box>
                </Box>
                <Meter styles={styles} at={at} tone={at.line.over ? "danger" : "brand"} />
                <Box css={styles.line}>{groupLine(at.row, words)}</Box>
            </>}
        </Box>
        <Box css={styles.section} data-allocation-book="">
            <Box css={styles.sectionHead}>Book {a(nouns.arrival)}</Box>
            {books.length === 0 ? <Box css={styles.absent}>no {other(nouns.arrival)} to book</Box>
                : books.map(o => { const said = lineOf(o); return <ListOption key={o.key} styles={styles} name={o.code} quantity={o.quantity} line={said.line} warn={said.warn} testid={o.key}>
                    {editable ? <Button size="xs" variant="outline" disabled={!said.enabled} onClick={() => run(o)}>Book</Button> : <span />}
                </ListOption>; })}
            {name !== undefined && <Box css={styles.line}>Each {one(nouns.arrival)} is checked against {name}. Book is off when it doesn’t fit.</Box>}
        </Box>
        {draft && <Box css={styles.was} data-allocation-was="">
            <span>{wasLine(committed, context, words)}</span>
            {editable && <Button size="sm" variant="outline" onClick={() => commands.revert(id)}><FontAwesomeIcon icon={faRotateLeft} />Revert</Button>}
        </Box>}
    </>;
}

/** A resource (A62): its status, its group and range, its banners, today's fill and meter, Before · Hold · Next fill, its bins today and the hint. */
function ResourceDetails({ resource, ...part }: Part & { resource: string }) {
    const { args, styles, words, horizonEnd } = part;
    const nouns = words.nouns;
    const at = resourcesAt(args, [resource])[0];
    if (at === undefined) return null;
    const status = resourceStatus(at.load, at.line);
    const banners = bannersOf({ issues: args.issues, resources: [at], day: args.day, words });
    const idle = Number(at.load.bins) === 0;
    const hint = at.load.state.type === "busy" && idle ? `Busy ${other(nouns.resource)} take no load until their current job is released.`
        : args.layout === "table" ? `Choose it with the ${one(nouns.resource)} chevron on a row, or drag it from the Library onto a row.`
            : `Drag a bin’s connector or ${a(nouns.arrival)} onto this row to load it.`;
    return <>
        <ScheduleInspectorHead styles={styles} kind={{ name: nouns.resource.one, icon: "cube" }} title={at.row.label} when={groupLine(at.row, words)} status={statusOf(status)} />
        <Banners styles={styles} banners={banners} />
        <Box css={styles.section} data-allocation-fill-section="">
            <Box css={styles.sectionRow}>
                <Box css={styles.sectionHead}>Today's fill</Box>
                <Box as="span" css={styles.fill} data-tone={at.line.over ? "danger" : undefined} data-allocation-fill="">{words.load(at.load.fill, at.row)}</Box>
            </Box>
            <Meter styles={styles} at={at} tone={at.line.over ? "danger" : "brand"} />
            <Facts styles={styles} at={at} words={words} day={args.day} horizonEnd={horizonEnd} />
        </Box>
        <Box css={styles.section} data-allocation-bins="">
            <Box css={styles.sectionHead}>Bins on it today</Box>
            <Mates {...part} resource={resource} current={undefined} />
            <Box css={styles.line}>{hint}</Box>
        </Box>
    </>;
}

/** Nothing selected (A63): the day, the board's title and size, its four counts, the narrowing's note and three hints. */
function Summary({ args, styles, words }: Part) {
    const { value, plan, held, domain, loads, issues, shown } = args;
    const nouns = words.nouns;
    const stats = summaryStats({ plan, held, sameBin: domain.sameBin, loads, issues, words });
    const count = (keys: option<Set<string>>, total: number) => keys.type === "none" ? total : keys.value.size;
    const note = narrowingNote([
        { shown: count(shown.lanes, value.lanes.length), total: value.lanes.length, noun: nouns.lane },
        { shown: count(shown.resources, value.resources.length), total: value.resources.length, noun: nouns.resource },
        { shown: count(shown.arrivals, value.arrivals.length), total: value.arrivals.length, noun: nouns.arrival },
    ]);
    return <>
        <ScheduleInspectorHead styles={styles} kind={{ name: `Plan · ${dayLong(args.day)}`, icon: "calendar-day" }} title={value.settings.title}
            when={summaryLine(value.lanes.length, value.resources.length, nouns)} />
        <Box css={styles.stats} data-allocation-stats="">{stats.map(stat => <Box key={stat.label} css={styles.stat} data-allocation-stat={stat.label}>
            <Box css={styles.statLabel}>{stat.label}</Box>
            <Box css={styles.statValue} data-tone={stat.tone}>{stat.value}</Box>
            <Box css={styles.statSub}>{stat.sub}</Box>
        </Box>)}</Box>
        {note !== undefined && <Box css={styles.note} data-allocation-scope="">{note}</Box>}
        <Box as="ul" css={styles.hints} data-allocation-hints="">{summaryHints(nouns).map(hint => <Box as="li" key={hint} css={styles.hint}>{hint}</Box>)}</Box>
    </>;
}

/**
 * Issues (A64): each group with its mark and its count, each issue its title
 * and `Show →`, its detail and its fix — the resource Chooser of the bin it
 * names, or Find a fit; with none, `No issues`.
 */
function IssuesTab(part: Part) {
    const { args, styles, words } = part;
    const groups = issueGroups(args.issues);
    if (groups.length === 0) {
        return <Box css={styles.empty} data-allocation-issues-empty="">
            <Box as="span" css={styles.emptyIcon} aria-hidden="true"><FontAwesomeIcon icon={faCircleCheck} /></Box>
            <Box css={styles.emptyTitle}>No issues</Box>
            <Box css={styles.emptyHint}>Every {one(words.nouns.arrival)} sits within its gap and its max.</Box>
        </Box>;
    }
    return <Box css={styles.issues} data-allocation-issues="">{groups.map(group => <Box key={group.key} css={styles.issueGroup} data-allocation-issue-group={group.key}>
        <Box css={styles.issueHead} data-tone={group.tone}>
            {group.tone === "danger" ? <FontAwesomeIcon icon={faCircleExclamation} aria-hidden="true" /> : group.tone === "warning" ? <FontAwesomeIcon icon={faTriangleExclamation} aria-hidden="true" /> : null}
            <span>{group.label}</span><Box as="span" css={styles.issueCount}>{group.issues.length}</Box>
        </Box>
        {group.issues.map((issue, i) => <IssueItem key={i} {...part} issue={issue} />)}
    </Box>)}</Box>;
}

/** One issue (A64): its title and `Show →`, which selects its bin or resource; its detail; its fix. */
function IssueItem({ args, styles, words, issue }: Part & { issue: Issue }) {
    const { plan, held, context, commands } = args;
    const codeOfBin = (bin: string) => { const b = plan.bins.get(bin) ?? held?.bins.get(bin); return b === undefined ? bin : binCode(context, b); };
    const label = fixLabel(issue, codeOfBin, words.nouns);
    const show = issue.bin.type === "some" ? { type: "bin" as const, id: issue.bin.value }
        : issue.resource.type === "some" ? { type: "resource" as const, key: issue.resource.value } : undefined;
    const fix = issue.fix.type === "some" ? issue.fix.value : undefined;
    // The bin a fix opens the resource Chooser of: its own, or the one a resource's issue names to move.
    const chosen = fix?.type === "move" ? fix.value : fix?.type === "choose" && issue.bin.type === "some" ? issue.bin.value : undefined;
    const choose = chosen !== undefined && commands.canEdit() && plan.bins.has(chosen) ? () => { args.inspect({ type: "bin", id: chosen }); args.setChooser(chosen); } : undefined;
    // Find a fit (A74): a Partly allocated issue's fix, and a Not linked one's beside its Choose, while the bin has some unallocated.
    // It edits nothing, so a day that takes no edit offers it too.
    const named = issue.bin.type === "some" ? plan.bins.get(issue.bin.value) : undefined;
    const find = issue.bin.type === "some" && named !== undefined && args.onFind !== undefined && (fix?.type === "find" || issue.kind.type === "unlinked")
        && compareFloat(remainderOf(named), 0) > 0 ? issue.bin.value : undefined;
    return <Box css={styles.issue} data-allocation-issue={issue.kind.type}>
        <Box css={styles.issueTop}>
            <Box as="span" css={styles.issueTitle} title={issue.title}>{issue.title}</Box>
            {show !== undefined && <chakra.button type="button" css={styles.link} onClick={() => args.inspect(show)}>Show<FontAwesomeIcon icon={faArrowRight} /></chakra.button>}
        </Box>
        <Box css={styles.issueDetail}>{issue.detail}</Box>
        {((choose !== undefined && label !== undefined) || find !== undefined) && <Box css={styles.issueActions}>
            {choose !== undefined && label !== undefined && <Button size="xs" variant="outline" onClick={choose}>{label}</Button>}
            {find !== undefined && <Button size="xs" variant="outline" data-allocation-find="" onClick={() => args.onFind!(find)}>
                {args.finding?.(find) === true ? "Finding…" : "Find a fit"}
            </Button>}
        </Box>}
    </Box>;
}
