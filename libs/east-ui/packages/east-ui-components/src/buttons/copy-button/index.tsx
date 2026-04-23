/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { memo, useMemo } from "react";
import { Clipboard, Button, IconButton, Box, type ButtonProps, type IconButtonProps } from "@chakra-ui/react";
import { equalFor, type ValueTypeOf } from "@elaraai/east";
import { CopyButton } from "@elaraai/east-ui";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faCopy, faCheck } from "@fortawesome/free-solid-svg-icons";
import { getSomeorUndefined } from "../../utils";

const copyButtonEqual = equalFor(CopyButton.Types.CopyButton);

/** East CopyButton value type. */
export type CopyButtonValue = ValueTypeOf<typeof CopyButton.Types.CopyButton>;

/**
 * Props for `EastChakraCopyButton`. Accepts any extra Chakra `<Button>` /
 * `<IconButton>` props so containers like `<ButtonGroup>` can forward
 * attributes injected via `cloneElement` (`data-first` / `data-last` /
 * `data-between` / `data-group-item` + inline `style` vars).
 */
export type EastChakraCopyButtonProps = {
    value: CopyButtonValue;
} & Omit<ButtonProps & IconButtonProps, "onClick" | "children" | "aria-label" | "value">;

/**
 * Renders an East UI CopyButton using Chakra v3 `Clipboard.Root`.
 *
 * @remarks
 * Per the Type-shape convention: `disabled` and `timeout` are read from the
 * main struct (not the old nested `style` location). `style.successColor`
 * tints the "Copied!" checkmark indicator when present.
 */
export const EastChakraCopyButton = memo(function EastChakraCopyButton({ value, ...rest }: EastChakraCopyButtonProps) {
    const style = useMemo(() => getSomeorUndefined(value.style), [value.style]);
    const label = useMemo(() => getSomeorUndefined(value.label), [value.label]);
    const disabled = useMemo(() => getSomeorUndefined(value.disabled), [value.disabled]);
    const successColor = useMemo(
        () => (style ? getSomeorUndefined(style.successColor) : undefined),
        [style],
    );

    const buttonProps = useMemo(() => {
        const hover = style ? getSomeorUndefined(style.hoverBackground) : undefined;
        const props: Record<string, unknown> = {};
        if (style) {
            const v = getSomeorUndefined(style.variant)?.type;
            const cp = getSomeorUndefined(style.colorPalette)?.type;
            const sz = getSomeorUndefined(style.size)?.type;
            const c = getSomeorUndefined(style.color);
            const bg = getSomeorUndefined(style.background);
            const bc = getSomeorUndefined(style.borderColor);
            if (v !== undefined) props.variant = v;
            if (cp !== undefined) props.colorPalette = cp;
            if (sz !== undefined) props.size = sz;
            if (c !== undefined) props.color = c;
            if (bg !== undefined) props.bg = bg;
            if (bc !== undefined) props.borderColor = bc;
        }
        if (disabled !== undefined) props.disabled = disabled;
        if (hover !== undefined) props._hover = { bg: hover };
        return props as ButtonProps & IconButtonProps;
    }, [style, disabled]);

    const timeout = useMemo(() => {
        const t = getSomeorUndefined(value.timeout);
        return t !== undefined ? parseInt(t, 10) : 2000;
    }, [value.timeout]);

    const copiedGlyph = (
        <Box as="span" color={successColor}>
            <FontAwesomeIcon icon={faCheck} />
        </Box>
    );

    return (
        <Clipboard.Root value={value.value} timeout={timeout}>
            <Clipboard.Trigger asChild>
                {label !== undefined ? (
                    <Button {...rest} {...buttonProps}>
                        <Clipboard.Indicator copied={copiedGlyph}>
                            <FontAwesomeIcon icon={faCopy} />
                        </Clipboard.Indicator>
                        {label}
                    </Button>
                ) : (
                    <IconButton {...rest} {...buttonProps} aria-label="Copy to clipboard">
                        <Clipboard.Indicator copied={copiedGlyph}>
                            <FontAwesomeIcon icon={faCopy} />
                        </Clipboard.Indicator>
                    </IconButton>
                )}
            </Clipboard.Trigger>
        </Clipboard.Root>
    );
}, (prev, next) => copyButtonEqual(prev.value, next.value));
