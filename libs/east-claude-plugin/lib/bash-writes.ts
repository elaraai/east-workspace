import { resolve } from "node:path";

// Which files a bash command WRITES.
//
// Nothing in the plugin saw these: the hooks match Edit|Write and Read, so a
// file created by `cat > model.py <<'EOF'`, a `>` redirect, `tee`, or `sed -i`
// reached no gate and no review at all. That is not an edge case — it is a
// routine way files get written, and the dominant one when an agent is working
// through a shell.
//
// Over-matching is safe and under-matching is not: every candidate is checked
// for existence, extension and an East import before anything is said, so a
// path that turns out to be a device, a fd, or nothing at all costs one
// `readFile` that fails.

/** `2>&1`, `>&2`, `/dev/null` and friends — redirect targets that are not files. */
function isRealPath(token: string): boolean {
  if (token === "" || token.startsWith("&")) return false;
  if (/^\d+$/.test(token)) return false;
  return !token.startsWith("/dev/");
}

function unquote(token: string): string {
  const m = /^(['"])(.*)\1$/.exec(token);
  return m?.[2] ?? token;
}

/** Split a command into its pipeline/sequence segments, so `cp a b && cat > c`
 * is read as two commands rather than one long argument list. */
function segments(command: string): string[] {
  return command.split(/\|\||&&|[;|\n]/);
}

/** The last path-like token of a segment — what `cp`, `mv` and `sed -i` write. */
function lastToken(segment: string): string | undefined {
  const tokens = segment.trim().split(/\s+/).map(unquote).filter((t) => t !== "" && !t.startsWith("-"));
  const last = tokens.at(-1);
  return last !== undefined && isRealPath(last) ? last : undefined;
}

/**
 * The paths a bash command appears to write.
 *
 * Recognises `>` / `>>` redirects (which is also how a `cat > f <<'EOF'`
 * heredoc lands), `tee`, `sed -i`, and `cp` / `mv` destinations. With `cwd`
 * given, the paths come back absolute, and a `cd` earlier in the command
 * moves the directory the segments after it resolve against — `cd src && cat
 * > model.py` writes `src/model.py`, not `./model.py`.
 */
export function writtenPaths(command: string, cwd?: string): string[] {
  const found = new Set<string>();
  let dir = cwd;
  const add = (path: string): void => {
    if (!isRealPath(path)) return;
    found.add(dir === undefined ? path : resolve(dir, path));
  };

  for (const segment of segments(command)) {
    const trimmed = segment.trim();
    const moved = /^cd\s+(['"]?)([^\s'";|&<>]+)\1\s*$/.exec(trimmed);
    if (moved !== null && dir !== undefined) {
      dir = resolve(dir, unquote(moved[2] ?? ""));
      continue;
    }
    for (const match of trimmed.matchAll(/>>?\s*(['"]?)([^\s'";|&<>]+)\1/g)) add(unquote(match[2] ?? ""));
    for (const match of trimmed.matchAll(/\btee\s+(?:-a\s+)?(['"]?)([^\s'";|&<>]+)\1/g)) add(unquote(match[2] ?? ""));
    // `sed -i … file`, `cp a b`, `mv a b`, `install … dest` — the destination is last
    if (/^\s*(sed\s+(-[^\s]*\s+)*-i|cp|mv|install)\b/.test(trimmed)) {
      const path = lastToken(trimmed);
      if (path !== undefined) add(path);
    }
  }

  return [...found];
}
