/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        forest: {
          50:  '#F0F6F2',
          100: '#D9E8DE',
          200: '#B3D1BD',
          300: '#7FB293',
          400: '#4F8E6C',
          500: '#2C6B47', // primary
          600: '#235638',
          700: '#1B4029',
          800: '#142D1D',
          900: '#0B1A11',
        },
        harvest: {
          50:  '#FEF7E1',
          100: '#FCEDB7',
          200: '#F8DE7E',
          300: '#F3CB44',
          400: '#E0A82E', // accent
          500: '#B98724',
          600: '#8C661C',
          700: '#5F4513',
          800: '#3A2A0B',
          900: '#1D1505',
        },
        clay:    '#9B6A4C',
        bone:    '#F5F4EE',
        ink:     '#1F2A24',
        smoke:   '#6B7370',
        whisper: '#E8E5D9',
      },
      fontFamily: {
        display: ['"Fraunces"', 'Georgia', 'serif'],
        sans:    ['"DM Sans"', 'system-ui', 'sans-serif'],
        mono:    ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
      boxShadow: {
        card: '0 1px 2px rgba(31, 42, 36, 0.04), 0 4px 12px rgba(31, 42, 36, 0.04)',
        elev: '0 10px 40px -10px rgba(31, 42, 36, 0.16)',
      },
      animation: {
        'fade-in': 'fadeIn 0.4s ease-out',
        'slide-up': 'slideUp 0.5s ease-out',
      },
      keyframes: {
        fadeIn: { '0%': { opacity: 0 }, '100%': { opacity: 1 } },
        slideUp: { '0%': { opacity: 0, transform: 'translateY(8px)' }, '100%': { opacity: 1, transform: 'translateY(0)' } },
      },
    },
  },
  plugins: [],
};
