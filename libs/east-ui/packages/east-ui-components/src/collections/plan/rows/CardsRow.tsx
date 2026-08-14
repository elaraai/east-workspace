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

import { type ValueTypeOf } from "@elaraai/east";
import { Box } from "@chakra-ui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import type { IconName, IconPrefix } from "@fortawesome/fontawesome-svg-core";
import { Plan } from "@elaraai/east-ui/internal";
import { usePlanDispatch, usePlanScale } from "../context.js";
import { runStateKey, withOverlays } from "./SpanRow.js";

type Styles = Record<string, Record<string, unknown>>;
type CardsKindValue = Extract<ValueTypeOf<typeof Plan.Types.Row>["kind"], { type: "cards" }>["value"];

export interface CardsRowProps {
    rowKey: string;
    kind: CardsKindValue;
    styles: Styles;
    storageKey: string;
}

/** The cards-row plot content — whole-bucket shift chips. */
export function CardsRow({ rowKey, kind, styles, storageKey }: CardsRowProps) {
    const scale = usePlanScale();
    const dispatch = usePlanDispatch();
    return (
        <>
            {kind.chips.map((chip) => {
                const f0 = scale.fracOf(chip.from);
                const f1 = scale.fracOf(chip.to);
                if (f1 <= 0 || f0 >= 1) return null;
                const left = Math.max(0, f0);
                const width = Math.max(0, Math.min(1, f1) - left);
                const icon = chip.icon.type === "some" ? chip.icon.value : undefined;
                const node = (
                    <Box css={styles.cardChip}
                        data-chip={chip.key}
                        data-state={runStateKey(chip.state)}
                        left={`calc(${left * 100}% + 2px)`}
                        width={`calc(${width * 100}% - 4px)`}
                        onClick={(e) => { e.stopPropagation(); dispatch({ t: "row.select", key: rowKey }); }}
                    >
                        {icon !== undefined && <FontAwesomeIcon icon={[icon.prefix as IconPrefix, icon.name as IconName]} />}
                        <Box as="span" overflow="hidden" textOverflow="ellipsis" minW={0}>{chip.label}</Box>
                    </Box>
                );
                return (
                    <Box as="span" key={chip.key} display="contents">
                        {withOverlays(node, chip.popover, undefined, `${storageKey}.${chip.key}`)}
                    </Box>
                );
            })}
        </>
    );
}
