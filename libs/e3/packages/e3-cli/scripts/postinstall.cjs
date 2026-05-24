/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * Postinstall hint for `npm install -g @elaraai/e3-cli`.
 *
 * Does NOT mutate the user's dotfiles. Just prints a one-liner pointing at
 * `e3 completion install` so they can opt in if they want tab completion.
 *
 * Silent in CI, on local (non-global) installs, and when E3_NO_HINT is set.
 */

'use strict';

if (process.env.CI) return;
if (process.env.E3_NO_HINT) return;
if (process.env.npm_config_global !== 'true') return;

process.stdout.write(
  '\n' +
  'e3 installed.\n' +
  'To enable tab completion: e3 completion install\n' +
  '\n',
);
