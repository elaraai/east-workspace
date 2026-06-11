/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { memo, useMemo } from "react";
import { Group as ChakraGroup, type GroupProps } from "@chakra-ui/react";
import { equalFor, type ValueTypeOf } from "@elaraai/east";
import { ButtonGroup } from "@elaraai/east-ui/internal";
import { getSomeorUndefined } from "../../utils";
import { EastChakraComponent } from "../../component";
import { EastChakraButton } from "../button";
import { EastChakraIconButton } from "../icon-button";
import { EastChakraCopyButton } from "../copy-button";
import { EastChakraCloseButton } from "../close-button";
import { EastChakraToggle } from "../toggle";

const buttonGroupEqual = equalFor(ButtonGroup.Types.ButtonGroup);

export type ButtonGroupValue = ValueTypeOf<typeof ButtonGroup.Types.ButtonGroup>;

export interface EastChakraButtonGroupProps {
    value: ButtonGroupValue;
    storageKey?: string;
}

/**
 * Renders an East UI ButtonGroup using Chakra v3's `<Group>`.
 *
 * @remarks
 * Chakra v3's `<Group>` adds `data-first` / `data-last` / `data-between`
 * attributes to its **direct children** via `cloneElement`, then applies
 * `border-radius: 0` + negative margins to those attrs when `attached` is
 * true. Going through the top-level `EastChakraComponent` dispatcher wraps
 * each child in a Fragment — `cloneElement` then adds the data-attrs to
 * that Fragment wrapper instead of the underlying `<button>` DOM element,
 * so the attached CSS never fires.
 *
 * To fix this, ButtonGroup dispatches known button-like children
 * (`Button` / `IconButton` / `CopyButton` / `CloseButton` / `Toggle`)
 * directly to their renderers so the DOM `<button>` is the direct child
 * of `<Group>`. Unknown children fall back to the general dispatcher.
 */
export const EastChakraButtonGroup = memo(function EastChakraButtonGroup({ value, storageKey }: EastChakraButtonGroupProps) {
    const style = useMemo(() => getSomeorUndefined(value.style), [value.style]);

    const groupProps = useMemo(() => {
        const out: Record<string, unknown> = {};
        if (!style) return out as GroupProps;
        const attached = getSomeorUndefined(style.attached);
        const gap = getSomeorUndefined(style.gap);
        const borderColor = getSomeorUndefined(style.borderColor);
        if (attached !== undefined) out.attached = attached;
        if (gap !== undefined) out.gap = gap;
        if (borderColor !== undefined) out.borderColor = borderColor;
        return out as GroupProps;
    }, [style]);

    return (
        <ChakraGroup {...groupProps}>
            {value.buttons.map((btn, i) => {
                const childKey = `${storageKey ?? ""}.buttons.${i}`;
                // Dispatch button-like children directly (bypassing the general
                // EastChakraComponent wrapper) so the rendered <button> is the
                // direct child of <Group> — otherwise Chakra's cloneElement lands
                // `data-first` / `data-last` / `data-between` on our Fragment
                // wrapper and the `attached` CSS never reaches the DOM button.
                // Using `btn.type` (the variant discriminator) sidesteps the
                // `match` exhaustiveness trap for the 60+-tag UIComponentType.
                switch (btn.type) {
                    case "Button":
                        return <EastChakraButton key={i} value={btn.value} storageKey={childKey} />;
                    case "IconButton":
                        return <EastChakraIconButton key={i} value={btn.value} />;
                    case "CopyButton":
                        return <EastChakraCopyButton key={i} value={btn.value} />;
                    case "CloseButton":
                        return <EastChakraCloseButton key={i} value={btn.value} />;
                    case "Toggle":
                        return <EastChakraToggle key={i} value={btn.value} storageKey={childKey} />;
                    default:
                        // Non-button children go through the general dispatcher — they won't
                        // receive `data-first` / `data-last` / `data-between` via `cloneElement`
                        // (Fragment wrapping swallows them), so `attached` styling will not apply
                        // to them. ButtonGroup is intended for button-like children only.
                        return <EastChakraComponent key={i} value={btn} storageKey={childKey} />;
                }
            })}
        </ChakraGroup>
    );
}, (prev, next) => buttonGroupEqual(prev.value, next.value) && prev.storageKey === next.storageKey);
