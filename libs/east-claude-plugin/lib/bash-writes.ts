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
 * heredoc lands), `tee`, `sed -i`, and `cp` / `mv` destinations.
 */
export function writtenPaths(command: string): string[] {
  const found = new Set<string>();

  for (const match of command.matchAll(/>>?\s*(['"]?)([^\s'";|&<>]+)\1/g)) {
    const path = unquote(match[2] ?? "");
    if (isRealPath(path)) found.add(path);
  }

  for (const segment of segments(command)) {
    const trimmed = segment.trim();
    for (const match of trimmed.matchAll(/\btee\s+(?:-a\s+)?(['"]?)([^\s'";|&<>]+)\1/g)) {
      const path = unquote(match[2] ?? "");
      if (isRealPath(path)) found.add(path);
    }
    // `sed -i … file`, `cp a b`, `mv a b`, `install … dest` — the destination is last
    if (/^\s*(sed\s+(-[^\s]*\s+)*-i|cp|mv|install)\b/.test(trimmed)) {
      const path = lastToken(trimmed);
      if (path !== undefined) found.add(path);
    }
  }

  return [...found];
}
