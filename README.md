# YCH Physio Dept — Roster Web App

仁濟醫院物理治療部排更系統。獨立專案。
Stack: React + Vite + Tailwind (frontend / GitHub Pages) · Google Apps Script Web App (backend) · Google Sheet (database).

## Quick start
1. See **DEPLOY.md** for full setup (Sheet + Apps Script + GitHub Pages).
2. Edit `src/lib/config.js` with your Apps Script `/exec` URL and Sheet ID.
3. `npm install && npm run build` → deploy `dist/` to GitHub Pages.

Tokens: admin `ychphysioadmin` / staff `ychphysio` (set in Apps Script Script Properties).

## Backend
`Code.gs` — paste into the Sheet's Apps Script editor and deploy as a Web App.
