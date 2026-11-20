import 'server-only';
import { sql } from './db';

export const THEME_KEYS: [string, string, 'color' | 'number' | 'text'][] = [
  ['header_bg', 'Header Background', 'color'],
  ['header_text', 'Header Text', 'color'],
  ['sidebar_bg', 'Menu Background', 'color'],
  ['sidebar_text', 'Menu Text', 'color'],
  ['body_bg', 'Body Background', 'color'],
  ['card_bg', 'Card / Panel Background', 'color'],
  ['text_color', 'Text Colour', 'color'],
  ['primary_color', 'Primary / Button Colour', 'color'],
  ['font_size', 'Base Font Size (px)', 'number'],
  ['font_family', 'Font Family', 'text'],
];

export async function getTheme(enterpriseId?: string | null) {
  const rows = enterpriseId
    ? await sql`select setting_key, setting_value from ui_setting where enterprise_id = ${enterpriseId}`
    : await sql`select setting_key, setting_value from ui_setting where enterprise_id = (select min(id) from enterprise)`;
  return Object.fromEntries(rows.map((r) => [r.setting_key, r.setting_value])) as Record<string, string>;
}

export function themeStyle(t: Record<string, string>): string {
  const css: string[] = [];
  for (const [k] of THEME_KEYS) {
    if (!t[k]) continue;
    const v = k === 'font_size' ? `${Number(t[k]) || 14}px` : t[k].replace(/[;{}<>]/g, '');
    css.push(`--${k.replace(/_/g, '-').replace('-color', '-color')}: ${v};`);
  }
  return `:root{${css.join('')}}`;
}

export async function enterpriseInfo(enterpriseId?: string | null) {
  const [e] = enterpriseId
    ? await sql`select id, name, short_name, currency_code, logo_data is not null as has_logo from enterprise where id = ${enterpriseId}`
    : await sql`select id, name, short_name, currency_code, logo_data is not null as has_logo from enterprise order by id limit 1`;
  return e;
}
