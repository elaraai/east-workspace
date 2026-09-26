/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * Side-effect module: the built showcase builds its East functions without
 * capturing source locations (#834). `main.tsx` imports it first, so it runs
 * before any module that builds East, the component libraries and every
 * example the catalog imports included.
 *
 * The showcase builds every example's IR while the page loads, and East
 * reads a `new Error().stack` for each expression node to record where it was
 * written: 81,937 captures per load. In the production bundle each of them
 * comes out empty, because East shares the bundle's directory with the
 * examples and its own-module filter drops every frame. So the capture is
 * pure cost, and with an inspector attached (DevTools, or Playwright in the
 * responsive suite) V8 walks up to 200 frames for every Error. That made a
 * page load take 15 s where it takes about 1 s without.
 *
 * The dev server serves East apart from the example sources, where the
 * locations do name the example files, so capture stays on there.
 *
 * @packageDocumentation
 */

import { setLocationCapture } from "@elaraai/east";

if (import.meta.env.PROD) setLocationCapture(false);
