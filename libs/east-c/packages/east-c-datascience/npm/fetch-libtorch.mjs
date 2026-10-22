#!/usr/bin/env node
/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE.md for details.
 */

/**
 * Fetches the pinned libtorch build east-c-datascience's neural networks run
 * on, into this package's libtorch/ directory, beside lib/ — where the
 * neural-network library (lib/libeast-c-nn.so) looks for it, through its
 * $ORIGIN/../libtorch/lib rpath. The build is pinned by version and SHA-256 in
 * libtorch-pins.json, beside this script; an archive whose bytes differ is
 * refused.
 *
 *   node fetch-libtorch.mjs [--variant cpu|cu128] [--force] [--archive <zip>]
 *   node fetch-libtorch.mjs --postinstall
 *
 * Only what the library loads is extracted: libeast-c-nn's needed libraries
 * and theirs, resolved among the archive's lib/ entries — some 440 MB of the
 * CPU build's 730 MB — plus the archive's build-version. The variant is
 * `--variant`, else EAST_LIBTORCH_VARIANT, else cpu; a variant whose SHA-256
 * is not pinned needs EAST_LIBTORCH_SHA256.
 *
 * As the per-platform package's postinstall (--postinstall) it never fails the
 * install: a fetch that cannot happen — EAST_LIBTORCH=skip, no network — is
 * reported, and `east-c-datascience fetch-libtorch` does it later. The other
 * families (OR-Tools, XGBoost) need none of this.
 */

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { dirname, join } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import zlib from 'node:zlib';

/** Reads the command line; null when it is not understood. */
export function parseArgs(argv) {
    const out = { variant: undefined, force: false, archive: undefined, postinstall: false, dir: undefined };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--variant' && i + 1 < argv.length) out.variant = argv[++i];
        else if (a === '--force') out.force = true;
        else if (a === '--archive' && i + 1 < argv.length) out.archive = argv[++i];
        else if (a === '--dir' && i + 1 < argv.length) out.dir = argv[++i];
        else if (a === '--postinstall') out.postinstall = true;
        else return null;
    }
    return out;
}

// ── ELF: the libraries a shared object needs ──────────────────────────────

function neededOf(file) {
    // Read only the ELF header, the section headers, the dynamic section and
    // its string table: the libraries run to hundreds of megabytes.
    const fd = fs.openSync(file, 'r');
    const readAt = (offset, size) => {
        const b = Buffer.alloc(size);
        const n = fs.readSync(fd, b, 0, size, offset);
        return n === size ? b : b.subarray(0, n);
    };
    try {
        const header = readAt(0, 64);
        if (header.length < 64 || header.readUInt32BE(0) !== 0x7f454c46 || header[4] !== 2 || header[5] !== 1) return [];
        const shoff = Number(header.readBigUInt64LE(0x28));
        const shentsize = header.readUInt16LE(0x3a);
        const shnum = header.readUInt16LE(0x3c);
        const table = readAt(shoff, shentsize * shnum);
        const sections = [];
        for (let i = 0; i < shnum; i++) {
            const o = i * shentsize;
            sections.push({
                type: table.readUInt32LE(o + 4),
                offset: Number(table.readBigUInt64LE(o + 24)),
                size: Number(table.readBigUInt64LE(o + 32)),
                link: table.readUInt32LE(o + 40),
            });
        }
        const dynamic = sections.find((s) => s.type === 6); // SHT_DYNAMIC
        if (!dynamic) return [];
        const strtab = sections[dynamic.link];
        const dyn = readAt(dynamic.offset, dynamic.size);
        const str = readAt(strtab.offset, strtab.size);
        const names = [];
        for (let o = 0; o + 16 <= dyn.length; o += 16) {
            const tag = Number(dyn.readBigInt64LE(o));
            if (tag === 1) { // DT_NEEDED
                const at = Number(dyn.readBigUInt64LE(o + 8));
                const end = str.indexOf(0, at);
                names.push(str.toString('utf8', at, end < 0 ? str.length : end));
            }
        }
        return names;
    } finally {
        fs.closeSync(fd);
    }
}

// ── ZIP: the central directory, and one entry out ─────────────────────────

function readAt(fd, position, length) {
    const buf = Buffer.alloc(length);
    let done = 0;
    while (done < length) {
        const n = fs.readSync(fd, buf, done, length - done, position + done);
        if (n === 0) break;
        done += n;
    }
    return buf.subarray(0, done);
}

/** The archive's entries by name: { method, compressedSize, localHeaderOffset }. */
function zipEntries(fd, size) {
    const tailLen = Math.min(size, 22 + 65535 + 20 + 56);
    const tail = readAt(fd, size - tailLen, tailLen);
    let eocd = -1;
    for (let i = tail.length - 22; i >= 0; i--) {
        if (tail.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('not a zip archive (no end of central directory)');
    let count = tail.readUInt16LE(eocd + 10);
    let cdSize = tail.readUInt32LE(eocd + 12);
    let cdOffset = tail.readUInt32LE(eocd + 16);
    if (count === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) {
        const loc = eocd - 20;
        if (loc < 0 || tail.readUInt32LE(loc) !== 0x07064b50) throw new Error('zip64 archive without its locator');
        const recordOffset = Number(tail.readBigUInt64LE(loc + 8));
        const record = readAt(fd, recordOffset, 56);
        if (record.readUInt32LE(0) !== 0x06064b50) throw new Error('zip64 end of central directory not found');
        count = Number(record.readBigUInt64LE(24));
        cdSize = Number(record.readBigUInt64LE(40));
        cdOffset = Number(record.readBigUInt64LE(48));
    }
    const cd = readAt(fd, cdOffset, cdSize);
    const entries = new Map();
    let p = 0;
    for (let i = 0; i < count && p + 46 <= cd.length; i++) {
        if (cd.readUInt32LE(p) !== 0x02014b50) throw new Error('malformed central directory');
        const method = cd.readUInt16LE(p + 10);
        let compressedSize = cd.readUInt32LE(p + 20);
        let uncompressedSize = cd.readUInt32LE(p + 24);
        const nameLen = cd.readUInt16LE(p + 28);
        const extraLen = cd.readUInt16LE(p + 30);
        const commentLen = cd.readUInt16LE(p + 32);
        let localHeaderOffset = cd.readUInt32LE(p + 42);
        const name = cd.toString('utf8', p + 46, p + 46 + nameLen);
        // The zip64 extra field carries, in order, each 32-bit field that overflowed.
        let e = p + 46 + nameLen;
        const extraEnd = e + extraLen;
        while (e + 4 <= extraEnd) {
            const id = cd.readUInt16LE(e);
            const len = cd.readUInt16LE(e + 2);
            if (id === 0x0001) {
                let f = e + 4;
                if (uncompressedSize === 0xffffffff) { uncompressedSize = Number(cd.readBigUInt64LE(f)); f += 8; }
                if (compressedSize === 0xffffffff) { compressedSize = Number(cd.readBigUInt64LE(f)); f += 8; }
                if (localHeaderOffset === 0xffffffff) { localHeaderOffset = Number(cd.readBigUInt64LE(f)); f += 8; }
            }
            e += 4 + len;
        }
        entries.set(name, { method, compressedSize, uncompressedSize, localHeaderOffset });
        p += 46 + nameLen + extraLen + commentLen;
    }
    return entries;
}

async function extractEntry(archive, fd, entry, dest) {
    const header = readAt(fd, entry.localHeaderOffset, 30);
    if (header.readUInt32LE(0) !== 0x04034b50) throw new Error('malformed local file header');
    const start = entry.localHeaderOffset + 30 + header.readUInt16LE(26) + header.readUInt16LE(28);
    fs.mkdirSync(dirname(dest), { recursive: true });
    const tmp = `${dest}.part`;
    const source = fs.createReadStream(archive, { start, end: start + entry.compressedSize - 1 });
    const sink = fs.createWriteStream(tmp);
    if (entry.method === 8) await pipeline(source, zlib.createInflateRaw(), sink);
    else if (entry.method === 0) await pipeline(source, sink);
    else throw new Error(`unsupported zip compression method ${entry.method}`);
    fs.renameSync(tmp, dest);
}

// ── The fetch ─────────────────────────────────────────────────────────────

async function download(url, dest) {
    const res = await fetch(url);
    if (!res.ok || !res.body) throw new Error(`${url}: HTTP ${res.status}`);
    const hash = createHash('sha256');
    let bytes = 0;
    const tap = new Transform({
        transform(chunk, _enc, cb) {
            hash.update(chunk);
            bytes += chunk.length;
            cb(null, chunk);
        },
    });
    await pipeline(Readable.fromWeb(res.body), tap, fs.createWriteStream(dest));
    return { sha256: hash.digest('hex'), bytes };
}

function sha256Of(file) {
    const hash = createHash('sha256');
    const fd = fs.openSync(file, 'r');
    try {
        const buf = Buffer.alloc(1 << 20);
        for (;;) {
            const n = fs.readSync(fd, buf, 0, buf.length, null);
            if (n === 0) break;
            hash.update(buf.subarray(0, n));
        }
    } finally {
        fs.closeSync(fd);
    }
    return hash.digest('hex');
}

/**
 * Fetches libtorch into `dir`/libtorch (the package directory's; this
 * script's own by default). Resolves to what it did, as text.
 */
export async function fetchLibtorch(options = {}) {
    const dir = options.dir ?? dirname(fileURLToPath(import.meta.url));
    const pins = JSON.parse(fs.readFileSync(join(dir, 'libtorch-pins.json'), 'utf8'));
    const variant = options.variant ?? process.env.EAST_LIBTORCH_VARIANT ?? 'cpu';
    const expected = pins.variants[variant]?.sha256 ?? process.env.EAST_LIBTORCH_SHA256;
    if (!expected) {
        throw new Error(
            `libtorch ${pins.version} (${variant}) has no pinned SHA-256; pass it as EAST_LIBTORCH_SHA256 ` +
            `(variants pinned: ${Object.keys(pins.variants).join(', ')})`,
        );
    }
    const target = join(dir, 'libtorch');
    const stamp = join(target, `.east-libtorch-${pins.version}-${variant}`);
    if (fs.existsSync(stamp) && !options.force) {
        return `libtorch ${pins.version} (${variant}) is already at ${target}`;
    }
    const nnLibrary = join(dir, 'lib', process.platform === 'darwin' ? 'libeast-c-nn.dylib' : 'libeast-c-nn.so');
    if (!fs.existsSync(nnLibrary)) throw new Error(`${nnLibrary} is missing: not an installed east-c-datascience package`);

    const scratch = fs.mkdtempSync(join(dir, '.libtorch-fetch-'));
    try {
        let archive = options.archive;
        if (!archive) {
            const url = pins.url.replaceAll('{variant}', variant).replaceAll('{version}', pins.version);
            console.error(`east-c-datascience: fetching libtorch ${pins.version} (${variant}) from ${url}`);
            archive = join(scratch, 'libtorch.zip');
            const { sha256, bytes } = await download(url, archive);
            if (sha256 !== expected) {
                throw new Error(`libtorch ${pins.version} (${variant}): SHA-256 ${sha256} does not match the pinned ${expected}`);
            }
            console.error(`east-c-datascience: ${(bytes / 1048576).toFixed(0)} MB, SHA-256 verified`);
        } else if (sha256Of(archive) !== expected) {
            throw new Error(`${archive}: SHA-256 does not match the pinned ${expected} for libtorch ${pins.version} (${variant})`);
        }

        // Extract what libeast-c-nn loads, and what that loads, from lib/.
        const fd = fs.openSync(archive, 'r');
        try {
            const entries = zipEntries(fd, fs.fstatSync(fd).size);
            const prefix = [...entries.keys()].find((n) => n.endsWith('/lib/libtorch.so'))?.replace(/lib\/libtorch\.so$/, '');
            if (prefix === undefined) throw new Error('the archive holds no lib/libtorch.so');
            const out = join(scratch, 'libtorch');
            fs.mkdirSync(join(out, 'lib'), { recursive: true });
            const taken = new Set();
            if (variant === 'cpu') {
                // The CPU build: what libeast-c-nn loads, and what that loads, by
                // their declared dependencies — a closure the clean-install CI job
                // runs the suites through.
                const queue = neededOf(nnLibrary);
                while (queue.length > 0) {
                    const name = queue.shift();
                    if (taken.has(name)) continue;
                    const entry = entries.get(`${prefix}lib/${name}`);
                    if (!entry) continue; // the system's: libc, libstdc++, ...
                    taken.add(name);
                    const dest = join(out, 'lib', name);
                    await extractEntry(archive, fd, entry, dest);
                    queue.push(...neededOf(dest));
                }
            } else {
                // A CUDA build opens libraries its headers never declare — cuDNN's
                // sub-libraries, libtorch_cuda_linalg, nvrtc's builtins — as a
                // kernel first needs them, so every library of the archive is kept.
                for (const [name, entry] of entries) {
                    if (!name.startsWith(`${prefix}lib/`) || !/\.so(\.|$)/.test(name)) continue;
                    const base = name.slice(`${prefix}lib/`.length);
                    if (base.includes('/')) continue;
                    taken.add(base);
                    await extractEntry(archive, fd, entry, join(out, 'lib', base));
                }
            }
            if (taken.size === 0) throw new Error(`${nnLibrary} needs nothing from the archive`);
            for (const extra of ['build-version', 'build-hash']) {
                const entry = entries.get(`${prefix}${extra}`);
                if (entry) await extractEntry(archive, fd, entry, join(out, extra));
            }
            fs.rmSync(target, { recursive: true, force: true });
            fs.renameSync(out, target);
            fs.writeFileSync(stamp, `${variant} ${expected}\n`);
            return `libtorch ${pins.version} (${variant}): ${taken.size} libraries at ${join(target, 'lib')}`;
        } finally {
            fs.closeSync(fd);
        }
    } finally {
        fs.rmSync(scratch, { recursive: true, force: true });
    }
}

// Run directly: the per-platform package's postinstall, or by hand.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    const options = parseArgs(process.argv.slice(2));
    if (!options) {
        console.error('usage: node fetch-libtorch.mjs [--variant cpu|cu128] [--force] [--archive <zip>] [--dir <package dir>] [--postinstall]');
        process.exit(2);
    }
    if (options.postinstall && process.env.EAST_LIBTORCH === 'skip') {
        console.error('east-c-datascience: EAST_LIBTORCH=skip — libtorch not fetched (run `east-c-datascience fetch-libtorch` for the neural networks)');
        process.exit(0);
    }
    try {
        console.error(`east-c-datascience: ${await fetchLibtorch(options)}`);
    } catch (e) {
        if (options.postinstall) {
            console.error(
                `east-c-datascience: libtorch not fetched (${e.message}). OR-Tools and XGBoost work without it; ` +
                'for the neural networks run `east-c-datascience fetch-libtorch`.',
            );
            process.exit(0);
        }
        console.error(`east-c-datascience: ${e.message}`);
        process.exit(1);
    }
}
