import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
// base: './' so relative asset paths work on GitHub Pages project sites AND in the deploy preview iframe.
// (Hash routing means only asset paths matter, so './' is safe for the /YCH-Physio-Roster-Planner/ subpath.)
export default defineConfig({
  plugins: [react()],
  base: './',
})
