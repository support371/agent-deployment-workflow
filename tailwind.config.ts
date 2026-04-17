import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // GEM Enterprise design tokens
        bg: {
          base: '#0a0b0d',
          panel: '#0f1114',
          elevated: '#141720',
          border: '#1e222b',
        },
        teal: {
          DEFAULT: '#00c9a0',
          dim: '#00a386',
          glow: 'rgba(0, 201, 160, 0.15)',
        },
        fg: {
          primary: '#e6e8ec',
          secondary: '#9096a1',
          muted: '#5a616e',
        },
        status: {
          ok: '#00c9a0',
          warn: '#f5b544',
          err: '#ff5c7a',
          info: '#5aa9ff',
        },
      },
      fontFamily: {
        sans: ['"DM Sans"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        display: ['Syne', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
      fontSize: {
        '2xs': '0.6875rem',
      },
      boxShadow: {
        glow: '0 0 0 1px rgba(0, 201, 160, 0.35), 0 0 24px rgba(0, 201, 160, 0.15)',
      },
    },
  },
  plugins: [],
};

export default config;
