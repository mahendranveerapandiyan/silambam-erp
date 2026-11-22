-- New default look: sky blue, white and black
insert into ui_setting (enterprise_id, setting_key, setting_value, last_updated_by)
select e.id, v.k, v.v, 'MIGRATION' from enterprise e cross join (values
  ('header_bg', '#ffffff'), ('header_text', '#0f172a'), ('sidebar_bg', '#0b0f19'), ('sidebar_text', '#e2e8f0'),
  ('body_bg', '#eef2f7'), ('card_bg', '#ffffff'), ('text_color', '#0f172a'), ('primary_color', '#0284c7'),
  ('accent_color', '#0ea5e9'), ('font_family', 'Inter, system-ui, sans-serif')) as v(k, v)
on conflict (enterprise_id, setting_key) do update set setting_value = excluded.setting_value, last_updated_by = 'MIGRATION', last_update_date = now();
