import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        pink: {
          50:  '#fef5f5',
          100: '#fde4e8',
          200: '#fbd0d8',
          300: '#f7a8be',
          400: '#f27aa0',
          500: '#ec2878',
          600: '#d41a67',
          700: '#b01456',
          800: '#880f42',
          900: '#5a0a2c',
        },
        ink: {
          50:  '#f7f0f3',
          200: '#d8c8d0',
          400: '#8a6e7a',
          600: '#5a3a46',
          800: '#3a1e2a',
          900: '#2a1a22',
        },
        cream: '#faf0e8',
        cheetah: {
          tan:  '#d4a574',
          spot: '#3a2416',
        },
      },
      fontFamily: {
        display: ['var(--font-display)', 'Playfair Display', 'Georgia', 'serif'],
        sans: ['var(--font-sans)', 'system-ui', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      letterSpacing: {
        tightest: '-0.04em',
        widest: '0.35em',
      },
      animation: {
        'fade-up': 'fade-up 0.6s ease-out',
        'fade-in': 'fade-in 0.4s ease-out',
        'shimmer': 'shimmer 2s ease-in-out infinite',
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
        'shimmer': {
          '0%, 100%': { opacity: '0.5' },
          '50%': { opacity: '1' },
        },
      },
      backgroundImage: {
        'cheetah': `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='80' height='80' viewBox='0 0 80 80'><g fill='%233a2416' fill-opacity='0.9'><ellipse cx='14' cy='12' rx='4' ry='3.2' transform='rotate(-15 14 12)'/><ellipse cx='42' cy='8' rx='3' ry='4'/><ellipse cx='64' cy='18' rx='4.5' ry='3' transform='rotate(25 64 18)'/><ellipse cx='10' cy='38' rx='3.5' ry='4.5' transform='rotate(-10 10 38)'/><ellipse cx='34' cy='42' rx='5' ry='3.5' transform='rotate(20 34 42)'/><ellipse cx='58' cy='48' rx='3' ry='4' transform='rotate(-20 58 48)'/><ellipse cx='18' cy='64' rx='4' ry='3' transform='rotate(15 18 64)'/><ellipse cx='48' cy='70' rx='3.5' ry='4' transform='rotate(-25 48 70)'/><ellipse cx='72' cy='60' rx='4' ry='3.5' transform='rotate(10 72 60)'/></g><g fill='%23d4a574' fill-opacity='0.45'><ellipse cx='14' cy='12' rx='6' ry='5' transform='rotate(-15 14 12)'/><ellipse cx='42' cy='8' rx='5' ry='6'/><ellipse cx='64' cy='18' rx='6.5' ry='5' transform='rotate(25 64 18)'/><ellipse cx='10' cy='38' rx='5.5' ry='6.5' transform='rotate(-10 10 38)'/><ellipse cx='34' cy='42' rx='7' ry='5.5' transform='rotate(20 34 42)'/><ellipse cx='58' cy='48' rx='5' ry='6' transform='rotate(-20 58 48)'/><ellipse cx='18' cy='64' rx='6' ry='5' transform='rotate(15 18 64)'/><ellipse cx='48' cy='70' rx='5.5' ry='6' transform='rotate(-25 48 70)'/><ellipse cx='72' cy='60' rx='6' ry='5.5' transform='rotate(10 72 60)'/></g></svg>")`,
      },
    },
  },
  plugins: [],
};

export default config;
