/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 */

import { createSystem, defaultConfig } from '@chakra-ui/react';

export const system = createSystem(defaultConfig, {
  theme: {
    tokens: {
      fonts: {
        heading: { value: 'Sailec, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif' },
        body: { value: 'Sailec, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif' },
      },
      fontSizes: {
        '2xs': { value: '0.625rem' },
        xs: { value: '0.75rem' },
        sm: { value: '0.875rem' },
        md: { value: '1rem' },
        lg: { value: '1.125rem' },
        xl: { value: '1.25rem' },
        '2xl': { value: '1.5rem' },
        '3xl': { value: '1.875rem' },
        '4xl': { value: '2.25rem' },
        '5xl': { value: '3rem' },
      },
      fontWeights: {
        thin: { value: 100 },
        light: { value: 300 },
        normal: { value: 400 },
        medium: { value: 500 },
        semibold: { value: 600 },
        bold: { value: 700 },
        extrabold: { value: 800 },
        black: { value: 900 },
      },
      lineHeights: {
        none: { value: '1' },
        tight: { value: '1.25' },
        snug: { value: '1.375' },
        normal: { value: '1.5' },
        relaxed: { value: '1.625' },
        loose: { value: '2' },
      },
      durations: {
        'ultra-fast': { value: '50ms' },
        faster: { value: '100ms' },
        fast: { value: '150ms' },
        normal: { value: '200ms' },
        slow: { value: '300ms' },
        slower: { value: '500ms' },
        'ultra-slow': { value: '1000ms' },
      },
      easings: {
        'ease-in': { value: 'cubic-bezier(0.4, 0, 1, 1)' },
        'ease-out': { value: 'cubic-bezier(0, 0, 0.2, 1)' },
        'ease-in-out': { value: 'cubic-bezier(0.4, 0, 0.2, 1)' },
      },
      colors: {
        brand: {
          50: { value: '#f0fffe' },
          100: { value: '#c2fcfc' },
          200: { value: '#94f9f9' },
          300: { value: '#79f8f8' },
          400: { value: '#5ce5e5' },
          500: { value: '#488e97' },
          600: { value: '#3a7780' },
          700: { value: '#2b4b55' },
          800: { value: '#1f363d' },
          900: { value: '#111b22' },
        },
        gray: {
          50: { value: '#f8fafa' },
          100: { value: '#f1f5f5' },
          200: { value: '#e2e8e8' },
          300: { value: '#cbd5d5' },
          400: { value: '#9bb0b0' },
          500: { value: '#6b8080' },
          600: { value: '#4a5f5f' },
          700: { value: '#374848' },
          800: { value: '#253333' },
          900: { value: '#1a2626' },
        },
        red: {
          50: { value: '#fef2f2' },
          100: { value: '#fee2e2' },
          200: { value: '#fecaca' },
          300: { value: '#fca5a5' },
          400: { value: '#f87171' },
          500: { value: '#ef4444' },
          600: { value: '#dc2626' },
          700: { value: '#b91c1c' },
          800: { value: '#991b1b' },
          900: { value: '#7f1d1d' },
        },
        orange: {
          50: { value: '#fff7ed' },
          100: { value: '#ffedd5' },
          200: { value: '#fed7aa' },
          300: { value: '#fdba74' },
          400: { value: '#fb923c' },
          500: { value: '#f97316' },
          600: { value: '#ea580c' },
          700: { value: '#c2410c' },
          800: { value: '#9a3412' },
          900: { value: '#7c2d12' },
        },
        green: {
          50: { value: '#f0fdf4' },
          100: { value: '#dcfce7' },
          200: { value: '#bbf7d0' },
          300: { value: '#86efac' },
          400: { value: '#4ade80' },
          500: { value: '#22c55e' },
          600: { value: '#16a34a' },
          700: { value: '#15803d' },
          800: { value: '#166534' },
          900: { value: '#14532d' },
        },
        blue: {
          50: { value: '#f0f9ff' },
          100: { value: '#e0f2fe' },
          200: { value: '#bae6fd' },
          300: { value: '#7dd3fc' },
          400: { value: '#38bdf8' },
          500: { value: '#0ea5e9' },
          600: { value: '#0284c7' },
          700: { value: '#0369a1' },
          800: { value: '#075985' },
          900: { value: '#0c4a6e' },
        },
      },
      shadows: {
        xs: { value: '0 1px 2px 0 rgba(0, 0, 0, 0.05)' },
        sm: { value: '0 1px 3px 0 rgba(0, 0, 0, 0.1), 0 1px 2px 0 rgba(0, 0, 0, 0.06)' },
        md: { value: '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)' },
        lg: { value: '0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)' },
        xl: { value: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)' },
      },
    },
    semanticTokens: {
      colors: {
        'bg.primary': {
          value: { base: '{colors.white}', _dark: '{colors.gray.900}' },
        },
        'bg.secondary': {
          value: { base: '{colors.gray.50}', _dark: '{colors.gray.800}' },
        },
        'bg.tertiary': {
          value: { base: '{colors.gray.100}', _dark: '{colors.gray.700}' },
        },
        'bg.hover': {
          value: { base: '{colors.gray.100}', _dark: '{colors.gray.700}' },
        },
        'bg.muted': {
          value: { base: '{colors.gray.100}', _dark: '{colors.gray.800}' },
        },
        'text.primary': {
          value: { base: '{colors.gray.900}', _dark: '{colors.gray.100}' },
        },
        'text.secondary': {
          value: { base: '{colors.gray.600}', _dark: '{colors.gray.400}' },
        },
        'text.tertiary': {
          value: { base: '{colors.gray.500}', _dark: '{colors.gray.500}' },
        },
        'text.disabled': {
          value: { base: '{colors.gray.400}', _dark: '{colors.gray.500}' },
        },
        'text.muted': {
          value: { base: '{colors.gray.500}', _dark: '{colors.gray.400}' },
        },
        'border.primary': {
          value: { base: '{colors.gray.200}', _dark: '{colors.gray.600}' },
        },
        'border.secondary': {
          value: { base: '{colors.gray.100}', _dark: '{colors.gray.700}' },
        },
        'border.hover': {
          value: { base: '{colors.gray.300}', _dark: '{colors.gray.500}' },
        },
        'card.bg': {
          value: { base: '{colors.white}', _dark: '{colors.gray.800}' },
        },
        'card.hover': {
          value: { base: '{colors.gray.50}', _dark: '{colors.gray.700}' },
        },
        'input.bg': {
          value: { base: '{colors.white}', _dark: '{colors.gray.700}' },
        },
        'input.border': {
          value: { base: '{colors.gray.200}', _dark: '{colors.gray.600}' },
        },
        'input.focus': {
          value: { base: '{colors.brand.500}', _dark: '{colors.brand.400}' },
        },
        'table.bg': {
          value: { base: '{colors.white}', _dark: '{colors.gray.800}' },
        },
        'table.header': {
          value: { base: '{colors.gray.50}', _dark: '{colors.gray.700}' },
        },
        'table.stripe': {
          value: { base: '{colors.gray.50}', _dark: '{colors.gray.800}' },
        },
        'modal.bg': {
          value: { base: '{colors.white}', _dark: '{colors.gray.800}' },
        },
        'overlay.bg': {
          value: { base: 'rgba(0, 0, 0, 0.6)', _dark: 'rgba(0, 0, 0, 0.8)' },
        },
        'scrollbar.thumb': {
          value: { base: '{colors.gray.300}', _dark: '{colors.gray.600}' },
        },
        'scrollbar.thumb.hover': {
          value: { base: '{colors.gray.400}', _dark: '{colors.gray.500}' },
        },
        'link.color': {
          value: { base: '{colors.brand.700}', _dark: '{colors.brand.500}' },
        },
        'link.hover': {
          value: { base: '{colors.brand.800}', _dark: '{colors.brand.400}' },
        },
        'nav.active.bg': {
          value: { base: '{colors.gray.100}', _dark: '{colors.gray.800}' },
        },
        'nav.active.color': {
          value: { base: '{colors.brand.700}', _dark: '{colors.brand.300}' },
        },
        'nav.active.border': {
          value: { base: '{colors.brand.500}', _dark: '{colors.brand.400}' },
        },
        'nav.hover.bg': {
          value: { base: '{colors.gray.100}', _dark: '{colors.gray.700}' },
        },
        'status.error.bg': {
          value: { base: '{colors.red.50}', _dark: '{colors.red.900}' },
        },
        'status.error.border': {
          value: { base: '{colors.red.200}', _dark: '{colors.red.700}' },
        },
        'status.warn.bg': {
          value: { base: '{colors.orange.50}', _dark: '{colors.orange.900}' },
        },
        'status.warn.border': {
          value: { base: '{colors.orange.200}', _dark: '{colors.orange.700}' },
        },
        'status.info.bg': {
          value: { base: '{colors.brand.50}', _dark: '{colors.brand.900}' },
        },
        'status.info.border': {
          value: { base: '{colors.brand.200}', _dark: '{colors.brand.700}' },
        },
      },
    },
  },
  globalCss: {
    'html, body': {
      height: '100%',
      fontFamily: 'body',
    },
    '#root': {
      height: '100%',
    },
  },
});
