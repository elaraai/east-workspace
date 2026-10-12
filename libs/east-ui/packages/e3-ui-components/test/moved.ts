/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * What a component's move to e3 is checked with — the Plan's (#1177), the
 * Sheet's (#1179): the files a package holds, and the names a module exports,
 * read from its source or its declarations with its comments left out.
 */

import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Where the UI packages sit, side by side. */
export const PACKAGES = fileURLToPath(new URL('../../', import.meta.url));

/** Every file under `dir` whose name `keep` accepts. */
export function files(dir: string, keep: (name: string) => boolean): string[] {
    return readdirSync(dir).flatMap((name) => {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) return files(path, keep);
        return keep(name) ? [path] : [];
    });
}

/** A source's code — its comments blanked, so a name in prose is not a name. */
export function code(src: string): string {
    return src
        .replace(/\/\*[\s\S]*?\*\//gu, ' ')
        .replace(/\/\/[^\n]*/gu, '');
}

/** The names a module exports — its exported declarations, and its export lists (an alias by its alias). */
export function exported(src: string): Set<string> {
    const names = new Set<string>();
    const declaration = /\bexport\s+(?:declare\s+)?(?:abstract\s+)?(?:async\s+)?(?:const|let|var|function\*?|class|interface|type|namespace|enum)\s+([A-Za-z_$][\w$]*)/gu;
    for (const m of src.matchAll(declaration)) names.add(m[1]!);
    for (const m of src.matchAll(/\bexport\s+(?:type\s+)?\{([^}]*)\}/gu)) {
        for (const part of m[1]!.split(',')) {
            const name = part.replace(/\btype\s+/u, '').split(/\s+as\s+/u).pop()!.trim();
            if (name !== '') names.add(name);
        }
    }
    return names;
}

/** Every declaration file a package builds. */
export const declarations = (pkg: string): string[] => files(join(PACKAGES, pkg, 'dist'), (name) => name.endsWith('.d.ts'));
