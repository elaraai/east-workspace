/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * One locale for every renderer: react-aria's locale context is one module the
 * renderer packages share, never a copy each bundles. Bundled, east-ui-components'
 * components read one context and this package's Plan another, and a host's one
 * `I18nProvider` reached only one of them. This reads what east-ui-components
 * and this package build — what they publish: each imports `@react-aria/i18n`,
 * and neither holds react-aria's own code for the context.
 * (`src/locale.dom.test.tsx` renders them under one provider.)
 */

import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

/** Where the UI packages sit, side by side. */
const PACKAGES = fileURLToPath(new URL('../../', import.meta.url));

/** The ES modules a package builds, by name. */
function built(pkg: string): { name: string; src: string }[] {
    const dist = join(PACKAGES, pkg, 'dist');
    return readdirSync(dist).filter((name) => name.endsWith('.js'))
        .map((name) => ({ name, src: readFileSync(join(dist, name), 'utf8') }));
}

/** An import of react-aria's i18n module — the one every package shares. */
const IMPORTS_I18N = /\bfrom\s*["']@react-aria\/i18n["']/u;
/** react-aria's own code for the context: where it is defined, bundled. */
const DEFINES_CONTEXT = /\bI18nContext\b/u;

for (const pkg of ['east-ui-components', 'e3-ui-components']) {
    test(`${pkg} imports react-aria's locale context, and bundles no copy of it`, () => {
        const modules = built(pkg);
        assert.ok(modules.length > 0, `${pkg} is built — its dist holds its modules`);
        assert.ok(modules.some((m) => IMPORTS_I18N.test(m.src)), `${pkg} reads the locale through @react-aria/i18n`);
        assert.deepEqual(modules.filter((m) => DEFINES_CONTEXT.test(m.src)).map((m) => m.name), []);
    });
}

test('the reader tells an import of the module from its bundled code', () => {
    assert.ok(IMPORTS_I18N.test('import { useLocale } from "@react-aria/i18n";'));
    assert.ok(IMPORTS_I18N.test("import{I18nProvider}from'@react-aria/i18n'"));
    assert.equal(IMPORTS_I18N.test('// see @react-aria/i18n'), false);
    assert.ok(DEFINES_CONTEXT.test('const $18f2051aff69b9bf$var$I18nContext = createContext(null);'));
    assert.equal(DEFINES_CONTEXT.test('const useI18nContextual = 1;'), false);
});
