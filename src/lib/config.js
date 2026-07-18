// ---- YCH Physio Roster config ----
// After deploying Code.gs as a Web App, paste the /exec URL here (or set VITE_API_URL).
export const API_URL = import.meta.env.VITE_API_URL ||
  'https://script.google.com/macros/s/PASTE_YOUR_DEPLOYMENT_ID/exec';

// Google Sheet ID (for fast direct gviz reads). Public "anyone with link can view".
export const SHEET_ID = import.meta.env.VITE_SHEET_ID ||
  '1w6T9akUXB5b-TiUDBb_LzhWcUCeF4GT5ICaZ_4eg8Z8';

// Calendar colour spec (staff-name background)
export const COLORS = {
  confirmed: { bg: '#C6EFCE', fg: '#14532d', label: '' },
  sick:      { bg: '#FFD6E7', fg: '#831843', label: 'Sick' },
  substitute:{ bg: '#BDD7EE', fg: '#1e3a5f', label: 'SL roster' },
  shs:       { bg: '#FF0000', fg: '#ffffff', label: 'SHS' },
  opd:       { bg: '#FCE4D6', fg: '#7c2d12', label: 'OPD' },
  unconfirmed:{ bg: '#D9D9D9', fg: '#374151', label: '' },
};
