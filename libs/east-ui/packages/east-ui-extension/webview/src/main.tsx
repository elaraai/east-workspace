/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import React from 'react';
import ReactDOM from 'react-dom/client';
import '@elaraai/east-ui-components/fonts';
import { App } from './App';
import { applyTheme, resolveInitialTheme } from './theme-mode';

// Stamp the colour mode before first paint (default: VS Code's active theme) so
// there's no light-then-dark flash.
applyTheme(resolveInitialTheme());

ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
        <App />
    </React.StrictMode>
);
