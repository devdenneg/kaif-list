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
        'slide-in-right': {
          from: { transform: 'translateX(100%)' },
          to: { transform: 'translateX(0)' },
        },
        'slide-in-bottom': {
          from: { transform: 'translateY(100%)' },
          to: { transform: 'translateY(0)' },
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
        'dialog-in': 'dialog-in 180ms cubic-bezier(0.16, 1, 0.3, 1)',
        'slide-in-right': 'slide-in-right 220ms cubic-bezier(0.16, 1, 0.3, 1)',
        'slide-in-bottom': 'slide-in-bottom 260ms cubic-bezier(0.16, 1, 0.3, 1)',
        'pulse-danger': 'pulse-danger 2s ease-in-out infinite',
      },
      boxShadow: {
        card: '0 1px 2px hsl(var(--shadow) / 0.06), 0 1px 3px hsl(var(--shadow) / 0.1)',
        'card-hover': '0 4px 12px hsl(var(--shadow) / 0.12), 0 2px 4px hsl(var(--shadow) / 0.08)',
        dragging: '0 12px 32px hsl(var(--shadow) / 0.22)',
        popover: '0 8px 30px hsl(var(--shadow) / 0.16)',
      },
      screens: {
        xs: '420px',
      },
    },
  },
  plugins: [],
} satisfies Config;
