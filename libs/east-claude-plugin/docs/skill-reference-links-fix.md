# Brief: dead `reference/` links in plugin skills

## Symptom

When a skill is loaded by Claude Code, its "Reference Documentation"
section advertises links such as:

```markdown
- **[API Reference](./reference/api.md)** - Complete function signatures...
- **[Examples](./reference/examples.md)** - Working code examples by use case
```

Following any of these from the **installed plugin** fails — the target
does not exist. The model is told the file is there, clicks through, and
hits a missing path (or worse, silently improvises).

## Root cause

It is **not** that the reference files were deleted. They still exist in
each lib source tree (`libs/<lib>/.../reference/{api,examples}.md`).

The problem is a packaging/path mismatch:

1. Each plugin skill dir contains **only** a `SKILL.md` symlink — e.g.
   `skills/east-py-datascience/SKILL.md → ../../../east-py/packages/east-py-datascience/SKILL.md`.
   The sibling `reference/` directory (and `USAGE.md` for east-ui) is
   **not** symlinked alongside it.
2. The links in `SKILL.md` are relative (`./reference/api.md`). They
   resolve correctly only against the **lib source dir**, where
   `reference/` is a real sibling.
3. When the skill is consumed, its base dir is the **plugin skill dir**
   (`skills/<name>/`), which has no `reference/`. Relative links dangle.
4. On install the symlink is **dereferenced into a copy**
   (`~/.claude/plugins/cache/elaraai/east/<version>/`, per
   `README.md:84`) — SKILL.md becomes a real file but the sibling assets
   are still not bundled, so the dead links ship to users.

In short: **SKILL.md is wired into the plugin but its companion assets
are not**, and the links assume the lib-source layout.

## Affected skills (source file : line)

| Skill | Source `SKILL.md` | Lines | Dead links |
|---|---|---|---|
| east | `libs/east/SKILL.md` | 197–198 | `./reference/api.md`, `./reference/examples.md` |
| east-node-std | `libs/east-node/packages/east-node-std/SKILL.md` | 82–83 | same |
| east-node-io | `libs/east-node/packages/east-node-io/SKILL.md` | 98–99 | same |
| east-py-datascience | `libs/east-py/packages/east-py-datascience/SKILL.md` | 157–158 | same |
| east-ui | `libs/east-ui/packages/east-ui/SKILL.md` | 296–298 | `./reference/api.md`, `./reference/examples.md`, `./USAGE.md` |

Not affected: `e3` (no relative links), `east-project` (plugin-native,
no reference section). `e3-ui` (`SKILL.md:8`) links to sibling **lib
dirs** (`../east-ui`, `../../../e3`) for prose context, not bundled
assets — lower severity, but it has the same class of lib-relative-path
assumption and breaks identically once dereferenced into the cache.

## Decide the fix direction

These two are mutually exclusive — pick one and apply it uniformly
across **all** skills, then add the guard so it can't regress.

### Option A — bundle the assets (keep the links)

Make the packaging carry each skill's `reference/` dir (and
`east-ui/USAGE.md`) into the plugin skill dir next to the dereferenced
`SKILL.md`, so `./reference/...` resolves at consumption time. This is
the right call if the reference docs are genuinely meant to be
reachable. The fix lives in whatever step materializes
`skills/<name>/` — symlink the sibling assets in dev, and ensure the
install/cache copy includes them (the `bundle` / cache-refresh path in
`README.md`).

### Option B — drop the links (point at the live sources)

If the search index + `*.examples.ts` (surfaced via
`mcp__plugin_east_east__search_east_examples`) and TypeDoc are
now the intended source of truth, then the static `reference/*.md` are
legacy and the links are simply stale. Replace the "Reference
Documentation" bullets in every affected `SKILL.md` with a pointer to
the search tool / generated docs, and delete the orphaned
`reference/` dirs from the lib sources. Edit the **lib source**
`SKILL.md` (the symlink target), never the symlink.

## Guardrail (do this regardless of A/B)

Add a CI check that fails if any **dereferenced** `skills/<name>/SKILL.md`
contains a relative link whose target is missing *relative to the skill
dir as consumed* (not the lib source). The per-skill scan that found
this:

```bash
cd libs/east-claude-plugin/skills
for d in */; do
  s="${d}SKILL.md"; [ -e "$s" ] || continue
  base="$d"                       # consumption base = the skill dir itself
  grep -oE '\]\(([^)]+)\)' "$s" | sed -E 's/^\]\(//; s/\)$//' \
    | grep -vE '^https?://|^#' | while read -r l; do
        p="${l%%#*}"
        [ -e "$base/$p" ] || echo "DEAD: $d -> $l"
      done
done
```

Note it must resolve against the **skill dir**, not `readlink -f` the
SKILL.md first — resolving via the symlink target hides the bug because
the lib source *does* have the files.

## Coordination note

Per `CLAUDE.md`, these `SKILL.md` files back plugin skills and the lib
copy is the single source of truth; the search `index.json` is
regenerated from each lib's `*.examples.ts`. Editing SKILL.md changes
plugin behaviour — coordinate before merging, and re-run the
`generate-index` / `bundle` steps after.
