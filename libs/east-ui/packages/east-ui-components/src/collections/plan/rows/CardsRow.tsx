/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Cards rows (`Plan Spec.md` §4·K6) — the Roster surface on the shared scale:
 * shift chips spanning whole buckets, wearing the lifecycle looks on the
 * recipe `cardChip` slot's `data-state` axis (confirmed brand tint · proposed
 * dashed · `proposed(removed)` warn strikethrough · estimated ghost).
 */

import { variant, type ValueTypeOf } from "@elaraai/east";
import { Box } from "@chakra-ui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import type { IconName, IconPrefix } from "@fortawesome/fontawesome-svg-core";
import { Plan } from "@elaraai/east-ui/internal";
import { usePlanDispatch, usePlanResolvers, usePlanScale, type PlanElementRefValue } from "../context.js";
import { runStateKey } from "./SpanRow.js";
import { ElementOverlays } from "./ElementOverlays.js";

type Styles = Record<string, Record<string, unknown>>;
type CardsKindValue = Extract<ValueTypeOf<typeof Plan.Types.Row>["kind"], { type: "cards" }>["value"];

export interface CardsRowProps {
    /** R2 context strip (#591) — render this row's marks at strip size. */
    ctx?: boolean | undefined;

    rowKey: string;
    kind: CardsKindValue;
    styles: Styles;
    storageKey: string;
}

/** The cards-row plot content — whole-bucket shift chips. */
export function CardsRow({ rowKey, kind, styles, storageKey, ctx }: CardsRowProps) {
    const ctxAttr = ctx === true ? "" : undefined;
    const scale = usePlanScale();
    const dispatch = usePlanDispatch();
    const { onElementClick } = usePlanResolvers();
    return (
        <>
            {kind.chips.map((chip) => {
                const f0 = scale.fracOf(chip.from);
                const f1 = scale.fracOf(chip.to);
                // Render-bounds cull + TRUE geometry, always (#619/#620 —
                // the SpanRow bar rule): a straddling chip's clamped box
                // translated by a brush pan was a lie that popped at the
                // settle. The window edge fades symmetrically (the §4.3
                // "never a fabricated end", applied to chips — a deliberate
                // rest change from the old hard-clamped edge) and the label
                // pins to the window edge via computed padding.
                if (f1 <= scale.renderMin || f0 >= scale.renderMax) return null;
                const width = f1 - f0;
                if (!(width > 0)) return null;
                const runoff = f1 > 1 && f0 < 1;
                const runon = f0 < 0 && f1 > 0;
                const vL = runon ? -f0 / width : 0;
                const vR = runoff ? (1 - f0) / width : 1;
                const vis = Math.max(vR - vL, 0);
                const mask = runoff || runon
                    ? `linear-gradient(to right, ${runon
                        ? `transparent ${(100 * (vL + 0.01 * vis)).toFixed(2)}%, black ${(100 * (vL + 0.16 * vis)).toFixed(2)}%`
                        : "black 0%"}, ${runoff
                        ? `black ${(100 * (vL + 0.84 * vis)).toFixed(2)}%, transparent ${(100 * (vL + 0.99 * vis)).toFixed(2)}%`
                        : "black 100%"})`
                    : undefined;
                const icon = chip.icon.type === "some" ? chip.icon.value : undefined;
                const ref = variant("chip", { row: rowKey, chip: chip.key }) as PlanElementRefValue;
                const node = (
                    <Box css={styles.cardChip}
                        data-ctx={ctxAttr}
                        data-chip={chip.key}
                        data-state={runStateKey(chip.state)}
                        data-runoff={runoff ? "" : undefined}
                        data-runon={runon ? "" : undefined}
                        style={{
                            left: `calc(${(f0 * 100).toFixed(4)}% + 2px)`,
                            width: `calc(${(width * 100).toFixed(4)}% - 4px)`,
                            ...(mask !== undefined ? { maskImage: mask, WebkitMaskImage: mask } : {}),
                            ...(runon ? { paddingLeft: `calc(${(vL * 100).toFixed(4)}% + 9px)` } : {}),
                        }}
                        onClick={(e) => {
                            e.stopPropagation();
                            dispatch({ t: "row.select", key: rowKey });
                            onElementClick?.(ref);
                        }}
                    >
                        {icon !== undefined && <FontAwesomeIcon icon={[icon.prefix as IconPrefix, icon.name as IconName]} />}
                        <Box as="span" overflow="hidden" textOverflow="ellipsis" minW={0}>{chip.label}</Box>
                    </Box>
                );
                return (
                    <ElementOverlays key={chip.key}
                        elementRef={ref} styles={styles}
                        storageKey={`${storageKey}.${chip.key}`}>
                        {node}
                    </ElementOverlays>
                );
            })}
        </>
    );
}
