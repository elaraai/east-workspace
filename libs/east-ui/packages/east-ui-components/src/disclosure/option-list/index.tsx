/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Box as ChakraBox, useSlotRecipe } from "@chakra-ui/react";
import { equalFor, type ValueTypeOf } from "@elaraai/east";
import { OptionList } from "@elaraai/east-ui";
import { getSomeorUndefined } from "../../utils";
import { EastChakraComponent } from "../../component";

const optionListEqual = equalFor(OptionList.Types.OptionList);

export type OptionListValue = ValueTypeOf<typeof OptionList.Types.OptionList>;

export interface EastChakraOptionListProps {
    value: OptionListValue;
    storageKey?: string;
}

/**
 * Renders an East UI OptionList — a keyboard-navigable list of pressable rows.
 *
 * @remarks
 * Uses `role="listbox"` + per-row `role="option"` + `aria-selected`. Arrow
 * keys move focus; Enter / Space selects (firing `onSelect` with the row's
 * id). Each option's `label` / `description` / `trailing` are UIComp
 * dispatched through `EastChakraComponent`.
 */
export const EastChakraOptionList = memo(function EastChakraOptionList({ value, storageKey }: EastChakraOptionListProps) {
    /* Consume the `optionList` slot recipe — root / item / itemText /
     * itemDescription styles flow from `theme/slot-recipes/optionList.ts`.
     * Renderer-side inline-style overrides via `value.style` are layered
     * on top via the `*Override` props below. */
    const recipe = useSlotRecipe({ key: "optionList" });
    const styles = recipe({});

    const style = useMemo(() => getSomeorUndefined(value.style), [value.style]);
    const onSelectFn = useMemo(() => getSomeorUndefined(value.onSelect), [value.onSelect]);

    // Local state — selection updates immediately even when no onSelect is bound.
    const initialSelected = getSomeorUndefined(value.selectedId);
    const [selectedId, setSelectedId] = useState<string | undefined>(initialSelected);
    useEffect(() => {
        setSelectedId(getSomeorUndefined(value.selectedId));
    }, [value.selectedId]);

    const listRef = useRef<HTMLDivElement>(null);

    const itemColor = style ? getSomeorUndefined(style.itemColor) : undefined;
    const itemHoverBg = style ? getSomeorUndefined(style.itemHoverBackground) : undefined;
    const selectedBg = style ? getSomeorUndefined(style.selectedBackground) : undefined;
    const borderColor = style ? getSomeorUndefined(style.borderColor) : undefined;

    // Precompute per-row static data (independent of selection) at root level.
    const rows = useMemo(() => value.options.map((opt) => ({
        id: opt.id,
        label: opt.label,
        description: getSomeorUndefined(opt.description),
        trailing: getSomeorUndefined(opt.trailing),
        disabled: getSomeorUndefined(opt.disabled) ?? false,
    })), [value.options]);

    const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
        if (e.key !== "ArrowDown" && e.key !== "ArrowUp" && e.key !== "Home" && e.key !== "End") return;
        e.preventDefault();
        const rowEls = Array.from(listRef.current?.querySelectorAll<HTMLDivElement>('[role="option"]:not([aria-disabled="true"])') ?? []);
        if (rowEls.length === 0) return;
        const current = document.activeElement as HTMLDivElement | null;
        const currentIndex = current ? rowEls.indexOf(current) : -1;
        let nextIndex = 0;
        switch (e.key) {
            case "ArrowDown":
                nextIndex = currentIndex < 0 ? 0 : (currentIndex + 1) % rowEls.length;
                break;
            case "ArrowUp":
                nextIndex = currentIndex <= 0 ? rowEls.length - 1 : currentIndex - 1;
                break;
            case "Home":
                nextIndex = 0;
                break;
            case "End":
                nextIndex = rowEls.length - 1;
                break;
        }
        rowEls[nextIndex]?.focus();
    }, []);

    const handleSelect = useCallback((id: string, disabled: boolean) => {
        if (disabled) return;
        setSelectedId(id);
        if (onSelectFn) queueMicrotask(() => onSelectFn(id));
    }, [onSelectFn]);

    return (
        <ChakraBox
            ref={listRef}
            role="listbox"
            css={styles.root}
            onKeyDown={handleKeyDown}
            {...(borderColor !== undefined ? { borderColor } : {})}
        >
            {rows.map((row, index) => {
                const isSelected = selectedId === row.id;
                const onClick = () => handleSelect(row.id, row.disabled);
                const onRowKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
                    if (row.disabled) return;
                    if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        handleSelect(row.id, row.disabled);
                    }
                };

                return (
                    <ChakraBox
                        key={row.id}
                        role="option"
                        tabIndex={row.disabled ? -1 : 0}
                        aria-selected={isSelected}
                        aria-disabled={row.disabled}
                        data-selected={isSelected ? "" : undefined}
                        onClick={onClick}
                        onKeyDown={onRowKey}
                        css={styles.item}
                        {...(itemColor !== undefined ? { color: itemColor } : {})}
                        {...(itemHoverBg !== undefined ? { _hover: { bg: itemHoverBg } } : {})}
                        {...(selectedBg !== undefined ? { _selected: { bg: selectedBg } } : {})}
                        _focusVisible={{ outline: "2px solid", outlineColor: "border.brand", outlineOffset: "-2px" }}
                    >
                        <ChakraBox flex="1" minWidth="0">
                            <ChakraBox css={styles.itemText}>
                                <EastChakraComponent
                                    value={row.label}
                                    storageKey={`${storageKey ?? ""}.options.${index}.label`}
                                />
                            </ChakraBox>
                            {row.description ? (
                                <ChakraBox css={styles.itemDescription}>
                                    <EastChakraComponent
                                        value={row.description}
                                        storageKey={`${storageKey ?? ""}.options.${index}.description`}
                                    />
                                </ChakraBox>
                            ) : null}
                        </ChakraBox>
                        {row.trailing ? (
                            <ChakraBox css={styles.itemIndicator}>
                                <EastChakraComponent
                                    value={row.trailing}
                                    storageKey={`${storageKey ?? ""}.options.${index}.trailing`}
                                />
                            </ChakraBox>
                        ) : null}
                    </ChakraBox>
                );
            })}
        </ChakraBox>
    );
}, (prev, next) => optionListEqual(prev.value, next.value) && prev.storageKey === next.storageKey);
