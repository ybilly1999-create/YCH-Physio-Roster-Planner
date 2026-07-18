/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ['class'],
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        bg: 'hsl(var(--bg))',
        surface: 'hsl(var(--surface))',
        border: 'hsl(var(--border))',
        text: 'hsl(var(--text))',
        muted: 'hsl(var(--muted))',
        primary: 'hsl(var(--primary))',
        'primary-hover': 'hsl(var(--primary-hover))',
        navy: 'hsl(var(--navy))',
      },
      fontFamily: { sans: ['Inter', 'system-ui', 'sans-serif'] },
    },
  },
  plugins: [],
}
