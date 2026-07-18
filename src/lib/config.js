// ---- YCH Physio Roster config ----
// After deploying Code.gs as a Web App, paste the /exec URL here (or set VITE_API_URL).
export const API_URL = import.meta.env.VITE_API_URL ||
  'https://script.google.com/macros/s/AKfycbxnWLmAjn5oYoO_5en3me4SJbuxiJdQkDZj5r9n-SCl7cNuO1UBiELkQv3C4hwMyiaxBg/exec';

// Google Sheet ID (for fast direct gviz reads). Public "anyone with link can view".
export const SHEET_ID = import.meta.env.VITE_SHEET_ID ||
  '1HOvnstH5k8r1sJNI7cZtWLpcubuPFLp9ebc9GD7-We8';

// Calendar colour spec (staff-name background)
export const COLORS = {
  confirmed: { bg: '#C6EFCE', fg: '#14532d', label: '' },
  sick:      { bg: '#FFD6E7', fg: '#831843', label: 'Sick' },
  substitute:{ bg: '#BDD7EE', fg: '#1e3a5f', label: 'SL roster' },
  shs:       { bg: '#FF0000', fg: '#ffffff', label: 'SHS' },
  opd:       { bg: '#FCE4D6', fg: '#7c2d12', label: 'OPD' },
  unconfirmed:{ bg: '#D9D9D9', fg: '#374151', label: '' },
};
