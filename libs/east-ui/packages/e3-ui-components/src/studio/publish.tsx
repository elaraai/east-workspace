/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `EastChakraStudioPublish` — the renderer of the `StudioPublish` extension
 * declared in `@elaraai/e3-ui` (#998): the publish preview.
 *
 * - **The bar**, headerless, on the inverse ground: "● Preview"; Desktop ·
 *   Tablet · Mobile, which draw the page 1440, 1024 or 390 px wide at most;
 *   the Env pill; and Exit, back to the builder.
 * - **The page**: its project, its title, and the page as it will publish —
 *   the payload's own East function draws it — together at most the
 *   device's width.
 * - **The aside**: where the page stands, the version it replaces and the one
 *   it becomes, the change list, the banner, the Audience and Rollout rows,
 *   and what refused a write.
 * - **The footer**: Save as draft asks the canvas for an Apply; Publish asks
 *   for one when the canvas has drafts, waits for the canvas's answer, then
 *   commits the publish.
 *
 * The canvas answers an Apply through the builder's shared State, under the id
 * asked, so the answer to another screen's ask is never taken for this one's.
 * Every word is the Studio's message table's; numbers print in the locale.
 *
 * Its layout, its bar and its banner are the `studioPublish` recipe's — the
 * banner the design system's, on the theme's banner layer styles — and its
 * buttons the `button` recipe's.
 *
 * @packageDocumentation
 */

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Box, Button as ChakraButton, chakra, useSlotRecipe, type SystemStyleObject } from "@chakra-ui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faChevronDown, faDesktop, faMobileScreen, faTabletScreenButton } from "@fortawesome/free-solid-svg-icons";
import { type ValueTypeOf } from "@elaraai/east";
import { StudioPublishComponent } from "@elaraai/e3-ui/internal";
import { EastChakraComponent, implementUIComponent, useFormatters } from "@elaraai/east-ui-components";

import { useStudioMessages } from "./messages.js";

type Styles = Record<string, SystemStyleObject>;

/** The renderer's payload, decoded. */
type StudioPublishValue = ValueTypeOf<typeof StudioPublishComponent.schema>;

/** The devices the bar offers, and the most each draws the page wide, in px. */
const DEVICES = [
    { device: "desktop", icon: faDesktop, width: 1440 },
    { device: "tablet", icon: faTabletScreenButton, width: 1024 },
    { device: "mobile", icon: faMobileScreen, width: 390 },
] as const;

/** A device the bar offers. */
type Device = (typeof DEVICES)[number]["device"];

/**
 * Where the footer's writes stand: at rest; an Apply asked of the canvas,
 * under its id, and whether a publish follows it; a publish committing; or a
 * write refused, and why.
 */
type Phase =
    | { kind: "idle" }
    | { kind: "applying"; id: string; publish: boolean }
    | { kind: "publishing" }
    | { kind: "refused"; reason: string };

/** Props of {@link EastChakraStudioPublish}. */
export interface EastChakraStudioPublishProps {
    /** The payload, decoded. */
    value: StudioPublishValue;
    /** The structural storage key. */
    storageKey: string;
}

/**
 * Renders the publish preview — see the module docs.
 *
 * @param props - The payload and its storage key
 * @returns The publish preview
 */
export const EastChakraStudioPublish = memo(function EastChakraStudioPublish({ value, storageKey }: EastChakraStudioPublishProps) {
    const styles = useSlotRecipe({ key: "studioPublish" })() as Styles;
    const m = useStudioMessages();
    const words = useFormatters();
    const [device, setDevice] = useState<Device>("desktop");
    const [phase, setPhase] = useState<Phase>({ kind: "idle" });
    // What the writes read when they run — this render's payload.
    const latest = useRef(value);
    latest.current = value;

    const pageView = value.page;
    const page = useMemo(() => pageView(), [pageView]);

    const summary = value.summary;
    const standing = summary.standing.type;
    const live = summary.live.type === "some" ? summary.live.value : undefined;
    const liveVersion = live === undefined ? "" : m.version({ version: words.number(live) });
    const nextVersion = m.version({ version: words.number(live === undefined ? 1n : live + 1n) });
    const env = value.env.type === "some" ? value.env.value : undefined;
    const exit = value.onExit.type === "some" ? value.onExit.value : undefined;
    const busy = phase.kind === "applying" || phase.kind === "publishing";
    const width = DEVICES.find((d) => d.device === device)!.width;

    // The publish, from the payload as it stands when it runs.
    const publish = useCallback(async () => {
        setPhase({ kind: "publishing" });
        let reason: string | undefined;
        try {
            const refused = await latest.current.onPublish();
            reason = refused.type === "some" ? refused.value : undefined;
        } catch (err) {
            reason = err instanceof Error ? err.message : String(err);
        }
        setPhase(reason === undefined ? { kind: "idle" } : { kind: "refused", reason });
    }, []);
    // An Apply asked of the canvas, under an id of its own.
    const ask = (then: "save" | "publish") => {
        const id = Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => b.toString(16).padStart(2, "0")).join("");
        setPhase({ kind: "applying", id, publish: then === "publish" });
        const onApply = value.onApply;
        queueMicrotask(() => {
            try {
                onApply(id);
            } catch (err) {
                setPhase({ kind: "refused", reason: err instanceof Error ? err.message : String(err) });
            }
        });
    };
    // The canvas's answer, under the id asked: the drafts landed — publish if
    // asked to — or what refused them.
    const answer = value.apply;
    useEffect(() => {
        if (phase.kind !== "applying") return;
        if (answer.type === "applied" && answer.value === phase.id) {
            if (phase.publish) void publish();
            else setPhase({ kind: "idle" });
        } else if (answer.type === "refused" && answer.value.id === phase.id) {
            setPhase({ kind: "refused", reason: answer.value.reason });
        }
    }, [answer, phase, publish]);

    const changes = summary.changes;
    const changed = summary.changed;
    const count = changes.length;
    const head = standing === "ready" ? m.readyToPublish() : standing === "current" ? m.upToDate() : m.templateNotPublished();
    const listHead = live === undefined ? m.changesFirst({ n: count, count: words.number(count) })
        : count === 0 ? m.noChangesSince({ version: liveVersion })
            : m.changesSince({ n: count, count: words.number(count), version: liveVersion });
    const tone = changed.length === 0 ? "change" : "warning";
    const audience = value.audience.type === "some" ? value.audience.value : undefined;
    const rollout = value.rollout.type === "some" ? value.rollout.value : undefined;

    return (
        <Box css={styles.root} data-studio-publish="">
            <Box css={styles.bar} data-publish-bar="">
                <Box as="span" css={styles.barLabel}>
                    <Box as="span" css={styles.barDot} aria-hidden />
                    {m.preview()}
                </Box>
                <Box css={styles.devices} role="group" aria-label={m.devices()} data-publish-devices="">
                    {DEVICES.map(({ device: d, icon }) => (
                        <chakra.button key={d} type="button" css={styles.device} data-state={device === d ? "on" : "off"}
                            aria-pressed={device === d} data-publish-device={d} onClick={() => setDevice(d)}>
                            <Box as="span" css={styles.deviceIcon} aria-hidden><FontAwesomeIcon icon={icon} /></Box>
                            {m.device({ device: d })}
                        </chakra.button>
                    ))}
                </Box>
                {env !== undefined && (
                    <Box as="span" css={styles.env} data-publish-env="">
                        {m.env()} ·
                        <Box as="span" css={styles.envName}>{env}</Box>
                        <Box as="span" css={styles.envCaret} aria-hidden><FontAwesomeIcon icon={faChevronDown} /></Box>
                    </Box>
                )}
                <chakra.button type="button" css={styles.exit} disabled={exit === undefined} data-publish-exit=""
                    onClick={() => { if (exit !== undefined) queueMicrotask(() => exit()); }}>
                    {m.exit()}
                </chakra.button>
            </Box>
            <Box css={styles.body}>
                <Box css={styles.main} data-publish-main="">
                    <Box css={styles.frame} style={{ maxWidth: `${width}px` }} data-publish-frame={device}>
                        <Box css={styles.head}>
                            <Box as="span" css={styles.eyebrow}>{value.project}</Box>
                            <Box as="h2" css={styles.title}>{value.title}</Box>
                        </Box>
                        <EastChakraComponent value={page} storageKey={`${storageKey}.page`} />
                    </Box>
                </Box>
                <Box as="aside" css={styles.aside} aria-label={head} data-publish-aside="">
                    <Box css={styles.asideHead}>
                        <Box as="span" css={styles.asideTitle} data-publish-head="">{head}</Box>
                        <Box as="span" css={styles.asideSub} data-publish-versions="">
                            {value.title} ·{" "}
                            {standing === "template" ? m.templateKind()
                                : standing === "current" ? `${liveVersion} ${m.liveVersion()}`
                                    : live === undefined ? <Box as="span" css={styles.asideVersion}>{nextVersion}</Box>
                                        : <>{liveVersion} → <Box as="span" css={styles.asideVersion}>{nextVersion}</Box></>}
                        </Box>
                    </Box>
                    <Box css={styles.asideBody}>
                        {standing !== "template" && (
                            <>
                                <Box as="span" css={styles.listHead} data-publish-count="">{listHead}</Box>
                                {count > 0 && (
                                    <Box as="ul" css={styles.list} aria-label={listHead} data-publish-changes="">
                                        {changes.map((row, i) => {
                                            const kind = row.change.type;
                                            return (
                                                <Box as="li" key={`${row.change.value.cell}-${kind}-${i}`} css={styles.change} data-publish-change={kind}>
                                                    <Box as="span" css={styles.sign} data-sign={kind} aria-hidden>
                                                        {kind === "added" ? "+" : kind === "removed" ? "−" : "±"}
                                                    </Box>
                                                    <Box css={styles.changeText}>
                                                        <Box as="span" css={styles.changeLine}>
                                                            {m.changeVerb({ change: kind })}{" "}
                                                            <Box as="strong" css={styles.changeName}>{row.name}</Box>
                                                        </Box>
                                                        <Box as="span" css={styles.changeDetail}>{row.change.value.detail}</Box>
                                                    </Box>
                                                </Box>
                                            );
                                        })}
                                    </Box>
                                )}
                                {standing === "ready" && live !== undefined && (
                                    <Box css={styles.banner} layerStyle={tone === "change" ? "banner.change" : "banner.guard"}
                                        data-tone={tone} role={tone === "warning" ? "alert" : "status"} data-publish-banner={tone}>
                                        <Box as="span" css={styles.bannerGlyph} aria-hidden>{tone === "change" ? "△" : "!"}</Box>
                                        <Box as="span" css={styles.bannerText}>
                                            {tone === "change" ? m.logicUnchanged() : m.logicChangedIn({ version: liveVersion, components: changed })}
                                        </Box>
                                    </Box>
                                )}
                            </>
                        )}
                        {(audience !== undefined || rollout !== undefined) && (
                            <Box css={styles.facts} data-publish-facts="">
                                {audience !== undefined && (
                                    <Box css={styles.fact}>
                                        <Box as="span" css={styles.factLabel}>{m.audience()}</Box>
                                        <Box as="span" css={styles.factValue}>{audience}</Box>
                                    </Box>
                                )}
                                {rollout !== undefined && (
                                    <Box css={styles.fact}>
                                        <Box as="span" css={styles.factLabel}>{m.rollout()}</Box>
                                        <Box as="span" css={styles.factValue}>{rollout}</Box>
                                    </Box>
                                )}
                            </Box>
                        )}
                        {phase.kind === "refused" && (
                            <Box as="span" role="alert" css={styles.refusal} data-publish-refused="">{phase.reason}</Box>
                        )}
                    </Box>
                    <Box css={styles.foot} data-publish-foot="">
                        <ChakraButton type="button" variant="outline" size="sm" data-publish-save=""
                            disabled={!summary.unsaved || busy} loading={phase.kind === "applying" && !phase.publish}
                            onClick={() => ask("save")}>
                            {m.saveAsDraft()}
                        </ChakraButton>
                        <ChakraButton type="button" size="sm" colorPalette="brand" data-publish-publish=""
                            disabled={standing !== "ready" || busy}
                            loading={(phase.kind === "applying" && phase.publish) || phase.kind === "publishing"}
                            onClick={() => { if (summary.unsaved) ask("publish"); else void publish(); }}>
                            {m.publishTo({ version: standing === "template" ? undefined : nextVersion, env })}
                        </ChakraButton>
                    </Box>
                </Box>
            </Box>
        </Box>
    );
});

implementUIComponent(StudioPublishComponent, EastChakraStudioPublish);
