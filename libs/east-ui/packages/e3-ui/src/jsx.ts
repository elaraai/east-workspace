/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * east-ui JSX components — capitalized, React-style tags that wrap the east-ui
 * component factories so you can author with `<Box>…</Box>` JSX (in a `.tsx`
 * file) instead of `Box.Root([…], {…})`.
 *
 * Each tag takes a single props object: style props sit at the **top level**
 * (flat, like React — `<Box padding="4">`, `<Button variant="solid">`), and
 * nested elements arrive as `children`. Every tag returns an `ExprType<
 * UIComponentType>` — the exact same value the factory returns — so JSX is
 * pure authoring sugar over East IR.
 *
 * Wrap any other east-ui factory yourself with {@link container} (children +
 * style) or {@link textLeaf} (text content + style).
 *
 * @packageDocumentation
 */

import type { SubtypeExprOrValue, StringType } from '@elaraai/east';
import {
    Box as BoxFactory,
    Stack as StackFactory,
    Text as TextFactory,
    Heading as HeadingFactory,
    Button as ButtonFactory,
    type ButtonOptions,
} from '@elaraai/east-ui';
import type { UIElement } from './jsx-runtime.js';

// ============================================================================
// Child types
// ============================================================================

/** A child of a container tag: an element, a conditional, or nested arrays. */
export type ElementChild = UIElement | boolean | null | undefined | ElementChild[];

/** A child of a text tag: a string/number literal or a string expression. */
export type TextChild =
    | string
    | number
    | SubtypeExprOrValue<StringType>
    | null
    | undefined
    | TextChild[];

// ============================================================================
// Internal helpers
// ============================================================================

function hasKeys(o: Record<string, unknown>): boolean {
    for (const _ in o) return true;
    return false;
}

/** Flatten JSX children into a plain array of elements, dropping nullish/boolean. */
function flattenElements(child: ElementChild | undefined): UIElement[] {
    const out: UIElement[] = [];
    const walk = (c: ElementChild | undefined): void => {
        if (c === null || c === undefined || typeof c === 'boolean') return;
        if (Array.isArray(c)) {
            for (const x of c) walk(x);
            return;
        }
        out.push(c);
    };
    walk(child);
    return out;
}

/** Collapse text children into a single string value for a leaf factory. */
function joinText(child: TextChild): SubtypeExprOrValue<StringType> {
    const parts: unknown[] = [];
    const walk = (c: TextChild): void => {
        if (c === null || c === undefined) return;
        if (Array.isArray(c)) {
            for (const x of c) walk(x);
            return;
        }
        parts.push(c);
    };
    walk(child);
    if (parts.length === 0) return '';
    if (parts.length === 1) return parts[0] as SubtypeExprOrValue<StringType>;
    if (parts.every((p) => typeof p === 'string' || typeof p === 'number')) {
        return parts.join('');
    }
    throw new Error(
        'east-ui JSX: text content mixes literals with an expression. ' +
            'Build the string with East.str`…` and pass it as a single child.',
    );
}

// ============================================================================
// Combinators — turn an east-ui factory into a JSX tag
// ============================================================================

/**
 * Build a JSX tag for a container factory (one whose signature is
 * `(children, style?)`). Style props are top-level; `children` are flattened.
 *
 * @example
 * ```tsx
 * import { Flex } from '@elaraai/east-ui';
 * export const FlexTag = container(Flex.Root);
 * // <FlexTag gap="2"><Text>hi</Text></FlexTag>
 * ```
 */
export function container<S>(
    factory: (children: never, style?: S) => UIElement,
) {
    return (props: S & { children?: ElementChild }): UIElement => {
        const { children, ...style } = props as { children?: ElementChild } & Record<string, unknown>;
        return factory(
            flattenElements(children) as never,
            (hasKeys(style) ? style : undefined) as S,
        );
    };
}

/**
 * Build a JSX tag for a text-leaf factory (one whose signature is
 * `(value, style?)`). Text children become the value; style props are
 * top-level.
 *
 * @example
 * ```tsx
 * import { Code } from '@elaraai/east-ui';
 * export const CodeTag = textLeaf(Code.Root);
 * // <CodeTag>const x = 1</CodeTag>
 * ```
 */
export function textLeaf<S>(
    factory: (value: never, style?: S) => UIElement,
) {
    return (props: S & { children?: TextChild }): UIElement => {
        const { children, ...style } = props as { children?: TextChild } & Record<string, unknown>;
        return factory(
            joinText(children) as never,
            (hasKeys(style) ? style : undefined) as S,
        );
    };
}

// ============================================================================
// Components
// ============================================================================

/** A JSX tag: a function from props to a built east-ui element. */
export type Tag<P> = (props: P) => UIElement;

/** Props for a container tag wrapping `F`: its style props (flat) + children. */
export type ContainerProps<F extends (...a: never[]) => UIElement> =
    NonNullable<Parameters<F>[1]> & { children?: ElementChild };

/** Props for a text tag wrapping `F`: its style props (flat) + text children. */
export type TextProps<F extends (...a: never[]) => UIElement> =
    NonNullable<Parameters<F>[1]> & { children?: TextChild };

// Explicit annotations (rather than inferred) so the emitted `.d.ts` names the
// style types via the public `@elaraai/east-ui` factories instead of their
// non-portable internal `types.js` paths.

/** `<Box>` — flexible layout container. Maps to `Box.Root`. */
export const Box: Tag<ContainerProps<typeof BoxFactory.Root>> = container(BoxFactory.Root);

/** `<Stack>` — flex stack (set `direction`). Maps to `Stack.Root`. */
export const Stack: Tag<ContainerProps<typeof StackFactory.Root>> = container(StackFactory.Root);

/** `<VStack>` — vertical stack. Maps to `Stack.VStack`. */
export const VStack: Tag<ContainerProps<typeof StackFactory.VStack>> = container(StackFactory.VStack);

/** `<HStack>` — horizontal stack. Maps to `Stack.HStack`. */
export const HStack: Tag<ContainerProps<typeof StackFactory.HStack>> = container(StackFactory.HStack);

/** `<Text>` — body text. Maps to `Text.Root`. */
export const Text: Tag<TextProps<typeof TextFactory.Root>> = textLeaf(TextFactory.Root);

/** `<Heading>` — heading text. Maps to `Heading.Root`. */
export const Heading: Tag<TextProps<typeof HeadingFactory.Root>> = textLeaf(HeadingFactory.Root);

// Button is the one tag whose factory nests visual style under `options.style`,
// so flat JSX props are split: the keys below stay top-level, the rest fold
// into `style` (so `<Button onClick={fn} variant="solid" size="md">` works).
const BUTTON_TOP_LEVEL: ReadonlySet<string> = new Set([
    'startIcon',
    'endIcon',
    'loadingText',
    'loadingIcon',
    'loading',
    'disabled',
    'onClick',
]);

/** Visual-style props accepted flat on `<Button>` (the nested `style` bag). */
export type ButtonStyleProps = NonNullable<ButtonOptions['style']>;

/** Props for the `<Button>` tag: flat style + top-level options + text child. */
export type ButtonProps = ButtonStyleProps & Omit<ButtonOptions, 'style'> & { children?: TextChild };

/** `<Button>` — action button with flat style props. Maps to {@link ButtonFactory.Root}. */
export function Button(props: ButtonProps): UIElement {
    const { children, ...rest } = props as { children?: TextChild } & Record<string, unknown>;
    const options: Record<string, unknown> = {};
    const style: Record<string, unknown> = {};
    for (const key of Object.keys(rest)) {
        if (BUTTON_TOP_LEVEL.has(key)) options[key] = rest[key];
        else style[key] = rest[key];
    }
    if (hasKeys(style)) options.style = style;
    return ButtonFactory.Root(
        joinText(children) as never,
        (hasKeys(options) ? options : undefined) as ButtonOptions | undefined,
    );
}
