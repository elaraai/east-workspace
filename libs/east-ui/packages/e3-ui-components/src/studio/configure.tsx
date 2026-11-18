/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `StudioConfigure` — the builder's inspector's Configure tab (#1672): what
 * the selected placement holds, edited, under the head the Layout tab shares.
 *
 * - **A developer's component** shows what it showed before: what its code
 *   reads, its description fixed by its developer under the lock, and the
 *   pane's footer.
 * - **A text block** is its heading and its body, a form over its struct
 *   (`FieldForm`): the heading typed in its box, the body in a box of
 *   paragraphs, each one edit as the keyboard leaves it.
 * - **A visual** is one stack, drawn from its kind's declaration (EDT-1,
 *   EDT-2): its source, picked from those the surface lists (EDT-9); its
 *   view, then its kind — a change of kind keeps every well that fits, a
 *   change of view starts the kind empty (EDT-8); its wells
 *   ({@link StudioWells}); its options, a form over its kind's struct; what a
 *   click on it does; and its source's fields, which drag onto its wells
 *   ({@link StudioFieldsList}).
 *
 * Every edit is the placement's content written whole through `onRequest` —
 * a `field` request the canvas takes as one gesture of the page's session,
 * undone and saved with the rest — and drawn live on the canvas (EDT-10). A
 * part an edit changed from what is saved is tinted until the page is saved:
 * the source, the view, the kind and the click by `changedParts` — each control
 * naming its part (`data-changed="kind"`) — an option and a text's field by its
 * form's own baseline (`data-dirty`).
 *
 * Its layout and its controls are the `studioInspector` recipe's, measured
 * from the spec's editor: sections of fields — a label over a select's box
 * (the source, the click), a segment group ({@link SegStrip}: the view, the
 * kind, an option) — each choice made in a Chooser in a `SliceEditPopover`,
 * and `FieldForm` for the options and the text.
 *
 * @packageDocumentation
 */

import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Box, chakra, useSlotRecipe, type SystemStyleObject } from "@chakra-ui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import type { IconName } from "@fortawesome/fontawesome-svg-core";
import { faArrowUpRightFromSquare, faChevronDown, faLock } from "@fortawesome/free-solid-svg-icons";
import {
    StringType, defaultValue, encodeBeast2For, equalFor, isValueOf, some, variant, type ValueTypeOf,
} from "@elaraai/east";
import { Fields, Textarea, type FieldSpecValue } from "@elaraai/east-ui/internal";
import {
    StudioContentType, StudioKeyType, StudioTextType, changedParts, kindEditor, kindStruct, optionSpecs, placedFields, savedKindFields, withKindField,
    type StudioKind, type StudioViewEditor,
} from "@elaraai/e3-ui/internal";
import { EastChakraTextarea, FieldForm, SliceEditPopover, type TextareaValue } from "@elaraai/east-ui-components";
import { Chooser, type ChooserSection } from "@elaraai/east-ui-components/internal";

import { StudioFieldsList } from "./fields-list.js";
import { InspectorEmpty, InspectorHead, type InspectorPhone, type Selection, type StudioInspectorValue } from "./inspector.js";
import { useStudioMessages } from "./messages.js";
import { SegStrip, segControls } from "./seg.js";
import { studioEast } from "./studio-east.js";
import { StudioWells, type WellsDnd } from "./wells.js";

type Styles = Record<string, SystemStyleObject>;

/** What a placement holds. */
type Content = ValueTypeOf<typeof StudioContentType>;
/** A visual. */
type Visual = Extract<Content, { type: "visual" }>["value"];
/** A text block. */
type Text = Extract<Content, { type: "text" }>["value"];
/** What a click on a visual does. */
type Click = Visual["click"];
/** A source the surface lists. */
type Source = StudioInspectorValue["sources"][number];
/** A page's key. */
type StudioKey = ValueTypeOf<typeof StudioKeyType>;

const encodeContent = encodeBeast2For(StudioContentType);
const stringEqual = equalFor(StringType);
const keyEqual = equalFor(StudioKeyType);
/** The body's box with nothing set: East's default for the shared Textarea. */
const TEXTAREA: TextareaValue = defaultValue(Textarea.Types.Textarea);
/** The clicks a visual's On click offers that open no page, in its select's order. */
const CLICKS = ["filter", "select", "none"] as const;
/** What a page's option is keyed by in the click's chooser, before its name. */
const PAGE = "page:";

/** Whether a value is a text block — `isValueOf`, which TypeScript then reads it as. */
function isText(value: unknown): value is Text {
    return isValueOf(value, StudioTextType);
}

/** A page of the project, as the click's page picker offers it. */
export interface ConfigurePage {
    /** Its key. */
    readonly key: StudioKey;
    /** Its title. */
    readonly title: string;
}

/** Props of {@link StudioConfigure}. */
export interface StudioConfigureProps {
    /** The selected placement, the sources and the kinds' editors, and where an edit goes. */
    value: StudioInspectorValue;
    /** What the placement holds as the page is saved; `undefined` for a placement not saved yet. */
    saved: Content | undefined;
    /** The project's pages: what a click may open. */
    pages: readonly ConfigurePage[];
    /** The ids a visual's wells' drags go by. */
    dnd: WellsDnd;
    /** In a phone's frame: where the placement stands, and what Move does. */
    phone?: InspectorPhone | undefined;
}

/**
 * Renders the inspector's Configure tab — see the module docs.
 *
 * @param props - The selected placement, what it holds saved, the project's pages, its drags' ids and, on a phone, where it stands
 * @returns The tab's body
 */
export const StudioConfigure = memo(function StudioConfigure({ value, saved, pages, dnd, phone }: StudioConfigureProps) {
    const styles = useSlotRecipe({ key: "studioInspector" })() as Styles;
    const selection = value.selection.type === "some" ? value.selection.value : undefined;
    const onRequest = value.onRequest;
    const key = selection?.key;
    // An edit of what it holds: the content written whole, one gesture of the canvas.
    const edit = useCallback((content: Content) => {
        if (key === undefined) return;
        try {
            onRequest({ key, change: variant("field", { name: "content", value: encodeContent(content) }) });
        } catch (err) {
            console.error("[Studio.Builder] the inspector's edit failed:", err);
        }
    }, [key, onRequest]);
    const editText = useCallback((text: Text) => edit(variant("text", text)), [edit]);
    const editVisual = useCallback((visual: Visual) => edit(variant("visual", visual)), [edit]);
    if (selection === undefined) return <InspectorEmpty phone={phone !== undefined} />;
    const content = selection.cell.content;
    return (
        <Box css={styles.root} data-studio-inspector="" data-studio-configure="">
            <InspectorHead selection={selection} phone={phone} />
            {content.type === "component" && <ComponentInfo selection={selection} />}
            {content.type === "text" && <TextEditor text={content.value} saved={saved?.type === "text" ? saved.value : undefined} onEdit={editText} />}
            {content.type === "visual" && (
                <VisualEditor visual={content.value} saved={saved} sources={value.sources} editors={value.editors} pages={pages} dnd={dnd} onEdit={editVisual} />
            )}
        </Box>
    );
});

/** What a developer's component shows: what its code reads, its description under the lock, and the footer. */
function ComponentInfo({ selection }: { selection: Selection }) {
    const styles = useSlotRecipe({ key: "studioInspector" })() as Styles;
    const m = useStudioMessages();
    const component = selection.content.type === "component" ? selection.content.value : undefined;
    if (component === undefined) return null;
    const description = component.description.type === "some" ? component.description.value : undefined;
    return (
        <>
            <Box css={styles.data} data-inspector="data">
                <Box as="span" css={styles.eyebrow}>{m.data()}</Box>
                {component.reads.length > 0 ? (
                    <Box as="ul" css={styles.reads} aria-label={m.data()}>
                        {component.reads.map((name, at) => <Box as="li" key={at} css={styles.read}>{name}</Box>)}
                    </Box>
                ) : (
                    <Box as="span" css={styles.noReads}>{m.readsNothing()}</Box>
                )}
            </Box>
            <Box css={styles.config} data-inspector="config">
                <Box css={styles.configHead}>
                    <Box as="span" css={styles.eyebrow}>{m.configuration()}</Box>
                    <Box as="span" css={styles.lockNote}>
                        <FontAwesomeIcon icon={faLock} />
                        {m.fixedByDeveloper()}
                    </Box>
                </Box>
                <Box as="p" css={styles.description} data-empty={description === undefined ? "" : undefined}>
                    {description ?? m.noDescription()}
                </Box>
            </Box>
            <Box css={styles.footer} data-inspector="footer">
                <FontAwesomeIcon icon={faLock} />
                {m.published()}
            </Box>
        </>
    );
}

/** One field of the Configure tab: its label over its control, its hint under it; tinted while an edit changed it. */
function Fld({ label, part, changed, hint, children }: { label: string; part: string; changed?: string | undefined; hint?: string | undefined; children: ReactNode }) {
    const styles = useSlotRecipe({ key: "studioInspector" })() as Styles;
    return (
        <Box css={styles.fld} data-configure={part} data-changed={changed} role="group" aria-label={label}>
            <Box as="span" css={styles.fldLabel} aria-hidden>{label}</Box>
            {children}
            {hint !== undefined && <Box as="span" css={styles.fldHint} data-configure-hint="">{hint}</Box>}
        </Box>
    );
}

// ── A text block ─────────────────────────────────────────────────────────────

/**
 * A text block's body, a box of paragraphs: what is typed is one edit as the
 * keyboard leaves it, never one a key.
 */
function BodyArea({ text, onCommit }: { text: string; onCommit: (text: string) => void }) {
    const typed = useRef(text);
    useEffect(() => { typed.current = text; }, [text]);
    const value = useMemo((): TextareaValue => ({
        ...TEXTAREA,
        value: text,
        rows: some(5n),
        autoresize: some(true),
        onChange: some((next: string) => { typed.current = next; return null; }),
        onBlur: some(() => {
            if (!stringEqual(typed.current, text)) onCommit(typed.current);
            return null;
        }),
    }), [text, onCommit]);
    return <EastChakraTextarea value={value} />;
}

/** A text block's heading and body, a form over its struct, each changed from what is saved tinted. */
function TextEditor({ text, saved, onEdit }: { text: Text; saved: Text | undefined; onEdit: (text: Text) => void }) {
    const styles = useSlotRecipe({ key: "studioInspector" })() as Styles;
    const m = useStudioMessages();
    const specs = useMemo(() => Fields.specs(StudioTextType, {
        heading: Fields.text({ label: m.textHeading() }),
        body: Fields.text({ label: m.textBody() }),
    }), [m]);
    const renderControl = useCallback((spec: FieldSpecValue, change: (value: unknown) => void) => (
        stringEqual(spec.path[0] ?? "", "body") ? <BodyArea text={text.body} onCommit={change} /> : undefined
    ), [text.body]);
    const onChange = useCallback((path: readonly string[], value: unknown) => {
        const next = { ...text, [path[0] ?? ""]: value };
        if (!isText(next)) return m.cannotSet({ label: path[0] ?? "" });
        onEdit(next);
        return undefined;
    }, [text, onEdit, m]);
    return (
        <Box css={styles.part} data-configure="text">
            {/* A block not saved yet differs everywhere: its baseline holds nothing. */}
            <FieldForm specs={specs} value={text} baseline={saved ?? {}} renderControl={renderControl} onChange={onChange} />
        </Box>
    );
}

// ── A visual ─────────────────────────────────────────────────────────────────

/** Props of {@link VisualEditor}. */
interface VisualEditorProps {
    visual: Visual;
    saved: Content | undefined;
    sources: readonly Source[];
    editors: readonly StudioViewEditor[];
    pages: readonly ConfigurePage[];
    dnd: WellsDnd;
    onEdit: (visual: Visual) => void;
}

/** A visual's stack: its source, its view and kind, its wells, its options, its click and its source's fields. */
function VisualEditor({ visual, saved, sources, editors, pages, dnd, onEdit }: VisualEditorProps) {
    const styles = useSlotRecipe({ key: "studioInspector" })() as Styles;
    const m = useStudioMessages();
    const east = studioEast();
    // What an edit changed from what is saved, until the page is saved (EDT-10): a control tinted names its part.
    const parts = useMemo(() => changedParts(saved, variant("visual", visual)), [saved, visual]);
    const changed = (part: string) => (parts.has(part) ? part : undefined);
    const source = sources.find((s) => stringEqual(s.key, visual.source));
    const fields = useMemo(() => [...(source?.fields ?? [])], [source]);
    const at = kindStruct(visual.view);
    const editor = kindEditor(visual.view, editors);
    const viewEditor = editors.find((v) => stringEqual(v.view, visual.view.type));
    // Another kind, its wells that fit carried over; another view's first kind, empty — one gesture either way.
    const switchTo = (kind: StudioKind) => onEdit({ ...visual, view: east.switchedView(visual.view, kind, fields) });
    const onView = useCallback((view: Visual["view"]) => onEdit({ ...visual, view }), [visual, onEdit]);
    // The fields its wells hold: what the Fields list checks (EDT-3).
    const placed = useMemo(() => (editor === undefined ? [] : placedFields(visual.view, editor)), [visual.view, editor]);
    const views = editors.map((v) => ({ key: v.view, label: v.label, icon: v.icon, disabled: v.kinds.length === 0 }));
    const kinds = viewEditor === undefined ? [] : viewEditor.kinds.map((k) => ({ key: k.kind.type, label: k.label, icon: k.icon }));
    // The options' baseline: what the saved kind held of each — an option a change of kind carried over is no change.
    const baseline = useMemo(() => savedKindFields(saved?.type === "visual" ? saved.value.view : undefined, visual.view), [saved, visual.view]);
    const specs = useMemo(() => (editor === undefined ? [] : optionSpecs(editor)), [editor]);
    const onOption = useCallback((path: readonly string[], value: unknown) => {
        const field = path[0] ?? "";
        try {
            onEdit({ ...visual, view: withKindField(visual.view, field, value) });
            return undefined;
        } catch {
            return m.cannotSet({ label: specs.find((spec) => stringEqual(spec.path[0] ?? "", field))?.label ?? field });
        }
    }, [visual, onEdit, m, specs]);
    // A group of icons says what its chosen kind is for under it; one of names needs no more.
    const iconic = kinds.length > 3;
    const kindLabel = viewEditor?.kinds.find((k) => at !== undefined && stringEqual(k.kind.type, at.kind))?.label;
    return (
        <>
            <Box css={styles.part} data-configure-section="kind">
                <Fld label={m.source()} part="source" changed={changed("source")}>
                    <SourcePicker sources={sources} current={visual.source} onPick={(key) => onEdit({ ...visual, source: key })} />
                </Fld>
                <Fld label={m.view()} part="view" changed={changed("view")} hint={m.viewHint()}>
                    <SegStrip label={m.view()} name="views" options={views} current={visual.view.type} onPick={(key) => {
                        const first = editors.find((v) => stringEqual(v.view, key))?.kinds[0];
                        if (first !== undefined) switchTo(first.kind);
                    }} />
                </Fld>
                {kinds.length > 1 && viewEditor !== undefined && (
                    <Fld label={viewEditor.label} part="kind" changed={changed("kind")}
                        hint={iconic && at !== undefined && kindLabel !== undefined ? m.kindHint({ label: kindLabel, kind: at.kind }) : undefined}>
                        <SegStrip label={m.kind()} name="kinds" options={kinds} current={at?.kind} onPick={(key) => {
                            const kind = viewEditor.kinds.find((k) => stringEqual(k.kind.type, key))?.kind;
                            if (kind !== undefined) switchTo(kind);
                        }} />
                    </Fld>
                )}
            </Box>
            {editor !== undefined && (
                <StudioWells view={visual.view} editor={editor} source={source} sourceKey={visual.source} changed={parts} dnd={dnd} onView={onView} />
            )}
            <Box css={styles.part} data-configure-section="options">
                {specs.length > 0 && at !== undefined && (
                    <Box css={styles.form} data-configure="options" role="group" aria-label={m.options()}>
                        <FieldForm specs={specs} value={at.struct} baseline={baseline} renderControl={segControls(at.struct)} onChange={onOption} />
                    </Box>
                )}
                <ClickPicker click={visual.click} changed={changed("click")} pages={pages} onPick={(click) => onEdit({ ...visual, click })} />
            </Box>
            {source !== undefined && (
                <StudioFieldsList source={source} placed={placed} library={dnd.fields} />
            )}
        </>
    );
}

/** A visual's source: its picker, the sources the surface lists in a Chooser, each with its icon and what one row is. */
function SourcePicker({ sources, current, onPick }: { sources: readonly Source[]; current: string; onPick: (key: string) => void }) {
    const styles = useSlotRecipe({ key: "studioInspector" })() as Styles;
    const m = useStudioMessages();
    const [open, setOpen] = useState(false);
    const source = sources.find((s) => stringEqual(s.key, current));
    const sections = useMemo((): ChooserSection[] => [{
        label: m.sourcesListed(),
        options: sources.map((s) => ({
            key: s.key, label: s.name, line: s.description.type === "some" ? s.description.value : undefined,
            state: stringEqual(s.key, current) ? "current" : "enabled",
        })),
    }], [sources, current, m]);
    return (
        <SliceEditPopover open={open} onOpenChange={setOpen} label={m.source()} flush
            trigger={(
                <chakra.button type="button" css={styles.box} aria-label={`${m.source()}: ${source?.name ?? current}`} data-configure-source={current}>
                    {source !== undefined && <Box as="span" css={styles.boxIcon} aria-hidden><FontAwesomeIcon icon={["fas", source.icon as IconName]} /></Box>}
                    <Box as="span" css={styles.boxName}>{source?.name ?? current}</Box>
                    <Box as="span" css={styles.boxCaret} aria-hidden><FontAwesomeIcon icon={faChevronDown} /></Box>
                </chakra.button>
            )}>
            <Chooser sections={sections} placeholder={m.findSource()} onChoose={(key) => {
                setOpen(false);
                if (!stringEqual(key, current)) onPick(key);
            }} />
        </SliceEditPopover>
    );
}

/**
 * What a click on a visual does — a select: filter this page, select it, or
 * nothing, then each of the project's pages, which the click opens. Under it,
 * while it opens one, what that does.
 */
function ClickPicker({ click, changed, pages, onPick }: { click: Click; changed: string | undefined; pages: readonly ConfigurePage[]; onPick: (click: Click) => void }) {
    const styles = useSlotRecipe({ key: "studioInspector" })() as Styles;
    const m = useStudioMessages();
    const [open, setOpen] = useState(false);
    const opened = click.type === "open" ? click.value : undefined;
    const page = opened === undefined ? undefined : pages.find((p) => keyEqual(p.key, opened));
    const said = opened === undefined ? m.clickName({ click: click.type }) : m.openPage({ page: page?.title ?? opened.page });
    const sections = useMemo((): ChooserSection[] => [
        {
            label: m.onClick(),
            options: CLICKS.map((c) => ({ key: c, label: m.clickName({ click: c }), state: stringEqual(c, click.type) ? "current" as const : "enabled" as const })),
        },
        {
            label: m.clickName({ click: "open" }),
            options: pages.map((p) => ({
                key: `${PAGE}${p.key.page}`, label: p.title, line: p.key.page,
                state: opened !== undefined && keyEqual(p.key, opened) ? "current" as const : "enabled" as const,
            })),
        },
    ].filter((section) => section.options.length > 0), [pages, opened, click.type, m]);
    const choose = (key: string) => {
        setOpen(false);
        if (key.startsWith(PAGE)) {
            const chosen = pages.find((p) => stringEqual(p.key.page, key.slice(PAGE.length)));
            if (chosen !== undefined && (opened === undefined || !keyEqual(chosen.key, opened))) onPick(variant("open", chosen.key));
            return;
        }
        const to = CLICKS.find((c) => stringEqual(c, key));
        if (to === undefined || stringEqual(to, click.type)) return;
        onPick(to === "filter" ? variant("filter", null) : to === "select" ? variant("select", null) : variant("none", null));
    };
    return (
        <Fld label={m.onClick()} part="click" changed={changed} hint={opened === undefined ? undefined : m.clickOpens()}>
            <SliceEditPopover open={open} onOpenChange={setOpen} label={m.onClick()} flush
                trigger={(
                    <chakra.button type="button" css={styles.box} aria-label={`${m.onClick()}: ${said}`} data-configure-click={click.type}
                        data-configure-page={opened?.page}>
                        {opened !== undefined && <Box as="span" css={styles.boxIcon} aria-hidden><FontAwesomeIcon icon={faArrowUpRightFromSquare} /></Box>}
                        <Box as="span" css={styles.boxName}>{said}</Box>
                        <Box as="span" css={styles.boxCaret} aria-hidden><FontAwesomeIcon icon={faChevronDown} /></Box>
                    </chakra.button>
                )}>
                <Chooser sections={sections} placeholder={m.findPage()} onChoose={choose} />
            </SliceEditPopover>
        </Fld>
    );
}
