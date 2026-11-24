/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Configure tab's Follows block (#1673, LNK-3 to LNK-5, LNK-7): the
 * visual a visual follows — picked from the page's visuals whose click
 * selects, one whose link would make a cycle refused — the match between the
 * leader's field and this visual's, which fills itself where both read one
 * source or share a field id and is proposed by name and kind otherwise, what
 * the visual shows with nothing selected, and Stop following. The rules are
 * `query/visual/links.ts`'s; this draws them.
 *
 * @packageDocumentation
 */

import { useMemo, type ReactNode } from "react";
import { Box, chakra, useRecipe, useSlotRecipe, type SystemStyleObject } from "@chakra-ui/react";
import { faLink } from "@fortawesome/free-solid-svg-icons";
import { some, variant, type ValueTypeOf } from "@elaraai/east";
import type { StudioCellType, StudioSourceType } from "@elaraai/e3-ui/internal";
import type { ChooserSection } from "@elaraai/east-ui-components/internal";
import { clickFields, leaderChoices, link, proposeMatch, unlinked } from "../query/visual/links.js";
import { useStudioMessages } from "./messages.js";
import { PickBox } from "./pick-box.js";
import { SegStrip } from "./seg.js";
import { studioEast } from "./studio-east.js";
import { fieldLabel } from "./visual/values.js";

/** One placement, decoded. */
type Cell = ValueTypeOf<typeof StudioCellType>;
/** A visual, decoded. */
type Visual = Extract<Cell["content"], { type: "visual" }>["value"];
/** A listed source, decoded. */
type Source = ValueTypeOf<typeof StudioSourceType>;

/** The chooser's key for following none: no placement's key is empty. */
const NOTHING = "";

/** A placement of the page, as the Follows block names it. */
export interface ConfigurePlacement {
    /** The placement. */
    readonly cell: Cell;
    /** Its name, as its tile's eyebrow says it. */
    readonly name: string;
}

/** Props of {@link StudioFollows}. */
export interface StudioFollowsProps {
    /** The selected placement's key: the follower's. */
    readonly placement: string;
    /** Its visual. */
    readonly visual: Visual;
    /** The page's placements, each with its name. */
    readonly placements: readonly ConfigurePlacement[];
    /** The sources the surface lists. */
    readonly sources: readonly Source[];
    /** Draws one field: its label over its control, its hint under it, tinted while an edit changed it. */
    readonly field: (props: { label: string; part: string; hint?: string | undefined; children: ReactNode }) => ReactNode;
    /** Writes the visual: one gesture of the canvas. */
    readonly onEdit: (visual: Visual) => void;
    /** Starts linking it on the canvas, where a click picks its leader (LNK-6); omitted, the block has no such button. */
    readonly onLink?: (() => void) | undefined;
}

/**
 * The Follows block — see the module docs.
 *
 * @param props - The follower, the page's placements, the listed sources, how a field is drawn and where an edit goes
 * @returns The block's fields
 */
export function StudioFollows({ placement, visual, placements, sources, field, onEdit, onLink }: StudioFollowsProps) {
    const m = useStudioMessages();
    const east = studioEast();
    const styles = useSlotRecipe({ key: "studioInspector" })() as Record<string, SystemStyleObject>;
    const button = useRecipe({ key: "button" });
    const cells = useMemo(() => placements.map((placed) => placed.cell), [placements]);
    const follow = visual.follow.type === "some" ? visual.follow.value : undefined;
    const following = follow?.leader;
    const sourceOf = (key: string) => sources.find((source) => source.key === key);
    const nameOf = (key: string) => placements.find((placed) => placed.cell.key === key)?.name;
    const own = sourceOf(visual.source);
    const leaderCell = follow === undefined ? undefined : cells.find((cell) => cell.key === follow.leader);
    const leader = leaderCell !== undefined && leaderCell.content.type === "visual" ? leaderCell.content.value : undefined;
    const leaderSource = leader === undefined ? undefined : sourceOf(leader.source);
    // The visuals it may follow: those whose click selects — and the one it follows, whatever its click is now.
    const leaders = useMemo((): ChooserSection[] => [{
        label: m.followsLeaders(),
        options: [
            { key: NOTHING, label: m.followsNothing(), state: following === undefined ? "current" as const : "enabled" as const },
            ...leaderChoices(cells, placement).filter((choice) => choice.selects || choice.cell.key === following).map((choice) => {
                const held = choice.cell.content.type === "visual" ? choice.cell.content.value : undefined;
                const line = held === undefined ? undefined : m.followsLine({ view: east.viewWords(held.view), source: sources.find((source) => source.key === held.source)?.name ?? held.source });
                return {
                    key: choice.cell.key, label: placements.find((placed) => placed.cell.key === choice.cell.key)?.name ?? choice.cell.key,
                    line: choice.cycle ? m.followsCycle() : line,
                    state: choice.cell.key === following ? "current" as const : choice.cycle ? "refused" as const : "enabled" as const,
                };
            }),
        ],
    }], [cells, placement, placements, sources, following, m, east]);
    const onLeader = (key: string) => {
        if (key === NOTHING) {
            if (follow !== undefined) onEdit(unlinked(visual));
            return;
        }
        if (key === follow?.leader) return;
        const picked = cells.find((cell) => cell.key === key);
        if (picked === undefined || picked.content.type !== "visual") return;
        // The match it starts with: the same field where the two read one source or share its id, else the best by name and kind.
        const first = clickFields(picked.content.value.view)[0];
        const match = proposeMatch(picked.content.value, sourceOf(picked.content.value.source), visual.source, own) ?? (first === undefined ? undefined : { from: first, to: first });
        if (match === undefined) return;
        const linked = link(cells, placement, key, match);
        if (!("refused" in linked)) onEdit(linked.follower);
    };
    const leaderBox = field({
        label: m.follows(), part: "follow", hint: follow === undefined ? m.followsHint() : leader === undefined ? m.followGoneHint() : undefined,
        children: (
            <PickBox label={m.follows()} said={follow === undefined ? m.followsNothing() : nameOf(follow.leader) ?? m.followRemoved()} icon={follow === undefined ? undefined : faLink}
                sections={leaders} placeholder={m.followsFind()} data={{ "data-configure-follows": follow?.leader ?? "" }} onChoose={onLeader} />
        ),
    });
    const linkButton = onLink === undefined ? null : (
        <chakra.button type="button" css={[button({ variant: "outline", size: "xs" }), styles.stop]} data-configure-link="" onClick={onLink}>
            {m.linkOnCanvas()}
        </chakra.button>
    );
    if (follow === undefined) return <>{leaderBox}{linkButton}</>;
    const said = (source: Source | undefined, id: string) => (source === undefined ? id : fieldLabel(source, id));
    // The leader's fields its selection holds, and every field of this visual's source.
    const fromFields = leader === undefined ? [follow.from] : clickFields(leader.view);
    const fromSections: ChooserSection[] = [{
        label: nameOf(follow.leader) ?? m.followRemoved(),
        options: fromFields.map((id) => ({ key: id, label: said(leaderSource, id), state: id === follow.from ? "current" as const : "enabled" as const })),
    }];
    const toSections: ChooserSection[] = [{
        label: own?.name ?? visual.source,
        options: (own?.fields ?? []).map((listed) => ({ key: listed.id, label: listed.label, state: listed.id === follow.to ? "current" as const : "enabled" as const })),
    }];
    const withFollow = (next: Partial<typeof follow>) => onEdit({ ...visual, follow: some({ ...follow, ...next }) });
    return (
        <>
            {leaderBox}
            {field({
                label: m.match(), part: "follow",
                hint: m.matchHint({ leaderSource: leaderSource?.name ?? leader?.source ?? follow.leader, from: said(leaderSource, follow.from), source: own?.name ?? visual.source, to: said(own, follow.to) }),
                children: (
                    <Box css={styles.match} data-configure-match="">
                        <PickBox label={m.matchFrom({ leader: nameOf(follow.leader) ?? m.followRemoved() })} said={said(leaderSource, follow.from)} sections={fromSections}
                            placeholder={m.findField()} data={{ "data-configure-match-from": follow.from }} onChoose={(from) => { if (from !== follow.from) withFollow({ from }); }} />
                        <Box as="span" css={styles.matchEquals} aria-hidden>=</Box>
                        <PickBox label={m.matchTo()} said={said(own, follow.to)} sections={toSections}
                            placeholder={m.findField()} data={{ "data-configure-match-to": follow.to }} onChoose={(to) => { if (to !== follow.to) withFollow({ to }); }} />
                    </Box>
                ),
            })}
            {field({
                label: m.followEmpty(), part: "follow",
                children: (
                    <SegStrip label={m.followEmpty()} name="follow-empty" current={follow.empty.type}
                        options={[{ key: "all", label: m.followAll() }, { key: "prompt", label: m.followAsk() }]}
                        onPick={(key) => withFollow({ empty: key === "prompt" ? variant("prompt", null) : variant("all", null) })} />
                ),
            })}
            <chakra.button type="button" css={[button({ variant: "outline", size: "xs" }), styles.stop]} data-configure-stop-following="" onClick={() => onEdit(unlinked(visual))}>
                {m.stopFollowing()}
            </chakra.button>
        </>
    );
}
