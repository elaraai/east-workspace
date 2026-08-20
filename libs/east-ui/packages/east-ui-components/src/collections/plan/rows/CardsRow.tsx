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
                // Render-bounds cull (#619): a chip wholly in the overscan
                // mounts at its true geometry (clipped at rest, revealed by a
                // brush pan); one touching the window keeps its clamped form
                // so the at-rest render is unchanged.
                if (f1 <= scale.renderMin || f0 >= scale.renderMax) return null;
                const outside = f1 <= 0 || f0 >= 1;
                const left = outside ? f0 : Math.max(0, f0);
                const width = Math.max(0, (outside ? f1 : Math.min(1, f1)) - left);
                const icon = chip.icon.type === "some" ? chip.icon.value : undefined;
                const ref = variant("chip", { row: rowKey, chip: chip.key }) as PlanElementRefValue;
                const node = (
                    <Box css={styles.cardChip}
                        data-ctx={ctxAttr}
                        data-chip={chip.key}
                        data-state={runStateKey(chip.state)}
                        left={`calc(${left * 100}% + 2px)`}
                        width={`calc(${width * 100}% - 4px)`}
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
