const raw = import.meta.env.VITE_API_URL;
export const API_URL =
  raw === undefined || raw === null || raw === ''
    ? import.meta.env.DEV
      ? 'http://localhost:3000'
      : ''
    : String(raw).replace(/\/$/, '');
