#!/usr/bin/env node
// Holds the glibc floor of the released Linux binaries and libraries.
//
// Why this exists
// ---------------
// east-c ships prebuilt Linux binaries (@elaraai/east-c-cli-linux-*) and, for
// linux-x64, the east-c-datascience libraries (@elaraai/east-c-datascience-
// linux-x64: libeast-c-datascience, libeast-c-nn and the OR-Tools libraries
// they load). The Docker tiers run them on node:22-slim — Debian bookworm,
// glibc 2.36, GCC 12's libstdc++. A build host's glibc and libstdc++ are
// newer than that, and a binary only fails at LOAD time, on the older
// machine, with `version 'GLIBC_x.y' not found` (or GLIBCXX_, CXXABI_ for a
// C++ library). Nothing in the build notices.
//
// It is easy to raise the floor by accident: a unit that defines _GNU_SOURCE
// gets _ISOC2X_SOURCE with it, and from glibc 2.38 that silently rebinds
// sscanf/strtol to their __isoc23_* twins at GLIBC_2.38. That is exactly what
// happened in v1.0.77 (src/cpu_count.c parsed the cgroup quota beside its
// sched_getaffinity call): the npm packages published fine and every Docker
// image for v1.0.77 and v1.0.78 silently did not ship, because the image test
// job is a gate for the five build jobs. A C++ library raises it as easily:
// OR-Tools' Ubuntu 24.04 archive needs GLIBC_2.38 and GLIBCXX_3.4.32.
//
// So: assert the maximum symbol versions each file requires, at build time,
// naming the symbols that break it.
//
// Usage
// -----
//   node scripts/check-glibc-floor.mjs <file-or-dir>... [--max 2.34] [--max-glibcxx 3.4.29] [--max-cxxabi 1.3.13]
//
// A directory means every ELF file in it. The default floor is what east-c
// has always shipped (glibc 2.34, through v1.0.76) and the libstdc++ beside
// it (GCC 11's: GLIBCXX_3.4.29, CXXABI_1.3.13 — AlmaLinux 9, where the
// datascience libraries are built). Raising it is a deployment decision, not
// a build detail: every target that runs these files — the Docker base images
// above all — has to provide the new minimum first.

import fs from 'node:fs';
import path from 'node:path';

const FLOORS = { GLIBC: '2.34', GLIBCXX: '3.4.29', CXXABI: '1.3.13' };

const argv = process.argv.slice(2);
const positional = [];
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--max') { FLOORS.GLIBC = argv[++i]; continue; }
  if (argv[i] === '--max-glibcxx') { FLOORS.GLIBCXX = argv[++i]; continue; }
  if (argv[i] === '--max-cxxabi') { FLOORS.CXXABI = argv[++i]; continue; }
  positional.push(argv[i]);
}
if (positional.length === 0 || Object.values(FLOORS).some(v => !v)) {
  console.error('Usage: node scripts/check-glibc-floor.mjs <file-or-dir>... [--max 2.34] [--max-glibcxx 3.4.29] [--max-cxxabi 1.3.13]');
  process.exit(2);
}

/** "GLIBCXX_3.4.29" -> { family: "GLIBCXX", parsed: [3, 4, 29] }; null when not a numeric version. */
function parseVersion(name) {
  const m = /^(GLIBC|GLIBCXX|CXXABI)_(\d+(?:\.\d+)*)$/.exec(name);
  if (!m) return null;
  return { family: m[1], parsed: m[2].split('.').map(Number) };
}

function cmp(a, b) {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

const floors = {};
for (const [family, text] of Object.entries(FLOORS)) {
  const v = parseVersion(`${family}_${text}`);
  if (!v) {
    console.error(`--max for ${family} must be a numeric version like ${family === 'GLIBC' ? '2.34' : family === 'GLIBCXX' ? '3.4.29' : '1.3.13'} (got ${text}).`);
    process.exit(2);
  }
  floors[family] = v.parsed;
}

function isElf(buf) {
  return buf.length >= 64 && buf.readUInt32BE(0) === 0x7f454c46;
}

/** The version requirements of one ELF file: { highest: {family: name}, offenders: [{name, symbols}] }, or a reason it was not checked. */
function check(file) {
  const buf = fs.readFileSync(file);
  if (!isElf(buf)) return { skipped: 'not an ELF file' };
  if (buf[4] !== 2 || buf[5] !== 1) return { skipped: `only 64-bit little-endian ELF is supported (class ${buf[4]}, data ${buf[5]})` };

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
  if (!verneed) return { highest: {}, offenders: [], note: 'no version requirements (static, or no versioned symbols)' };
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

  const highest = {};
  const offenders = [];
  for (const [name, symbols] of seen) {
    const v = parseVersion(name);
    if (!v) continue;
    if (!highest[v.family] || cmp(v.parsed, parseVersion(highest[v.family]).parsed) > 0) highest[v.family] = name;
    if (cmp(v.parsed, floors[v.family]) > 0) offenders.push({ name, symbols });
  }
  offenders.sort((a, b) => cmp(parseVersion(a.name).parsed, parseVersion(b.name).parsed));
  return { highest, offenders };
}

const files = [];
for (const p of positional) {
  const st = fs.statSync(p);
  if (st.isDirectory()) {
    for (const entry of fs.readdirSync(p).sort()) {
      const full = path.join(p, entry);
      if (fs.statSync(full).isFile()) files.push(full);
    }
  } else {
    files.push(p);
  }
}

const floorText = `GLIBC_${FLOORS.GLIBC}, GLIBCXX_${FLOORS.GLIBCXX}, CXXABI_${FLOORS.CXXABI}`;
let checked = 0;
let failed = false;
for (const file of files) {
  const r = check(file);
  if (r.skipped) {
    if (positional.includes(file)) {
      console.error(`${file}: ${r.skipped} — nothing to check.`);
      process.exit(2);
    }
    continue; // a directory's non-ELF member (a README, a stamp)
  }
  checked++;
  const requires = Object.values(r.highest).join(', ') || (r.note ?? 'no GLIBC version');
  if (r.offenders.length === 0) {
    console.log(`${file}: requires at most ${requires}. OK.`);
    continue;
  }
  failed = true;
  console.error(`${file} raises the floor above ${floorText}.\n`);
  for (const { name, symbols } of r.offenders) {
    console.error(`  ${name} required by:`);
    for (const s of symbols.length ? symbols : ['(symbol table unavailable)']) console.error(`    ${s}`);
  }
  console.error('');
}

if (checked === 0) {
  console.error('No ELF files checked.');
  process.exit(2);
}
if (failed) {
  console.error(`
The published Docker images run these files on node:22-slim (Debian bookworm,
glibc 2.36, GCC 12's libstdc++), and the npm packages on whatever a project's
machine runs, so a floor above ${floorText} does not load there.

For a C binary the usual cause is a translation unit that defines _GNU_SOURCE
and then calls the scanf/strtol family: _GNU_SOURCE implies _ISOC2X_SOURCE, and
glibc 2.38+ rebinds those to __isoc23_* at GLIBC_2.38. Keep such calls in a
unit that does not define _GNU_SOURCE (libs/east-c/packages/east-c/src/
cgroup_quota.c is the worked example), or build against an older glibc. For a
C++ library, build it on the floor (AlmaLinux 9: glibc 2.34, GCC 11), and take
prebuilt libraries from an archive built there (libs/east-c/scripts/
fetch-ortools.sh pins OR-Tools' almalinux-9 archive).`);
  process.exit(1);
}
console.log(`${checked} file(s) within the floor (${floorText}).`);
