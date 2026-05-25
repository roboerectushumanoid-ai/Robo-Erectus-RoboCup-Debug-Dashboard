import { FIELD_H_MM, FIELD_W_MM } from './constants.js';

export function zoneCenterMm(zone) {
  if (!zone || zone < 1 || zone > 9) return null;
  const idx = zone - 1;
  const col = Math.floor(idx / 3);
  const rowFromTop = idx % 3;

  return {
    x: -FIELD_W_MM / 2 + FIELD_W_MM * (col + 0.5) / 3,
    y:  FIELD_H_MM / 2 - FIELD_H_MM * (rowFromTop + 0.5) / 3,
  };
}

export function fmtN(v, dec) {
  if (v === undefined || v === null || (typeof v === 'number' && isNaN(v))) return '–';
  return typeof v === 'number' ? v.toFixed(dec ?? 0) : String(v);
}

export function fmtTime(s) {
  if (s == null) return '–:––';
  const neg = s < 0;
  const abs = Math.abs(s);
  return `${neg ? '-' : ''}${Math.floor(abs / 60)}:${String(abs % 60).padStart(2, '0')}`;
}

export function confColor(pct) {
  const g = pct > 50 ? 185 : Math.round(185 * pct / 50);
  const rv = pct < 50 ? 255 : Math.round(255 * (1 - (pct - 50) / 50));
  return `rgb(${rv},${g},50)`;
}
