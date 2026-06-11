/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { Fragment, memo, useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type KeyboardEvent } from "react";
import { Box, Button, Dialog as ChakraDialog, Kbd, Portal, Text, chakra, useSlotRecipe } from "@chakra-ui/react";
import { equalFor, type ValueTypeOf } from "@elaraai/east";
import { CommandPalette } from "@elaraai/east-ui/internal";
import { getSomeorUndefined } from "../../utils";

const commandPaletteEqual = equalFor(CommandPalette.Types.CommandPalette);

export type CommandPaletteValue = ValueTypeOf<typeof CommandPalette.Types.CommandPalette>;

export interface EastChakraCommandPaletteProps {
    value: CommandPaletteValue;
}

interface ResolvedCommand {
    id: string;
    label: string;
    shortcut: string | undefined;
    group: string | undefined;
    keywords: string[];
    action: () => void;
}

/** Naive substring + keyword filter — sufficient for v0 (cmdk integration is a future upgrade). */
function filterCommands(commands: ResolvedCommand[], query: string): ResolvedCommand[] {
    if (!query.trim()) return commands;
    const q = query.toLowerCase();
    return commands.filter(c =>
        c.label.toLowerCase().includes(q) ||
        c.keywords.some(kw => kw.toLowerCase().includes(q))
    );
}

/**
 * Renders an East UI CommandPalette as a Chakra Dialog with an
 * input + filtered command list. Default trigger is `mod+k`; clicking
 * a command runs its action and closes the palette.
 */
export const EastChakraCommandPalette = memo(function EastChakraCommandPalette({ value }: EastChakraCommandPaletteProps) {
    const placeholder = getSomeorUndefined(value.placeholder) ?? "Type a command…";
    const triggerKey = getSomeorUndefined(value.triggerKey) ?? "mod+k";
    const onOpenChangeFn = useMemo(() => getSomeorUndefined(value.onOpenChange), [value.onOpenChange]);
    const controlledOpen = getSomeorUndefined(value.open);

    const style = getSomeorUndefined(value.style);
    const background = style ? getSomeorUndefined(style.background) : undefined;
    const borderColor = style ? getSomeorUndefined(style.borderColor) : undefined;
    const inputBackground = style ? getSomeorUndefined(style.inputBackground) : undefined;
    const inputColor = style ? getSomeorUndefined(style.inputColor) : undefined;
    const itemColor = style ? getSomeorUndefined(style.itemColor) : undefined;
    const selectedBackground = style ? getSomeorUndefined(style.selectedBackground) : undefined;
    const selectedColor = style ? getSomeorUndefined(style.selectedColor) : undefined;
    const groupLabelColor = style ? getSomeorUndefined(style.groupLabelColor) : undefined;

    const resolved: ResolvedCommand[] = useMemo(() => value.commands.map((c) => ({
        id: c.id,
        label: c.label,
        shortcut: getSomeorUndefined(c.shortcut),
        group: getSomeorUndefined(c.group),
        keywords: getSomeorUndefined(c.keywords) ?? [],
        action: c.action,
    })), [value.commands]);

    const [localOpen, setLocalOpen] = useState<boolean>(controlledOpen ?? false);
    useEffect(() => { if (controlledOpen !== undefined) setLocalOpen(controlledOpen); }, [controlledOpen]);

    const [query, setQuery] = useState("");
    const [highlighted, setHighlighted] = useState(0);
    const inputRef = useRef<HTMLInputElement>(null);

    const filtered = useMemo(() => filterCommands(resolved, query), [resolved, query]);

    // Group filtered commands; preserve insertion order.
    const groups = useMemo(() => {
        const out = new Map<string, ResolvedCommand[]>();
        for (const c of filtered) {
            const key = c.group ?? "";
            if (!out.has(key)) out.set(key, []);
            out.get(key)!.push(c);
        }
        return out;
    }, [filtered]);

    const setOpen = useCallback((next: boolean) => {
        setLocalOpen(next);
        if (next) { setQuery(""); setHighlighted(0); }
        if (onOpenChangeFn) queueMicrotask(() => onOpenChangeFn(next));
    }, [onOpenChangeFn]);

    // Focus the input when open.
    useEffect(() => {
        if (localOpen) {
            queueMicrotask(() => inputRef.current?.focus());
        }
    }, [localOpen]);

    const runHighlighted = useCallback(() => {
        const cmd = filtered[highlighted];
        if (!cmd) return;
        setOpen(false);
        queueMicrotask(() => cmd.action());
    }, [filtered, highlighted, setOpen]);

    const handleInputChange = (e: ChangeEvent<HTMLInputElement>) => {
        setQuery(e.target.value);
        setHighlighted(0);
    };

    const handleKey = (e: KeyboardEvent<HTMLInputElement>) => {
        if (e.key === "ArrowDown") {
            e.preventDefault();
            setHighlighted(i => Math.min(i + 1, filtered.length - 1));
        } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setHighlighted(i => Math.max(i - 1, 0));
        } else if (e.key === "Enter") {
            e.preventDefault();
            runHighlighted();
        }
    };

    let renderIndex = 0;

    const paletteStyles = useSlotRecipe({ key: "commandPalette" })();

    // Render a visible trigger button so the palette is discoverable in
    // isolation (showcase / standalone demos) — clicking it opens the
    // dialog. The global hotkey listener still works for keyboard users.
    const triggerLabel = `Open command palette`;
    const chordParts = triggerKey.toLowerCase().split("+").map(p => p.trim());

    return (
        <Fragment>
            <Button
                variant="outline"
                size="sm"
                onClick={() => setOpen(true)}
                aria-haspopup="dialog"
                aria-expanded={localOpen}
            >
                <Text>{triggerLabel}</Text>
                <Box as="span" ml="2" display="inline-flex" gap="1">
                    {chordParts.map((p) => (
                        <Kbd key={p} fontSize="xs">{p === "mod" ? "⌘" : p}</Kbd>
                    ))}
                </Box>
            </Button>
        <ChakraDialog.Root
            open={localOpen}
            onOpenChange={(d) => setOpen(d.open)}
            size="md"
            placement="center"
        >
            <Portal>
                <ChakraDialog.Backdrop css={paletteStyles.backdrop} />
                <ChakraDialog.Positioner>
                    <ChakraDialog.Content css={paletteStyles.content} bg={background} borderColor={borderColor} aria-label="Command palette">
                        <chakra.input
                            ref={inputRef}
                            css={paletteStyles.input}
                            placeholder={placeholder}
                            value={query}
                            onChange={handleInputChange}
                            onKeyDown={handleKey}
                            bg={inputBackground}
                            color={inputColor}
                        />
                        <Box css={paletteStyles.list}>
                            {filtered.length === 0 ? (
                                <Box css={paletteStyles.empty}>
                                    No commands found
                                </Box>
                            ) : (
                                Array.from(groups.entries()).map(([groupName, items]) => (
                                    <Box key={groupName || "_default"}>
                                        {groupName && (
                                            <Text css={paletteStyles.groupLabel} color={groupLabelColor}>
                                                {groupName}
                                            </Text>
                                        )}
                                        {items.map((cmd) => {
                                            const idx = renderIndex++;
                                            const isHighlighted = idx === highlighted;
                                            return (
                                                <Box
                                                    key={cmd.id}
                                                    css={paletteStyles.item}
                                                    onMouseEnter={() => setHighlighted(idx)}
                                                    onClick={runHighlighted}
                                                    {...(isHighlighted ? { "data-highlighted": "" } : {})}
                                                    bg={isHighlighted ? selectedBackground : undefined}
                                                    color={isHighlighted ? (selectedColor ?? itemColor) : itemColor}
                                                >
                                                    <Text css={paletteStyles.itemText}>{cmd.label}</Text>
                                                    {cmd.shortcut && (
                                                        <Text css={paletteStyles.itemKbd}>
                                                            {cmd.shortcut}
                                                        </Text>
                                                    )}
                                                </Box>
                                            );
                                        })}
                                    </Box>
                                ))
                            )}
                        </Box>
                    </ChakraDialog.Content>
                </ChakraDialog.Positioner>
            </Portal>
        </ChakraDialog.Root>
        </Fragment>
    );
}, (prev, next) => commandPaletteEqual(prev.value, next.value));
