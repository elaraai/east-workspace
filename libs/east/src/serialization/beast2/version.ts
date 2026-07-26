/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Which beast2 container this build writes, and which it accepts.
 *
 * These are the single declared source of truth for the wire version. Every
 * encoder default reads {@link BEAST2_WRITE_VERSION} rather than hardcoding a
 * number, so "what do we emit?" is one greppable fact rather than a literal
 * buried in a `??` on the encode path — and the C runtime's
 * `EAST_BEAST2_WRITE_VERSION` is checked against it by
 * `scripts/check-wire-compat.mjs` (wired into `make check-version`), because
 * the two MUST move together: the compliance suite pins one golden byte string
 * per value and replays it in TypeScript, east-c and east-py alike.
 *
 * See `docs/conventions/BEAST2_WIRE_VERSION.md` for the policy, and `SPEC.md`
 * for the magic registry.
 */

/** Container versions selectable by the encode entry points. */
export type Beast2Version = 4 | 5;

/**
 * The container version this build's encoders write by default.
 *
 * Changing this changes every beast2 blob the platform produces — and e3
 * content-addresses those bytes, so it re-keys every stored object. It is a
 * coordinated, release-gated decision, not a tuning knob.
 */
export const BEAST2_WRITE_VERSION = 5 as const;

/**
 * The container versions this build's decoders accept.
 *
 * Decoders dispatch on the magic's version byte, so no call site names a
 * version to read. This list only ever grows: a released container must stay
 * readable indefinitely, which is the half of compatibility the platform
 * actually promises (the stance is lockstep — an *older* reader is not
 * expected to decode a newer writer's bytes).
 */
export const BEAST2_READ_VERSIONS: readonly Beast2Version[] = [4, 5];
