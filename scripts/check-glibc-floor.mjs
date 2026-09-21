#!/usr/bin/env node
// Holds the glibc floor of a released Linux binary.
//
// Why this exists
// ---------------
// east-c ships prebuilt Linux binaries (@elaraai/east-c-cli-linux-*) and the
// Docker tier runs them on node:22-slim — Debian bookworm, glibc 2.36. The
// build host's glibc is newer than that, and a binary only fails at LOAD time,
// on the older machine, with `version 'GLIBC_x.y' not found`. Nothing in the
// build notices.
//
// It is easy to raise the floor by accident: a unit that defines _GNU_SOURCE
// gets _ISOC2X_SOURCE with it, and from glibc 2.38 that silently rebinds
// sscanf/strtol to their __isoc23_* twins at GLIBC_2.38. That is exactly what
// happened in v1.0.77 (src/cpu_count.c parsed the cgroup quota beside its
// sched_getaffinity call): the npm packages published fine and every Docker
// image for v1.0.77 and v1.0.78 silently did not ship, because the image test
// job is a gate for the five build jobs.
//
// So: assert the maximum glibc symbol version the binary requires, at build
// time, naming the symbols that break it.
//
// Usage
// -----
//   node scripts/check-glibc-floor.mjs <binary> [--max 2.34]
//
// The default floor is what east-c has always shipped (2.34, through v1.0.76).
// Raising it is a deployment decision, not a build detail: every target that
// runs these binaries — the Docker base images above all — has to provide the
// new minimum first.

import fs from 'node:fs';

const FLOOR_DEFAULT = '2.34';

const argv = process.argv.slice(2);
let MAX = FLOOR_DEFAULT;
const positional = [];
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--max') { MAX = argv[++i]; continue; }
  positional.push(argv[i]);
}
if (positional.length !== 1 || !MAX) {
  console.error('Usage: node scripts/check-glibc-floor.mjs <binary> [--max 2.34]');
  process.exit(2);
}
const file = positional[0];

/** "2.38" -> [2, 38]; null when the version is not numeric (GLIBC_ABI_DT_RELR). */
function parseVersion(name) {
  const m = /^GLIBC_(\d+(?:\.\d+)*)$/.exec(name);
  if (!m) return null;
  return m[1].split('.').map(Number);
}

function cmp(a, b) {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

const buf = fs.readFileSync(file);
if (buf.length < 64 || buf.readUInt32BE(0) !== 0x7f454c46) {
  console.error(`${file}: not an ELF file — nothing to check.`);
  process.exit(2);
}
if (buf[4] !== 2 || buf[5] !== 1) {
  console.error(`${file}: only 64-bit little-endian ELF is supported (class ${buf[4]}, data ${buf[5]}).`);
  process.exit(2);
}

const shoff = Number(buf.readBigUInt64LE(0x28));
const shentsize = buf.readUInt16LE(0x3a);
const shnum = buf.readUInt16LE(0x3c);
const shstrndx = buf.readUInt16LE(0x3e);

const sections = [];
for (let i = 0; i < shnum; i++) {
  const o = shoff + i * shentsize;
  sections.push({
    nameOff: buf.readUInt32LE(o),
    type: buf.readUInt32LE(o + 4),
    offset: Number(buf.readBigUInt64LE(o + 24)),
    size: Number(buf.readBigUInt64LE(o + 32)),
    link: buf.readUInt32LE(o + 40),
    entsize: Number(buf.readBigUInt64LE(o + 56)),
  });
}
const shstr = sections[shstrndx];
const str = (sec, off) => {
  const start = sec.offset + off;
  const end = buf.indexOf(0, start);
  return buf.toString('utf8', start, end);
};
for (const s of sections) s.name = str(shstr, s.nameOff);
const byName = name => sections.find(s => s.name === name);

const verneed = byName('.gnu.version_r');
if (!verneed) {
  console.log(`${file}: no version requirements (static, or no versioned symbols). OK.`);
  process.exit(0);
}
const verstr = sections[verneed.link];

// version index (vna_other) -> { lib, version }
const versions = new Map();
for (let vn = verneed.offset; ; ) {
  const cnt = buf.readUInt16LE(vn + 2);
  const lib = str(verstr, buf.readUInt32LE(vn + 4));
  const auxOff = buf.readUInt32LE(vn + 8);
  const next = buf.readUInt32LE(vn + 12);
  let aux = vn + auxOff;
  for (let i = 0; i < cnt; i++) {
    versions.set(buf.readUInt16LE(aux + 6), { lib, version: str(verstr, buf.readUInt32LE(aux + 8)) });
    const anext = buf.readUInt32LE(aux + 12);
    if (!anext) break;
    aux += anext;
  }
  if (!next) break;
  vn += next;
}

// Map each dynamic symbol to the version it is bound to, so a failure names it.
const dynsym = byName('.dynsym');
const gnuversion = byName('.gnu.version');
const offenders = [];
let highest = null;
const floor = parseVersion(`GLIBC_${MAX}`);
if (!floor) {
  console.error(`--max must be a numeric glibc version like 2.34 (got ${MAX}).`);
  process.exit(2);
}

const seen = new Map(); // version name -> symbol names
if (dynsym && gnuversion) {
  const dynstr = sections[dynsym.link];
  const count = Math.floor(dynsym.size / (dynsym.entsize || 24));
  for (let i = 0; i < count; i++) {
    const vi = buf.readUInt16LE(gnuversion.offset + i * 2) & 0x7fff;
    const v = versions.get(vi);
    if (!v) continue;
    const symbol = str(dynstr, buf.readUInt32LE(dynsym.offset + i * (dynsym.entsize || 24)));
    if (!seen.has(v.version)) seen.set(v.version, []);
    seen.get(v.version).push(`${symbol}  (${v.lib})`);
  }
} else {
  for (const v of versions.values()) if (!seen.has(v.version)) seen.set(v.version, []);
}

for (const [name, symbols] of seen) {
  const parsed = parseVersion(name);
  if (!parsed) continue;
  if (highest === null || cmp(parsed, highest.parsed) > 0) highest = { name, parsed };
  if (cmp(parsed, floor) > 0) offenders.push({ name, symbols });
}

if (offenders.length === 0) {
  console.log(`${file}: requires at most ${highest ? highest.name : 'no GLIBC version'} (floor GLIBC_${MAX}). OK.`);
  process.exit(0);
}

offenders.sort((a, b) => cmp(parseVersion(a.name), parseVersion(b.name)));
console.error(`${file} raises the glibc floor above GLIBC_${MAX}.\n`);
for (const { name, symbols } of offenders) {
  console.error(`  ${name} required by:`);
  for (const s of symbols.length ? symbols : ['(symbol table unavailable)']) console.error(`    ${s}`);
}
console.error(`
The published Docker images run these binaries on node:22-slim (Debian
bookworm, glibc 2.36), so a floor above GLIBC_${MAX} does not load there.

The usual cause is a translation unit that defines _GNU_SOURCE and then calls
the scanf/strtol family: _GNU_SOURCE implies _ISOC2X_SOURCE, and glibc 2.38+
rebinds those to __isoc23_* at GLIBC_2.38. Keep such calls in a unit that does
not define _GNU_SOURCE (libs/east-c/packages/east-c/src/cgroup_quota.c is the
worked example), or build against an older glibc.`);
process.exit(1);
