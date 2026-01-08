/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 */

import React from 'react';
import ReactDOM from 'react-dom/client';
import { ChakraProvider, defaultSystem } from '@chakra-ui/react';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App';

declare global {
  interface Window {
    __E3_TENANT__: string | null;
    __E3_BASE__: string;
  }
}

const basename = window.__E3_BASE__ || '';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ChakraProvider value={defaultSystem}>
      <BrowserRouter basename={basename}>
        <App />
      </BrowserRouter>
    </ChakraProvider>
  </React.StrictMode>
);
