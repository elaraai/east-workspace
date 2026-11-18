/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Configure tab's small controls (#1672), as the spec draws them: a
 * segment group — a visual's view, its kind, an option, a value's period —
 * filling its row: 24px of names (an icon before one that has it) while it has
 * three segments or fewer, else 32px of icons, each named by its tooltip; a
 * switch for a yes or no; and the tooltip an icon-only button carries (NFR-1),
 * as the builder's history bar's.
 *
 * A group is the `studioInspector` recipe's `seg` — the design system's
 * segment group, which the spec's editor draws; the switch is the shared
 * `Switch`, labelled by the field it is drawn in.
 *
 * @packageDocumentation
 */

import { useMemo, type ReactElement, type ReactNode } from "react";
import { Portal, Tooltip, chakra, useSlotRecipe, type SystemStyleObject } from "@chakra-ui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import type { IconName } from "@fortawesome/fontawesome-svg-core";
import { BooleanType, StringType, defaultValue, equalFor, isValueOf, isVariant, some, variant } from "@elaraai/east";
import { Switch, type FieldSpecValue } from "@elaraai/east-ui/internal";
import { EastChakraSwitch, type SwitchValue } from "@elaraai/east-ui-components";

type Styles = Record<string, SystemStyleObject>;

const stringEqual = equalFor(StringType);
/** A switch with nothing set: East's default for the shared Switch. */
const SWITCH: SwitchValue = defaultValue(Switch.Types.Switch);

/**
 * A tooltip naming what it wraps — an icon-only button.
 *
 * @param props - What it says, and the button
 * @returns The button, with its tooltip
 */
export function Tip({ tip, children }: { tip: string; children: ReactElement }) {
    return (
        <Tooltip.Root openDelay={250}>
            <Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
            <Portal><Tooltip.Positioner><Tooltip.Content>{tip}</Tooltip.Content></Tooltip.Positioner></Portal>
        </Tooltip.Root>
    );
}

/**
 * One segment of a strip.
 *
 * @property key - What it stands for
 * @property label - Its name: its words, or its icon's tooltip and accessible name
 * @property icon - A Font Awesome solid icon name, drawn in its words' place where the strip has more than three segments
 * @property disabled - Whether it cannot be chosen
 */
export interface SegOption {
    readonly key: string;
    readonly label: string;
    readonly icon?: string | undefined;
    readonly disabled?: boolean | undefined;
}

/** Props of {@link SegStrip}. */
export interface SegStripProps {
    /** The strip's name, for the keyboard. */
    label: string;
    /** What it is called in the page (`data-seg-strip`). */
    name: string;
    /** Its segments, in order. */
    options: readonly SegOption[];
    /** The chosen segment's key; `undefined` for none. */
    current: string | undefined;
    /** Told the key of a segment chosen — never the chosen one's. */
    onPick: (key: string) => void;
    /** As wide as its names, not its row: a group inside a pill. */
    fit?: boolean | undefined;
}

/**
 * A segment group: one choice of a few, the chosen one pressed. While it has
 * three segments or fewer each says its name, after its icon where it has
 * one, in a group 24px tall; past three, where each has an icon, each draws
 * its icon in a group 32px tall, named by its tooltip and for the keyboard.
 *
 * @param props - Its name, its segments, the chosen one, and what a choice does
 * @returns The group
 */
export function SegStrip({ label, name, options, current, onPick, fit }: SegStripProps) {
    const styles = useSlotRecipe({ key: "studioInspector" })() as Styles;
    const iconic = options.length > 3 && options.every((option) => option.icon !== undefined);
    return (
        <chakra.div css={styles.seg} role="group" aria-label={label} data-seg-strip={name} data-size={iconic ? "md" : "sm"} data-fit={fit === true ? "" : undefined}>
            {options.map((option) => {
                const on = current !== undefined && stringEqual(option.key, current);
                const button = (
                    <chakra.button key={option.key} type="button" css={styles.segItem} data-state={on ? "on" : "off"} aria-pressed={on}
                        aria-label={iconic ? option.label : undefined} disabled={option.disabled === true} data-seg={option.key}
                        onClick={() => { if (!on) onPick(option.key); }}>
                        {option.icon !== undefined && <FontAwesomeIcon icon={["fas", option.icon as IconName]} />}
                        {!iconic && <span>{option.label}</span>}
                    </chakra.button>
                );
                return iconic ? <Tip key={option.key} tip={option.label}>{button}</Tip> : button;
            })}
        </chakra.div>
    );
}

/**
 * A yes or no, as a switch: one edit as it is flipped. Drawn in a form's
 * field, it is labelled by the field.
 *
 * @param props - Whether it is on, and what a flip does
 * @returns The switch
 */
export function YesNo({ checked, onChange }: { checked: boolean; onChange: (next: boolean) => void }) {
    const value = useMemo((): SwitchValue => ({
        ...SWITCH,
        checked,
        onChange: some((next: boolean) => { onChange(next); return null; }),
    }), [checked, onChange]);
    return <EastChakraSwitch value={value} />;
}

/**
 * How a form over a struct draws its fields as the spec's Configure tab does
 * (FieldForm's `renderControl`): a choice of three cases or fewer that hold
 * nothing as a segment group — and one of more where its names are short, a
 * date's buckets — and a yes or no as a switch; any other field as the form
 * draws it, a longer choice as its select. An Option's choice is set to some
 * case — the form wraps it.
 *
 * @param struct - The struct the form edits, as it stands
 * @param short - The fields of more than three cases whose names are short enough for segments
 * @returns The form's `renderControl`
 */
export function segControls(struct: Readonly<Record<string, unknown>>, short: readonly string[] = []) {
    return (spec: FieldSpecValue, change: (value: unknown) => void): ReactNode | undefined => {
        const field = spec.path[0];
        if (field === undefined || spec.path.length !== 1) return undefined;
        const at = struct[field];
        const held = spec.optional ? (isVariant(at) && stringEqual(at.type, "some") ? at.value : undefined) : at;
        if (spec.editor.type === "select") {
            if (spec.editor.value.length > 3 && !short.some((name) => stringEqual(name, field))) return undefined;
            return (
                <SegStrip label={spec.label} name={field} options={spec.editor.value.map((option) => ({ key: option.case, label: option.label }))}
                    current={isVariant(held) ? held.type : undefined} onPick={(key) => change(variant(key, null))} />
            );
        }
        if (spec.editor.type === "checkbox") return <YesNo checked={isValueOf(held, BooleanType) && held} onChange={change} />;
        return undefined;
    };
}
