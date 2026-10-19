/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * fdlibm's log (e_log.c; "Developed at SunSoft, a Sun Microsystems, Inc.
 * business. Permission to use, copy, modify, and distribute this software is
 * freely granted, provided that this notice is preserved."), in TypeScript:
 * one IEEE rounding per operation, so the normal draw's logarithm is the same
 * bits on every runtime and every host. `Math.log` is this algorithm in V8,
 * but V8's arm64 build fuses multiply-adds and rounds a few inputs in a
 * thousand differently from its x64 build; the host's libm (east-c-std,
 * east-py-std's `math.log`) differs from both. So every runtime carries this
 * algorithm itself — here, in east-web-std's copy, in C and in python — and
 * `test/random.spec.ts` pins the stream it gives.
 */

const two54 = 1.80143985094819840000e+16;
const ln2_hi = 6.93147180369123816490e-01;
const ln2_lo = 1.90821492927058770002e-10;
const Lg1 = 6.666666666666735130e-01;
const Lg2 = 3.999999999940941908e-01;
const Lg3 = 2.857142874366239149e-01;
const Lg4 = 2.222219843214978396e-01;
const Lg5 = 1.818357216161805012e-01;
const Lg6 = 1.531383769920937332e-01;
const Lg7 = 1.479819860511658591e-01;

const words = new ArrayBuffer(8);
const f64 = new Float64Array(words);
const u32 = new Uint32Array(words);
const LITTLE_ENDIAN = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;
const HI = LITTLE_ENDIAN ? 1 : 0;
const LO = LITTLE_ENDIAN ? 0 : 1;

/** The natural logarithm of `x`, as fdlibm computes it. */
export function fdlibmLog(x: number): number {
    f64[0] = x;
    let hx = (u32[HI] ?? 0) | 0; // the high word, signed
    const lx = u32[LO] ?? 0;
    let k = 0;
    if (hx < 0x00100000) { // x < 2**-1022
        if (((hx & 0x7fffffff) | lx) === 0) return -Infinity; // log(+-0) = -inf
        if (hx < 0) return NaN; // log(-#) = NaN
        k -= 54;
        x *= two54; // subnormal: scale up
        f64[0] = x;
        hx = (u32[HI] ?? 0) | 0;
    }
    if (hx >= 0x7ff00000) return x + x;
    k += (hx >> 20) - 1023;
    hx &= 0x000fffff;
    const i0 = (hx + 0x95f64) & 0x100000;
    // normalize x or x/2: the high word becomes hx | (i0 ^ 0x3ff00000)
    u32[HI] = (hx | (i0 ^ 0x3ff00000)) >>> 0;
    x = f64[0] ?? x;
    k += i0 >> 20;
    const f = x - 1.0;
    if ((0x000fffff & (2 + hx)) < 3) { // -2**-20 <= f < 2**-20
        if (f === 0) {
            if (k === 0) return 0;
            const dk = k;
            return dk * ln2_hi + dk * ln2_lo;
        }
        const R = f * f * (0.5 - 0.33333333333333333 * f);
        if (k === 0) return f - R;
        const dk = k;
        return dk * ln2_hi - ((R - dk * ln2_lo) - f);
    }
    const s = f / (2.0 + f);
    const dk = k;
    const z = s * s;
    let i = hx - 0x6147a;
    const w = z * z;
    const j = 0x6b851 - hx;
    const t1 = w * (Lg2 + w * (Lg4 + w * Lg6));
    const t2 = z * (Lg1 + w * (Lg3 + w * (Lg5 + w * Lg7)));
    i |= j;
    const R = t2 + t1;
    if (i > 0) {
        const hfsq = 0.5 * f * f;
        if (k === 0) return f - (hfsq - s * (hfsq + R));
        return dk * ln2_hi - ((hfsq - (s * (hfsq + R) + dk * ln2_lo)) - f);
    }
    if (k === 0) return f - s * (f - R);
    return dk * ln2_hi - ((s * (f - R) - dk * ln2_lo) - f);
}
