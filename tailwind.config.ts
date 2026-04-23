import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Warm, curated boutique palette
        ivory: {
          50: '#fdfbf7',
          100: '#faf6ee',
          200: '#f2ead9',
          300: '#e8dcc2',
        },
        ink: {
          50: '#f5f3f0',
          200: '#d6d1c8',
          400: '#8a8275',
          600: '#4a4339',
          800: '#2a251e',
          900: '#1a1712',
        },
        clay: {
          300: '#d4a890',
          500: '#a8755a',
          700: '#7a4f3a',
        },
        sage: {
          300: '#b8c1a8',
          500: '#7d8a6a',
          700: '#545e45',
        },
      },
      fontFamily: {
        display: ['var(--font-display)', 'Georgia', 'serif'],
        sans: ['var(--font-sans)', 'system-ui', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      letterSpacing: {
        tightest: '-0.04em',
      },
      animation: {
        'fade-up': 'fade-up 0.6s ease-out',
        'fade-in': 'fade-in 0.4s ease-out',
      },
      keyframes: {
        'fade-up': {
          from: { opacity: '0', transform: 'translateY(8px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        'fade-in': {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },
      },
    },
  },
  plugins: [],
};

export default config;
