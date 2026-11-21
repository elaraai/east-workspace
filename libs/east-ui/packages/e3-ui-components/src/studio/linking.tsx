/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Linking two visuals on the builder's canvas (#1673, LNK-6, LNK-7): with a
 * visual selected, Link — in its menu, or its Follows block — puts the canvas
 * in pick mode: a banner says what to do, in the canvas's frame's banners slot
 * under its toolbar as every builder's banners stand (the `banner` recipe's
 * `BannerView`), the visuals that can lead are outlined, the rest dim, Esc
 * cancels, and a click on a leader links it. The
 * match fills itself where the two read one source or share a field id;
 * otherwise, or where linking switches the leader's click to select, a
 * popover hanging from the leader proposes the match and says what changes,
 * for its operator to confirm. The rules are `query/visual/links.ts`'s; this
 * holds the mode and draws it.
 *
 * @packageDocumentation
 */

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Box, chakra, useRecipe, useSlotRecipe, type SystemStyleObject } from "@chakra-ui/react";
import type { ValueTypeOf } from "@elaraai/east";
import type { StudioCellType, StudioSourceType } from "@elaraai/e3-ui/internal";
import { BannerView, SliceEditPopover } from "@elaraai/east-ui-components";
import { Chooser, type ChooserSection } from "@elaraai/east-ui-components/internal";
import { leaderChoices, link, proposeMatch, type Linked, type Match } from "../query/visual/links.js";
import type { ConfigurePlacement } from "./follows.js";
import { useStudioMessages } from "./messages.js";
import { fieldLabel, midSentence } from "./visual/values.js";

/** One placement, decoded. */
type Cell = ValueTypeOf<typeof StudioCellType>;
/** A visual, decoded. */
type Visual = Extract<Cell["content"], { type: "visual" }>["value"];
/** A listed source, decoded. */
type Source = ValueTypeOf<typeof StudioSourceType>;

/** What a tile is while a leader is picked: the visual being linked, one that can lead, or neither. */
export type PickState = "follower" | "leader" | undefined;

/** A leader picked whose link waits to be confirmed: the match proposed, and whether linking switches its click. */
interface Picked {
    readonly leader: string;
    readonly match: Match;
    readonly switches: boolean;
}

/** The mode: the visual being linked, what the banner says of the last click, and a pick waiting to be confirmed. */
interface Mode {
    readonly follower: string;
    readonly note?: string | undefined;
    readonly picked?: Picked | undefined;
}

/** What {@link useLinking} is given. */
export interface LinkingOptions {
    /** The open page's placements, each with its name. */
    readonly placements: readonly ConfigurePlacement[];
    /** The sources the surface lists. */
    readonly sources: readonly Source[];
    /** Writes a link's edits: the leader's visual first, where linking switched its click, then the follower's. */
    readonly onLinked: (edits: readonly { readonly key: string; readonly visual: Visual }[]) => void;
}

/** Linking, as the builder holds it. */
export interface Linking {
    /** Whether a leader is being picked. */
    readonly active: boolean;
    /** Starts picking a leader for a placement. */
    readonly start: (follower: string) => void;
    /** A tile clicked while a leader is picked: whether the click was the pick's — never the canvas's selection. */
    readonly pick: (key: string) => boolean;
    /** What a tile is while a leader is picked. */
    readonly stateOf: (key: string) => PickState;
    /** The banner, for the canvas's banners slot, and the popover hanging from the leader while a pick waits to be confirmed; nothing outside pick mode. */
    readonly surface: ReactNode;
}

/**
 * Linking on the canvas — see the module docs.
 *
 * @param options - The page's placements, the listed sources, and where a link's edits go
 * @returns The mode, what starts it, what a tile's click does in it, and what it draws
 */
export function useLinking({ placements, sources, onLinked }: LinkingOptions): Linking {
    const m = useStudioMessages();
    const styles = useSlotRecipe({ key: "studioBuilder" })() as Record<string, SystemStyleObject>;
    const button = useRecipe({ key: "button" });
    const [mode, setMode] = useState<Mode | undefined>(undefined);
    const cells = useMemo(() => placements.map((placed) => placed.cell), [placements]);
    const nameOf = useCallback((key: string) => placements.find((placed) => placed.cell.key === key)?.name ?? key, [placements]);
    const visualOf = useCallback((key: string): Visual | undefined => {
        const cell = cells.find((held) => held.key === key);
        return cell !== undefined && cell.content.type === "visual" ? cell.content.value : undefined;
    }, [cells]);
    const sourceOf = useCallback((key: string | undefined) => sources.find((source) => source.key === key), [sources]);
    const follower = mode?.follower;
    const choices = useMemo(() => (follower === undefined ? [] : leaderChoices(cells, follower)), [cells, follower]);
    const cancel = useCallback(() => setMode(undefined), []);
    // The follower's own placement gone — deleted while linking — ends the mode.
    const stands = follower === undefined || cells.some((cell) => cell.key === follower);
    useEffect(() => {
        if (!stands) setMode(undefined);
    }, [stands]);
    // Esc cancels: a popover open takes its own first, and closing it cancels too.
    useEffect(() => {
        if (follower === undefined) return;
        const onKey = (event: KeyboardEvent) => {
            if (event.key === "Escape") setMode(undefined);
        };
        document.addEventListener("keydown", onKey);
        return () => document.removeEventListener("keydown", onKey);
    }, [follower]);

    /** A link's edits written, and the mode left. */
    const write = useCallback((linked: Linked, leader: string, following: string) => {
        onLinked([...(linked.leader === undefined ? [] : [{ key: leader, visual: linked.leader }]), { key: following, visual: linked.follower }]);
        setMode(undefined);
    }, [onLinked]);

    const pick = useCallback((key: string): boolean => {
        if (follower === undefined) return false;
        if (key === follower) return true;
        const choice = choices.find((held) => held.cell.key === key);
        if (choice === undefined) {
            setMode({ follower, note: m.linkNothing({ leader: nameOf(key) }) });
            return true;
        }
        if (choice.cycle) {
            setMode({ follower, note: m.linkCycle({ leader: nameOf(key) }) });
            return true;
        }
        const leader = visualOf(key);
        const following = visualOf(follower);
        if (leader === undefined || following === undefined) return true;
        const match = proposeMatch(leader, sourceOf(leader.source), following.source, sourceOf(following.source));
        if (match === undefined) {
            setMode({ follower, note: m.linkNothing({ leader: nameOf(key) }) });
            return true;
        }
        // Sure, and nothing of the leader changes: linked at once. Otherwise its operator confirms.
        if (match.sure && choice.selects) {
            const linked = link(cells, follower, key, match);
            if (!("refused" in linked)) write(linked, key, follower);
            return true;
        }
        setMode({ follower, picked: { leader: key, match, switches: !choice.selects } });
        return true;
    }, [follower, choices, cells, visualOf, sourceOf, nameOf, write, m]);

    const stateOf = useCallback((key: string): PickState => {
        if (follower === undefined) return undefined;
        if (key === follower) return "follower";
        return choices.some((choice) => choice.cell.key === key && !choice.cycle) ? "leader" : undefined;
    }, [follower, choices]);

    const picked = mode?.picked;
    const confirm = useCallback(() => {
        if (follower === undefined || picked === undefined) return;
        const linked = link(cells, follower, picked.leader, picked.match);
        if ("refused" in linked) setMode({ follower, note: m.linkCycle({ leader: nameOf(picked.leader) }) });
        else write(linked, picked.leader, follower);
    }, [follower, picked, cells, write, nameOf, m]);

    let surface: ReactNode = null;
    if (mode !== undefined) {
        const following = visualOf(mode.follower);
        const own = sourceOf(following?.source);
        const leader = picked === undefined ? undefined : visualOf(picked.leader);
        const leaderSource = sourceOf(leader?.source);
        const fields: ChooserSection[] = picked === undefined ? [] : [{
            label: own?.name ?? following?.source ?? "",
            options: (own?.fields ?? []).map((listed) => ({ key: listed.id, label: listed.label, state: listed.id === picked.match.to ? "current" as const : "enabled" as const })),
        }];
        surface = (
            <Box data-studio-linking="">
                <SliceEditPopover open={picked !== undefined} onOpenChange={(open) => { if (!open) setMode({ follower: mode.follower }); }}
                    label={picked === undefined ? "" : m.linkFollow({ leader: nameOf(picked.leader) })} size="lg"
                    hangFrom={() => (picked === undefined ? null : document.querySelector(`[data-studio-canvas] [data-studio-placement="${CSS.escape(picked.leader)}"]`)?.getBoundingClientRect() ?? null)}
                    footActions={(
                        <>
                            <chakra.button type="button" css={button({ variant: "outline", size: "xs" })} onClick={() => setMode({ follower: mode.follower })}>{m.cancel()}</chakra.button>
                            <chakra.button type="button" css={button({ variant: "solid", size: "xs" })} data-studio-link-confirm="" onClick={confirm}>{m.link()}</chakra.button>
                        </>
                    )}
                    anchor={(
                        <BannerView status="info" icon={{ prefix: "fas", name: "link" }} title={m.linkPick({ follower: nameOf(mode.follower) })}
                            description={mode.note ?? m.linkPickHint()}
                            actions={<chakra.button type="button" css={button({ variant: "outline", size: "xs" })} data-studio-link-cancel="" onClick={cancel}>{m.cancel()}</chakra.button>} />
                    )}>
                    {picked !== undefined && leader !== undefined && (
                        <>
                            <Box as="p" css={styles.linkNote} data-studio-link-match="">
                                {m.linkMatch({ leader: nameOf(picked.leader), from: midSentence(leaderSource === undefined ? picked.match.from : fieldLabel(leaderSource, picked.match.from)) })}
                            </Box>
                            <Chooser sections={fields} placeholder={m.findField()} onChoose={(to) => setMode({ follower: mode.follower, picked: { ...picked, match: { ...picked.match, to } } })} />
                            {!picked.match.sure && (
                                <Box as="p" css={styles.linkNote} data-studio-link-note="match">
                                    {m.linkByName({ follower: nameOf(mode.follower), source: own?.name ?? following?.source ?? "", leader: nameOf(picked.leader), leaderSource: leaderSource?.name ?? leader.source })}
                                </Box>
                            )}
                            {picked.switches && (
                                <Box as="p" css={styles.linkNote} data-studio-link-note="click">
                                    {m.linkSwitches({ leader: nameOf(picked.leader), click: leader.click.type })}
                                </Box>
                            )}
                        </>
                    )}
                </SliceEditPopover>
            </Box>
        );
    }
    return { active: mode !== undefined, start: useCallback((key: string) => setMode({ follower: key }), []), pick, stateOf, surface };
}
