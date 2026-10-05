/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The library pane (`Sheet Builder Spec.md` §7, §8, §9.7, SB32–SB37): the
 * sheet builder's start pane, its tabs Rows · Registers · Columns, each a
 * `Library` with its count after its name and a search — what the builder
 * offers to drag into the sheet, and the columns a viewer shows and hides.
 *
 * - **Rows** — the templates, grouped by their `group`: a card names the
 *   template and, under it, what it sets — its cells as the columns print
 *   them, in column order — or, for a group template, its band cells and
 *   how many lines it drops.
 * - **Registers** — the driver's members first, then each register's, by
 *   register and kind: a card's label, its meta and kind under it, a driver
 *   member's kind as its tag, and a toned member's tone as a dot. The search
 *   reads keys, labels and aliases. With a slice, a click narrows the sheet
 *   to the rows that name the member, through the slice's search, and a click
 *   on the member it narrows to lets go; without one, a click selects the
 *   card.
 * - **Columns** — the declared columns in their order, each with its kind and
 *   an eye; a click hides it, or shows it again, dimmed while hidden. The last
 *   column shown stays.
 * - An empty tab says so (SB37), in the shared empty state; collapsed, the
 *   pane is a rail with the templates' count.
 *
 * Template and member cards drag from the libraries `sheetKeys(id).library`
 * names (`…:rows`, `…:registers`).
 *
 * @packageDocumentation
 */

import { useCallback, useMemo, useState } from "react";
import { StringType, decodeBeast2For, equalFor, none, some, variant, type ValueTypeOf } from "@elaraai/east";
import { Slice } from "@elaraai/east-ui/internal";
import { Sheet, type SheetBuilderPayloadType, type sheetKeys } from "@elaraai/e3-ui/internal";
import {
    EastChakraLibrary, getSomeorUndefined, useSliceReactivity, type BuilderFrameDock, type LibraryItemValue, type LibraryValue,
} from "@elaraai/east-ui-components";
import type { SheetLibraryTabWord } from "../messages.js";
import { TITLE_KEY, cellIsBlank, cellText, indexColumns, indexGroup, type SheetColumnIndex, type SheetColumnMeta } from "../model.js";
import type { SliceStateValue } from "../sheet-types.js";
import type { SheetCellValue, SheetRegisterMemberValue } from "../values.js";
import type { SheetWords } from "../words.js";

/** The renderer's payload, decoded. */
type SheetBuilderValue = ValueTypeOf<typeof SheetBuilderPayloadType>;
/** One template, decoded. */
type SheetTemplateValue = SheetBuilderValue["templates"][number];
/** The names the builder keeps its viewer's state under. */
type SheetKeys = ReturnType<typeof sheetKeys>;
/** The bound slice handle, decoded. */
type SliceBindValue = ValueTypeOf<typeof Slice.Types.Bind>;

const stringEqual = equalFor(StringType);
const decodeRow = decodeBeast2For(Sheet.Types.Row);

/** The library open: the Calendar's 272px (§8). */
const LIBRARY_SIZE = "272px";

/** Between the parts of a member card's key: what it comes from, its kind and its key. */
const CARD_SEP = "\u001f";

/** A library tab's cards fill the pane and scroll there, every card mounted. */
const FILL = some({ height: some("fill"), maxHeight: none, virtualization: some(false), columns: none, mediaPlacement: none, mediaSize: none });

/** Props of {@link useSheetLibrary}. */
export interface SheetLibraryProps {
    /** The builder's payload: the sheet, and the templates. */
    value: SheetBuilderValue;
    /** The names the builder keeps its viewer's state under. */
    keys: SheetKeys;
    /** The columns this viewer hides, by key. */
    hidden: ReadonlySet<string>;
    /** Hides a column the grid shows, or shows a hidden one again. */
    onToggleColumn: (key: string) => void;
    /** The sheet's words. */
    words: SheetWords;
}

/** A card's line under its name: the texts, the blank ones left out. */
function line(texts: readonly string[]): string {
    return texts.filter((text) => text !== "").join(" · ");
}

/** A cell as its column prints it, or `""` for a blank one. */
function printed(cell: SheetCellValue | undefined, meta: SheetColumnMeta | undefined, words: SheetWords): string {
    return cell === undefined || meta === undefined || cellIsBlank(cell) ? "" : cellText(cell, meta, words);
}

/**
 * How many lines a group template drops: its seed's, as a drop would make it.
 *
 * @param template - A group template
 * @param keyed - Whether the sheet's groups sit in key order, or where they are put
 * @returns The count, or `undefined` when the seed fails
 */
function seededLines(template: SheetTemplateValue, keyed: boolean): number | undefined {
    if (template.seed.type !== "group") return undefined;
    try {
        const seeded = template.seed.value({ place: keyed ? variant("keyOrder", null) : variant("ordered", variant("end", null)) });
        return decodeRow(seeded.row).lines.length;
    } catch (err) {
        console.error(`[Sheet] group template "${template.key}" could not be seeded:`, err);
        return undefined;
    }
}

/**
 * What a template sets, as its card says it (SB33): a row template's cells as
 * the columns print them, in column order; a group template's title and band
 * cells, then the lines it drops.
 *
 * @param template - The template
 * @param columns - The declared columns
 * @param group - The band's cells, on a grouped sheet
 * @param keyed - Whether the sheet's groups sit in key order
 * @param words - The sheet's words
 * @returns The card's line
 */
function templateLine(template: SheetTemplateValue, columns: SheetColumnIndex, group: ReturnType<typeof indexGroup> | undefined, keyed: boolean, words: SheetWords): string {
    if (template.seed.type === "row") return line(columns.list.map((meta) => printed(template.cells.get(meta.key), meta, words)));
    const lines = seededLines(template, keyed);
    return line([
        printed(template.cells.get(TITLE_KEY), group?.cells.get(TITLE_KEY), words),
        ...columns.list.map((col) => printed(template.cells.get(col.key), group?.cells.get(col.key), words)),
        lines === undefined ? "" : words.m.templateLines({ n: lines, count: words.number(lines) }),
    ]);
}

/** A card with nothing but its face: no media, byline, action, facets or secondary facts. */
function card(fields: Pick<LibraryItemValue, "key" | "label" | "sublabel" | "status" | "trailing" | "draggable" | "filtered" | "placed" | "search" | "groups">): LibraryItemValue {
    return { ...fields, icon: none, media: none, avatar: none, byline: none, action: none, facets: new Map(), dims: new Map() };
}

/** One member of the Registers tab: what it comes from — the driver, or a register — and the member. */
interface MemberCard {
    key: string;
    driver: boolean;
    group: string;
    member: SheetRegisterMemberValue;
}

/**
 * The library pane, as `BuilderFrame` draws it — see the module docs.
 *
 * @param props - The payload, the builder's keys, the columns hidden and their toggle, and the words
 * @returns The pane: its tabs Rows, Registers and Columns, each with its count; 272px wide; its collapsed state kept per viewer (SB24)
 */
export function useSheetLibrary({ value, keys, hidden, onToggleColumn, words }: SheetLibraryProps): BuilderFrameDock {
    const { m } = words;
    const sheet = value.sheet;
    const columns = useMemo(() => indexColumns(sheet.columns), [sheet.columns]);
    const keyed = sheet.editing.keyType.type === "some";
    const titleColumn = m.titleColumn();
    const group = useMemo(() => {
        const g = getSomeorUndefined(sheet.group);
        return g === undefined ? undefined : indexGroup(g, columns, titleColumn);
    }, [sheet.group, columns, titleColumn]);

    // The slice a member's click narrows through, and the search it holds now.
    const chrome = useMemo(() => getSomeorUndefined(sheet.slice), [sheet.slice]);
    const slice = chrome === undefined ? undefined : (chrome.slice as SliceBindValue);
    const sliceVersion = useSliceReactivity(slice?.key);
    const search = useMemo(() => {
        if (slice === undefined) return undefined;
        const state = slice.read() as SliceStateValue;
        return state.search.type === "some" ? state.search.value.trim() : undefined;
        // eslint-disable-next-line react-hooks/exhaustive-deps -- sliceVersion IS the dependency of `slice.read()`: the store moves, no prop does (#611)
    }, [slice, sliceVersion]);
    // Without a slice, the member card a click selected.
    const [picked, setPicked] = useState<string | undefined>(undefined);

    const noun = useCallback((tab: SheetLibraryTabWord) => some({ singular: m.libraryNoun({ tab, n: 1 }), plural: m.libraryNoun({ tab, n: 2 }) }), [m]);
    const empty = useCallback((tab: SheetLibraryTabWord) => ({ title: m.libraryEmpty({ tab }), description: m.libraryEmptyHint({ tab }) }), [m]);

    // ── Rows: the templates, by their group (SB33) ──────────────────────
    const templates = value.templates;
    const rows = useMemo((): LibraryValue => ({
        id: `${keys.library}:rows`,
        hint: none,
        items: templates.map((template) => {
            const category = getSomeorUndefined(template.group);
            const sets = templateLine(template, columns, group, keyed, words);
            return card({
                key: template.key,
                label: template.name,
                sublabel: sets === "" ? none : some(sets),
                status: none,
                trailing: none,
                draggable: true,
                filtered: false,
                placed: false,
                search: some(line([template.name, category ?? "", sets])),
                groups: category === undefined ? new Map() : new Map([["category", category]]),
            });
        }),
        groupOptions: [{ key: "category", label: m.libraryGroupBy({ tab: "rows" }) }],
        groupSummaries: new Map(),
        dimOptions: [],
        defaultDimensions: [],
        filterOptions: [],
        searchable: true,
        noun: noun("rows"),
        addLabel: none,
        onAdd: none,
        onCardClick: none,
        slice: none,
        style: FILL,
        variant: none,
        layout: none,
        toolbar: true,
    }), [keys.library, templates, columns, group, keyed, words, m, noun]);

    // ── Registers: the driver's members, then each register's (SB34) ────
    const members = useMemo((): MemberCard[] => {
        const out: MemberCard[] = [];
        const seen = new Set<string>();
        const add = (key: string, driver: boolean, label: string, member: SheetRegisterMemberValue) => {
            if (seen.has(key)) return;
            seen.add(key);
            out.push({ key, driver, group: label, member });
        };
        const driver = getSomeorUndefined(sheet.driver);
        if (driver !== undefined) {
            const header = columns.byKey.get(driver.column)?.header ?? driver.column;
            for (const member of driver.members) add(["driver", member.kind, member.key].join(CARD_SEP), true, m.driverGroup({ header }), member);
        }
        // By register, then by kind, each kind's members in their order; a member a register lists twice once. The
        // sheet keeps the driver's members as a register under its column's name too: they are listed once, first.
        for (const [register, { members: listed }] of sheet.registers) {
            if (driver !== undefined && stringEqual(register, driver.column)) continue;
            const kinds = [...new Set(listed.map((member) => member.kind))];
            for (const kind of kinds) {
                for (const member of listed) {
                    if (!stringEqual(member.kind, kind)) continue;
                    add(["register", register, kind, member.key].join(CARD_SEP), false, m.registerGroup({ register, kind }), member);
                }
            }
        }
        return out;
    }, [sheet.driver, sheet.registers, columns, m]);
    const onMember = useCallback((key: string) => {
        const found = members.find((c) => stringEqual(c.key, key));
        if (found === undefined) return;
        if (slice === undefined) {
            setPicked((was) => (was !== undefined && stringEqual(was, key) ? undefined : key));
            return;
        }
        // A click on the member the sheet narrows to lets go of it.
        const narrowed = search !== undefined && stringEqual(search, found.member.key);
        queueMicrotask(() => slice.setSearch(narrowed ? none : some(found.member.key)));
    }, [members, slice, search]);
    const registers = useMemo((): LibraryValue => ({
        id: `${keys.library}:registers`,
        hint: none,
        items: members.map(({ key, driver, group: label, member }) => {
            const meta = getSomeorUndefined(member.meta) ?? "";
            const tone = getSomeorUndefined(member.tone);
            return card({
                key,
                label: member.label === "" ? member.key : member.label,
                // A driver member's kind is its tag; a register member's sits after its meta, unless its meta says it already.
                sublabel: some(line(driver || stringEqual(meta, member.kind) ? [meta] : [meta, member.kind])),
                status: driver ? some({ label: member.kind, tone: variant("neutral", null), ring: false }) : none,
                trailing: tone === undefined ? none : some({ icon: "circle", label: m.memberTone({ tone: tone.type }), tone: some(tone) }),
                draggable: true,
                filtered: false,
                placed: slice !== undefined ? search !== undefined && stringEqual(search, member.key) : picked !== undefined && stringEqual(picked, key),
                search: some([member.key, member.label, ...member.aliases].join(" ")),
                groups: new Map([["source", label]]),
            });
        }),
        groupOptions: [{ key: "source", label: m.libraryGroupBy({ tab: "registers" }) }],
        groupSummaries: new Map(),
        dimOptions: [],
        defaultDimensions: [],
        filterOptions: [],
        searchable: true,
        noun: noun("registers"),
        addLabel: none,
        onAdd: none,
        onCardClick: some((key: string) => { onMember(key); return null; }),
        slice: none,
        style: FILL,
        variant: none,
        layout: none,
        toolbar: true,
    }), [keys.library, members, slice, search, picked, onMember, m, noun]);

    // ── Columns: each with its kind and an eye (SB36) ───────────────────
    const shown = columns.list.filter((col) => !hidden.has(col.key)).length;
    const onColumn = useCallback((key: string) => {
        // The last column shown stays.
        if (!hidden.has(key) && shown <= 1) return;
        onToggleColumn(key);
    }, [hidden, shown, onToggleColumn]);
    const columnCards = useMemo((): LibraryValue => ({
        id: `${keys.library}:columns`,
        hint: none,
        items: columns.list.map((col) => {
            const off = hidden.has(col.key);
            const kind = m.columnKind({ kind: col.kind });
            return card({
                key: col.key,
                label: col.header,
                sublabel: some(kind),
                status: none,
                trailing: some({ icon: off ? "eye-slash" : "eye", label: m.columnEye({ hidden: off, last: !off && shown <= 1 }), tone: none }),
                draggable: false,
                filtered: off,
                placed: false,
                search: some(line([col.header, col.key, kind])),
                groups: new Map(),
            });
        }),
        groupOptions: [],
        groupSummaries: new Map(),
        dimOptions: [],
        defaultDimensions: [],
        filterOptions: [],
        searchable: true,
        noun: noun("columns"),
        addLabel: none,
        onAdd: none,
        onCardClick: some((key: string) => { onColumn(key); return null; }),
        slice: none,
        style: FILL,
        variant: none,
        layout: none,
        toolbar: true,
    }), [keys.library, columns, hidden, shown, onColumn, m, noun]);

    return useMemo((): BuilderFrameDock => ({
        label: m.libraryPane(),
        icon: "layer-group",
        badge: words.number(templates.length),
        size: LIBRARY_SIZE,
        persist: "local",
        tabs: [
            { key: "rows", label: m.libraryTab({ tab: "rows" }), count: words.number(rows.items.length),
                body: <EastChakraLibrary value={rows} storageKey={`${keys.library}.rows`} empty={empty("rows")} /> },
            { key: "registers", label: m.libraryTab({ tab: "registers" }), count: words.number(registers.items.length),
                body: <EastChakraLibrary value={registers} storageKey={`${keys.library}.registers`} empty={empty("registers")} /> },
            { key: "columns", label: m.libraryTab({ tab: "columns" }), count: words.number(columnCards.items.length),
                body: <EastChakraLibrary value={columnCards} storageKey={`${keys.library}.columns`} empty={empty("columns")} /> },
        ],
    }), [m, words, templates.length, rows, registers, columnCards, keys.library, empty]);
}
