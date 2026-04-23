/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/*
 * Snapshot writer/reader — matches the cross-runtime format defined in
 * docs/snapshot-format.md. A .east-snapshot is an uncompressed POSIX ustar
 * archive containing manifest.json, ir.<ext>, and input-<N>.<ext>.
 */

import { createReadStream, createWriteStream, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, extname, join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import {
    StructType,
    ArrayType,
    StringType,
    IntegerType,
    DateTimeType,
    encodeJSONFor,
    decodeJSONFor,
    type ValueTypeOf,
} from '@elaraai/east';
import tar from 'tar-stream';

const SNAPSHOT_FORMAT_VERSION = 1n;

/* -------------------------------------------------------------------------- */
/*  Manifest schema — byte-identical across all runtime CLIs                   */
/* -------------------------------------------------------------------------- */

const SnapshotManifestType = StructType({
    version:    IntegerType,
    created_at: DateTimeType,
    runtime:    StructType({
        impl: StringType,
        cli:  StringType,
    }),
    ir:       StringType,
    inputs:   ArrayType(StringType),
    packages: ArrayType(StringType),
});

type SnapshotManifest = ValueTypeOf<typeof SnapshotManifestType>;

/* -------------------------------------------------------------------------- */
/*  Helpers                                                                    */
/* -------------------------------------------------------------------------- */

function extOf(path: string): string {
    const e = extname(basename(path));
    return e.startsWith('.') ? e.slice(1) : e;
}

/* -------------------------------------------------------------------------- */
/*  Writer                                                                     */
/* -------------------------------------------------------------------------- */

export async function writeSnapshot(params: {
    outPath:    string;
    irPath:     string;
    inputPaths: string[];
    packages:   string[];
    cliVersion: string;
}): Promise<void> {
    const { outPath, irPath, inputPaths, packages, cliVersion } = params;

    const irArchiveName = `ir.${extOf(irPath)}`;
    const inputArchiveNames = inputPaths.map((p, i) => `input-${i}.${extOf(p)}`);

    const manifest: SnapshotManifest = {
        version:    SNAPSHOT_FORMAT_VERSION,
        created_at: new Date(),
        runtime:    { impl: 'east-node', cli: cliVersion },
        ir:         irArchiveName,
        inputs:     inputArchiveNames,
        packages:   packages,
    };

    const manifestBytes = encodeJSONFor(SnapshotManifestType)(manifest);

    const pack = tar.pack();
    const out = createWriteStream(outPath);
    const done = pipeline(pack, out);

    await new Promise<void>((resolve, reject) => {
        const buf = Buffer.from(manifestBytes);
        pack.entry({ name: 'manifest.json', size: buf.length }, buf, err =>
            err ? reject(err) : resolve());
    });

    const irBytes = readFileSync(irPath);
    await new Promise<void>((resolve, reject) => {
        pack.entry({ name: irArchiveName, size: irBytes.length }, irBytes, err =>
            err ? reject(err) : resolve());
    });

    for (let i = 0; i < inputPaths.length; i++) {
        const bytes = readFileSync(inputPaths[i]!);
        const name = inputArchiveNames[i]!;
        await new Promise<void>((resolve, reject) => {
            pack.entry({ name, size: bytes.length }, bytes, err =>
                err ? reject(err) : resolve());
        });
    }

    pack.finalize();
    await done;
}

/* -------------------------------------------------------------------------- */
/*  Reader                                                                     */
/* -------------------------------------------------------------------------- */

export type SnapshotExtract = {
    irPath:     string;
    inputPaths: string[];
    packages:   string[];
    cleanup(): void;
};

export async function readSnapshot(inPath: string): Promise<SnapshotExtract> {
    const extract = tar.extract();
    const entries: Array<{ name: string; data: Buffer }> = [];

    const read = new Promise<void>((resolve, reject) => {
        extract.on('entry', (header, stream, next) => {
            const chunks: Buffer[] = [];
            stream.on('data', (c: Buffer) => chunks.push(c));
            stream.on('end', () => {
                entries.push({ name: header.name, data: Buffer.concat(chunks) });
                next();
            });
            stream.on('error', reject);
            stream.resume();
        });
        extract.on('finish', resolve);
        extract.on('error', reject);
    });

    await pipeline(createReadStream(inPath), extract);
    await read;

    const manifestEntry = entries.find(e => e.name === 'manifest.json');
    if (!manifestEntry) throw new Error(`Snapshot is missing manifest.json: ${inPath}`);

    const manifest: SnapshotManifest = decodeJSONFor(SnapshotManifestType)(manifestEntry.data);

    if (manifest.version !== SNAPSHOT_FORMAT_VERSION) {
        throw new Error(
            `Snapshot format version ${manifest.version} is not supported (expected ${SNAPSHOT_FORMAT_VERSION})`,
        );
    }

    const dir = mkdtempSync(join(tmpdir(), 'east-snapshot-'));
    for (const entry of entries) {
        if (entry.name === 'manifest.json') continue;
        writeFileSync(join(dir, entry.name), entry.data);
    }

    const irPath = join(dir, manifest.ir);
    const inputPaths = manifest.inputs.map(n => join(dir, n));

    return {
        irPath,
        inputPaths,
        packages: manifest.packages,
        cleanup: () => rmSync(dir, { recursive: true, force: true }),
    };
}
