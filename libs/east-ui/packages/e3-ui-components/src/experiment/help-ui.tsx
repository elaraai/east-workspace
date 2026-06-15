/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Guidance affordances for the Experiment surface — a built-in glossary
 * ({@link "./help"}) surfaced as hover cards so a domain expert can understand
 * any heading / control / result without a statistician's vocabulary.
 *
 * The model is an **explain mode**, not per-element icons: {@link GuidanceToggle}
 * (an on/off icon button in the header) flips guidance on, and then the element
 * *itself* — a heading, a value, a chart label — is the hover trigger via
 * {@link Help}. No tiny target to aim at: you mouse over the thing you're asking
 * about. When guidance is off, {@link Help} renders its children untouched. A
 * single {@link GuidanceProvider} supplies the `{treatment}`/`{outcome}` nouns +
 * the on/off state.
 */
import { createContext, useContext, type ReactNode } from 'react';
import { Box, Text, HoverCard, Portal, useRecipe, useSlotRecipe, type SystemStyleObject } from '@chakra-ui/react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faCircleInfo } from '@fortawesome/free-solid-svg-icons';
import { HELP, fillHelp, type HelpId } from './help.js';

interface GuidanceCtx { on: boolean; vars: Record<string, string> }
const GuidanceContext = createContext<GuidanceCtx>({ on: true, vars: {} });

/** Provide the guidance on/off state + the `{treatment}`/`{outcome}` nouns. */
export function GuidanceProvider({ on, vars, children }: { on: boolean; vars: Record<string, string>; children: ReactNode }) {
    return <GuidanceContext.Provider value={{ on, vars }}>{children}</GuidanceContext.Provider>;
}

/** The 3-tier card body — `term` uses the recipe's mono-eyebrow `title` slot, so
 *  it reads identically to every other east-ui HoverCard / Popover heading; the
 *  three depth tiers (gist → detail → muted jargon footnote) sit below it. The
 *  surrounding chrome (surface, border, shadow, padding, width) comes from the
 *  `hoverCard` recipe applied automatically to `HoverCard.Content`. */
function HelpCard({ id, extraVars }: { id: HelpId; extraVars?: Record<string, string> | undefined }) {
    const { vars } = useContext(GuidanceContext);
    const e = fillHelp(HELP[id], { ...vars, ...extraVars });
    const slot = useSlotRecipe({ key: 'hoverCard' })() as Record<string, SystemStyleObject>;
    return (
        <Box display="flex" flexDirection="column" gap="1.5">
            <Box css={slot.title} mb="0">{e.term}</Box>
            <Text textStyle="body.sm" color="fg.default" lineHeight="1.5">{e.gist}</Text>
            <Box css={slot.description} lineHeight="1.5">{e.detail}</Box>
            {e.jargon && (
                <Text textStyle="caption" color="fg.subtle" mt="0.5" pt="1.5" borderTopWidth="1px" borderColor="border.subtle">
                    Technically: {e.jargon}
                </Text>
            )}
        </Box>
    );
}

/** Wrap a single trigger element in a HoverCard — chrome from the shared
 *  `hoverCard` recipe (same as {@link "../../overlays/hover-card"}), so it
 *  matches every other card. The trigger is used `asChild`, so it must be one
 *  element (its own box) — the caller owns layout / cursor. */
function Hover({ id, extraVars, trigger }: { id: HelpId; extraVars?: Record<string, string> | undefined; trigger: ReactNode }) {
    return (
        <HoverCard.Root openDelay={150} closeDelay={80} size="sm" positioning={{ placement: 'top' }}>
            <HoverCard.Trigger asChild>{trigger}</HoverCard.Trigger>
            <Portal>
                <HoverCard.Positioner>
                    <HoverCard.Content>
                        <HoverCard.Arrow><HoverCard.ArrowTip /></HoverCard.Arrow>
                        <HelpCard id={id} extraVars={extraVars} />
                    </HoverCard.Content>
                </HoverCard.Positioner>
            </Portal>
        </HoverCard.Root>
    );
}

/**
 * Make an element its own help trigger — hovering the heading / value / label
 * itself opens its glossary card (no separate icon to aim at). Renders children
 * untouched when guidance is off. `display` defaults to `inline` so prose still
 * wraps; pass `inline-flex` + `gap` to keep a multi-part row laid out.
 */
export function Help({ id, extraVars, children, display = 'inline', gap }: {
    id: HelpId; extraVars?: Record<string, string> | undefined; children: ReactNode;
    display?: 'inline' | 'inline-flex'; gap?: string;
}) {
    const { on } = useContext(GuidanceContext);
    if (!on) return <>{children}</>;
    return (
        <Hover id={id} extraVars={extraVars} trigger={
            // `tabIndex={0}` makes the term keyboard-focusable — the HoverCard's zag
            // machine opens on focus, so the glossary is reachable without a pointer.
            <Box as="span" cursor="help" tabIndex={0} display={display} {...(gap ? { alignItems: 'center', gap } : {})}
                _focusVisible={{ outline: '1px dotted', outlineColor: 'brand.fg', outlineOffset: '2px', borderRadius: '2px' }}>{children}</Box>
        } />
    );
}

/** The header guidance toggle — an icon-only on/off button (no label). The filled
 *  (`subtle`) state + brand tint show guidance is active; ghost + muted is off.
 *  Hovering it always explains the feature (even when off), so it's discoverable. */
export function GuidanceToggle({ on, onToggle }: { on: boolean; onToggle: () => void }) {
    const iconButton = useRecipe({ key: 'iconButton' });
    return (
        <Hover id="guidance" trigger={
            <Box as="button" css={iconButton({ variant: on ? 'subtle' : 'ghost', size: 'sm' })}
                onClick={onToggle} aria-pressed={on} aria-label="Toggle guidance"
                color={on ? 'brand.fg' : 'fg.muted'}>
                <FontAwesomeIcon icon={faCircleInfo} />
            </Box>
        } />
    );
}
