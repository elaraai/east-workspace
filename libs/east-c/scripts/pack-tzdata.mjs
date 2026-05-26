#!/usr/bin/env node
// Pack a zoneinfo (TZif) tree into a single flat blob for embedding into the
// Windows east-c-std binary (which has no system tz database). Run on a host
// that has the IANA tz database, e.g.:
//
//   node scripts/pack-tzdata.mjs /usr/share/zoneinfo packages/east-c-std/src/tzdata.blob
//
// Blob format (all u32 big-endian, matching TZif so the reader shares one
// byte decoder):
//   u32 count
//   count × record: u32 name_len, name bytes, u32 data_len, TZif bytes
//
// Symlinked alias zones (Japan -> Asia/Tokyo) are followed and stored under
// their alias name, so every IANA name resolves. posix/ and right/ are skipped
// (redundant variants the reader never asks for).
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

const srcDir = process.argv[2];
const outFile = process.argv[3];
if (!srcDir || !outFile) {
    console.error("usage: pack-tzdata.mjs <zoneinfo-dir> <out.blob>");
    process.exit(1);
}

const records = [];
function walk(dir) {
    for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        const rel = relative(srcDir, full).split(sep).join("/");
        if (rel === "posix" || rel === "right") continue;
        const st = statSync(full); // follows symlinks
        if (st.isDirectory()) {
            walk(full);
        } else if (st.isFile()) {
            const data = readFileSync(full);
            if (data.length >= 4 && data.toString("ascii", 0, 4) === "TZif") {
                records.push({ name: rel, data });
            }
        }
    }
}
walk(srcDir);
records.sort((a, b) => (a.name < b.name ? -1 : 1));

const chunks = [];
const u32 = (n) => {
    const b = Buffer.allocUnsafe(4);
    b.writeUInt32BE(n >>> 0);
    return b;
};
chunks.push(u32(records.length));
for (const { name, data } of records) {
    const nameBuf = Buffer.from(name, "utf8");
    chunks.push(u32(nameBuf.length), nameBuf, u32(data.length), data);
}
const blob = Buffer.concat(chunks);
writeFileSync(outFile, blob);
console.error(`packed ${records.length} zones -> ${outFile} (${(blob.length / 1024).toFixed(0)} KiB)`);
