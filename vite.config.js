import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
// base: './' so it works on GitHub Pages project sites AND in deploy_website iframe
export default defineConfig({
  plugins: [react()],
  base: './',
})
