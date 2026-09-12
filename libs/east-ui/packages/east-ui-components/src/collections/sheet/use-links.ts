/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The link columns' wiring (P3 — `Sheet Spec.md` §6.3 "Links"): one
 * vocabulary per link / set column, the per-driver halves and locks, the
 * checks run once per row value (a `WeakMap` over the immutable row), and the
 * link editor's context — candidates over the vocabulary, resolution, the
 * prediction from the column's pending fill, the cell for the halves.
 */

import { useCallback, useMemo, useRef } from "react";
import { none, variant } from "@elaraai/east";
import { getSomeorUndefined } from "../../utils.js";
import { driverKeyOf, type SheetBodyItem, type SheetColumnIndex, type SheetColumnMeta, type SheetRegisterIndex } from "./model.js";
import { linkVocabulary, usedKeys, type LinkVocabulary } from "./link/grammar.js";
import { halvesFor, sidesDeclOf, type SidesDecl } from "./link/sides.js";
import { linkCandidates, linkCandidateAt, resolveBuffer, predictedMembers } from "./link/predict.js";
import { checksOf, checkLink, NO_FLAGS, type CheckDecl, type LinkFlags } from "./link/checks.js";
import type { LinkCellContext } from "./cells/Cell.js";
import type { LinkEditCtx, LinkGroups } from "./sheet-types.js";
import type { SheetArityValue, SheetCellValue, SheetDriverValue, SheetLinkValue, SheetRowValue } from "./values.js";

/** One link column's decoded declaration. */
export interface LinkColumn {
    vocab: LinkVocabulary;
    sides: SidesDecl | undefined;
    checks: readonly CheckDecl[];
    /** The arity rule on the wire — the half it counts and the bridged rule. */
    arity: SheetArityValue | undefined;
}

export interface UseSheetLinksArgs {
    columns: SheetColumnIndex;
    registers: SheetRegisterIndex;
    driver: SheetDriverValue | undefined;
    driverColumn: string | undefined;
    body: readonly SheetBodyItem[];
    rowAt: (r: number) => SheetBodyItem | undefined;
    /** The copilot's pending fill for a link cell — what the editor predicts from (`undefined` = none). */
    predictedLink: (r: number, key: string) => SheetLinkValue | undefined;
}

export interface SheetLinks {
    linkVocabularies: ReadonlyMap<string, LinkVocabulary>;
    linkColumns: ReadonlyMap<string, LinkColumn>;
    driverName: (row: SheetRowValue | undefined) => string;
    linkCellCtx: (row: SheetRowValue | undefined, meta: SheetColumnMeta) => LinkCellContext | undefined;
    linkCtxFor: (r: number, c: number) => LinkEditCtx | undefined;
}

/** The link columns' vocabularies, halves, checks and editor contexts. */
export function useSheetLinks({ columns, registers, driver, driverColumn, body, rowAt, predictedLink }: UseSheetLinksArgs): SheetLinks {
    const linkVocabularies = useMemo(() => {
        const out = new Map<string, LinkVocabulary>();
        for (const meta of columns.list) {
            if (meta.kind !== "link" && meta.kind !== "set") continue;
            out.set(meta.key, linkVocabulary(meta, meta.register !== undefined ? registers.byName.get(meta.register) ?? [] : []));
        }
        return out;
    }, [columns, registers]);
    const linkColumns = useMemo(() => {
        const out = new Map<string, LinkColumn>();
        for (const meta of columns.list) {
            if (meta.kind !== "link" && meta.kind !== "set") continue;
            const members = meta.register !== undefined ? registers.byName.get(meta.register) ?? [] : [];
            out.set(meta.key, {
                vocab: linkVocabularies.get(meta.key) ?? linkVocabulary(meta, members),
                sides: sidesDeclOf(meta),
                checks: checksOf(meta),
                arity: meta.raw.kind.type === "link" ? getSomeorUndefined(meta.raw.kind.value.arity) : undefined,
            });
        }
        return out;
    }, [columns, registers, linkVocabularies]);
    const driverName = useCallback((row: SheetRowValue | undefined): string => {
        const key = driverKeyOf(row, driverColumn);
        if (key === undefined) return "This row";
        const member = driver?.members.find((m) => m.key === key);
        return member?.label ?? key;
    }, [driverColumn, driver]);
    // Checks run once per row value and column (rows are immutable values).
    const flagCache = useRef(new WeakMap<SheetRowValue, Map<string, LinkFlags>>());
    const flagsFor = useCallback((item: SheetBodyItem, meta: SheetColumnMeta): LinkFlags => {
        if (item.kind !== "real") return NO_FLAGS;
        const lc = linkColumns.get(meta.key);
        const cell = item.row.cells.get(meta.key);
        if (lc === undefined || lc.checks.length === 0 || cell === undefined || cell.type !== "Link") return NO_FLAGS;
        let byKey = flagCache.current.get(item.row);
        if (byKey === undefined) { byKey = new Map(); flagCache.current.set(item.row, byKey); }
        const known = byKey.get(meta.key);
        if (known !== undefined) return known;
        const flags = checkLink(cell.value, lc.checks, lc.vocab, (half, member) => ({
            rowIndex: BigInt(item.residentIndex), rowId: item.row.id, offset: BigInt(item.position), line: none,
            row: item.row.cells, half: variant(half, null), member,
        }));
        byKey.set(meta.key, flags);
        return flags;
    }, [linkColumns]);
    const linkCellCtx = useCallback((row: SheetRowValue | undefined, meta: SheetColumnMeta): LinkCellContext | undefined => {
        const lc = linkColumns.get(meta.key);
        if (lc === undefined) return undefined;
        const item = row !== undefined ? body.find((it) => it.kind === "real" && it.row === row) : undefined;
        return {
            halves: halvesFor(lc.sides, driverKeyOf(row, driverColumn)),
            vocab: lc.vocab,
            flags: item !== undefined ? flagsFor(item, meta) : NO_FLAGS,
            driverName: driverName(row),
        };
    }, [linkColumns, body, driverColumn, flagsFor, driverName]);
    const linkCtxFor = useCallback((r: number, c: number): LinkEditCtx | undefined => {
        const meta = columns.list[c];
        if (meta === undefined) return undefined;
        const lc = linkColumns.get(meta.key);
        if (lc === undefined) return undefined;
        const it = rowAt(r);
        const row = it !== undefined && it.kind === "real" ? it.row : undefined;
        const cell = row?.cells.get(meta.key);
        const current = cell !== undefined && cell.type === "Link" ? cell.value : undefined;
        const halves = meta.kind === "set"
            ? { from: { live: false, lock: "" }, to: { live: true, lock: "" }, isIn: false, sides: "to" as const }
            : halvesFor(lc.sides, driverKeyOf(row, driverColumn));
        const vocab = lc.vocab;
        const usedOf = (groups: LinkGroups) => usedKeys([...groups[0], ...groups[1]], vocab);
        return {
            halves,
            initial: [current !== undefined ? [...current.from] : [], current !== undefined ? [...current.to] : []],
            candidates: (text, groups) => linkCandidates(text, vocab, usedOf(groups)),
            candidateAt: (text, hi, groups) => linkCandidateAt(text, hi, vocab, usedOf(groups)),
            resolve: (text, cand) => resolveBuffer(text, cand, vocab),
            predicted: (side, groups, typed) => predictedMembers(predictedLink(r, meta.key), side, groups, side === 0 ? halves.from.live : halves.to.live, typed, vocab),
            cell: (groups): SheetCellValue | null => (groups[0].length === 0 && groups[1].length === 0 ? null : variant("Link", { from: groups[0], to: groups[1] })),
            driverName: driverName(row),
        };
    }, [columns, linkColumns, rowAt, driverColumn, driverName, predictedLink]);
    return { linkVocabularies, linkColumns, driverName, linkCellCtx, linkCtxFor };
}
