/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

// What `east-ui/inline-places` reads (#1440): each line a case, the ones it refuses marked.

import { Box } from "@chakra-ui/react";

const PAD = 4;
const step = (n: number) => `${n * 8}px`;
const place = (f: number) => ({ left: `${f * 100}%`, width: "10px" });
const unwrap = (v: { value: number } | undefined) => v?.value;

/** A scale, as an interface declares it: what its method returns cannot be read. */
interface Scale {
    fracOf(t: number): number;
}

/** A component of this code's own, whose `left` is no style. */
function Mark({ left }: { left: string }) {
    return <span data-left={left} />;
}

export function Places({ f, n, tone, scale, opacity }: { f: number; n: number; tone: "fg" | "fg.muted"; scale: Scale; opacity?: { value: number } }) {
    const left = `${f * 100}%`;
    return (
        <>
            <Box left={`${f * 100}%`} />
            <Box width={n * 2} />
            <Box height={Math.round(n)} />
            <Box left={scale.fracOf(n)} />
            <Box left={left} />
            <Box paddingLeft={step(n)} />
            <Box {...place(f)} />
            <Box css={{ top: `${n}px` }} />
            <Box _hover={{ left: `${n}px` }} />
            <Box left="12px" />
            <Box minHeight={`${PAD}px`} />
            <Box color={`${tone}.700`} />
            <Box height={n} />
            <Box opacity={unwrap(opacity)} />
            <Box color={tone} />
            <Box padding={PAD} />
            <Box width={n > 2 ? "1px" : "2px"} />
            <Box style={{ left: `${f * 100}%` }} />
            <Mark left={`${f * 100}%`} />
            <svg width={n} />
        </>
    );
}
