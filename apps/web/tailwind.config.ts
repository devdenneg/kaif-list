import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Config } from 'tailwindcss';

// Абсолютные пути: Tailwind ищет исходники относительно рабочего каталога,
// а сборка может запускаться из корня монорепозитория.
const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * Все цвета — через CSS-переменные, поэтому тёмная тема не требует
 * дублирования классов и переключается мгновенно, без перерисовки дерева.
 */
export default {
  darkMode: 'class',
  content: [path.join(here, 'index.html'), path.join(here, 'src/**/*.{ts,tsx}')],
  theme: {
    extend: {
      colors: {
        background: 'hsl(var(--background) / <alpha-value>)',
        foreground: 'hsl(var(--foreground) / <alpha-value>)',
        card: {
          DEFAULT: 'hsl(var(--card) / <alpha-value>)',
          foreground: 'hsl(var(--card-foreground) / <alpha-value>)',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover) / <alpha-value>)',
          foreground: 'hsl(var(--popover-foreground) / <alpha-value>)',
        },
        primary: {
          DEFAULT: 'hsl(var(--primary) / <alpha-value>)',
          foreground: 'hsl(var(--primary-foreground) / <alpha-value>)',
          hover: 'hsl(var(--primary-hover) / <alpha-value>)',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary) / <alpha-value>)',
          foreground: 'hsl(var(--secondary-foreground) / <alpha-value>)',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted) / <alpha-value>)',
          foreground: 'hsl(var(--muted-foreground) / <alpha-value>)',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent) / <alpha-value>)',
          foreground: 'hsl(var(--accent-foreground) / <alpha-value>)',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive) / <alpha-value>)',
          foreground: 'hsl(var(--destructive-foreground) / <alpha-value>)',
        },
        success: {
          DEFAULT: 'hsl(var(--success) / <alpha-value>)',
          foreground: 'hsl(var(--success-foreground) / <alpha-value>)',
        },
        warning: {
          DEFAULT: 'hsl(var(--warning) / <alpha-value>)',
          foreground: 'hsl(var(--warning-foreground) / <alpha-value>)',
        },
        border: 'hsl(var(--border) / <alpha-value>)',
        input: 'hsl(var(--input) / <alpha-value>)',
        ring: 'hsl(var(--ring) / <alpha-value>)',
        surface: 'hsl(var(--surface) / <alpha-value>)',
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
        mono: ['JetBrains Mono', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      keyframes: {
        'fade-in': { from: { opacity: '0' }, to: { opacity: '1' } },
        'slide-up': {
          from: { transform: 'translateY(8px)', opacity: '0' },
          to: { transform: 'translateY(0)', opacity: '1' },
        },
        'dialog-in': {
          from: {
            transform: 'translate(-50%, calc(-50% + 8px)) scale(0.98)',
            opacity: '0',
          },
          to: { transform: 'translate(-50%, -50%) scale(1)', opacity: '1' },
        },
        'dialog-out': {
          from: { transform: 'translate(-50%, -50%) scale(1)', opacity: '1' },
          to: {
            transform: 'translate(-50%, calc(-50% + 6px)) scale(0.98)',
            opacity: '0',
          },
        },
        'overlay-in': { from: { opacity: '0' }, to: { opacity: '1' } },
        'overlay-out': { from: { opacity: '1' }, to: { opacity: '0' } },
        'floating-in': {
          from: {
            transform:
              'translate3d(var(--kaif-floating-x, 0), var(--kaif-floating-y, -4px), 0) scale(0.98)',
            opacity: '0',
          },
          to: { transform: 'translate3d(0, 0, 0) scale(1)', opacity: '1' },
        },
        'floating-out': {
          from: { transform: 'translate3d(0, 0, 0) scale(1)', opacity: '1' },
          to: {
            transform:
              'translate3d(var(--kaif-floating-x, 0), var(--kaif-floating-y, -4px), 0) scale(0.98)',
            opacity: '0',
          },
        },
        'sheet-in-right': {
          from: { transform: 'translateX(100%)', opacity: '0.92' },
          to: { transform: 'translateX(0)', opacity: '1' },
        },
        'sheet-out-right': {
          from: { transform: 'translateX(0)', opacity: '1' },
          to: { transform: 'translateX(100%)', opacity: '0.92' },
        },
        'sheet-in-left': {
          from: { transform: 'translateX(-100%)', opacity: '0.92' },
          to: { transform: 'translateX(0)', opacity: '1' },
        },
        'sheet-out-left': {
          from: { transform: 'translateX(0)', opacity: '1' },
          to: { transform: 'translateX(-100%)', opacity: '0.92' },
        },
        'sheet-in-bottom': {
          from: { transform: 'translateY(100%)' },
          to: { transform: 'translateY(0)' },
        },
        'sheet-out-bottom': {
          from: { transform: 'translateY(0)' },
          to: { transform: 'translateY(100%)' },
        },
        'pulse-danger': {
          '0%, 100%': { boxShadow: '0 0 0 0 hsl(var(--destructive) / 0.45)' },
          '50%': { boxShadow: '0 0 0 6px hsl(var(--destructive) / 0)' },
        },
        shimmer: {
          '100%': { transform: 'translateX(100%)' },
        },
      },
      animation: {
        'fade-in': 'fade-in 150ms ease-out',
        'slide-up': 'slide-up 180ms cubic-bezier(0.16, 1, 0.3, 1)',
        'dialog-in': 'dialog-in 180ms cubic-bezier(0.16, 1, 0.3, 1) both',
        'dialog-out': 'dialog-out 140ms cubic-bezier(0.4, 0, 1, 1) both',
        'overlay-in': 'overlay-in 180ms ease-out both',
        'overlay-out': 'overlay-out 140ms ease-in both',
        'floating-in': 'floating-in 160ms cubic-bezier(0.16, 1, 0.3, 1) both',
        'floating-out': 'floating-out 140ms cubic-bezier(0.4, 0, 1, 1) both',
        'sheet-in-right': 'sheet-in-right 200ms cubic-bezier(0.16, 1, 0.3, 1) both',
        'sheet-out-right': 'sheet-out-right 160ms cubic-bezier(0.4, 0, 1, 1) both',
        'sheet-in-left': 'sheet-in-left 200ms cubic-bezier(0.16, 1, 0.3, 1) both',
        'sheet-out-left': 'sheet-out-left 160ms cubic-bezier(0.4, 0, 1, 1) both',
        'sheet-in-bottom': 'sheet-in-bottom 220ms cubic-bezier(0.16, 1, 0.3, 1) both',
        'sheet-out-bottom': 'sheet-out-bottom 180ms cubic-bezier(0.4, 0, 1, 1) both',
        'pulse-danger': 'pulse-danger 2s ease-in-out infinite',
      },
      boxShadow: {
        card: 'var(--shadow-card)',
        'card-hover': 'var(--shadow-card-hover)',
        dragging: '0 12px 32px hsl(var(--shadow) / 0.22)',
        popover: 'var(--shadow-popover)',
      },
      screens: {
        xs: '420px',
      },
    },
  },
  plugins: [],
} satisfies Config;
