-- Identification Type: Tag = country visibility (+IN, +US / -US); the number
-- format moves to its own column.
alter table lookup_value add column if not exists format_rule text;
update lookup_value set format_rule = tag,
  tag = case when lookup_code in ('AADHAAR', 'PAN', 'VOTER_ID') then '+IN' else null end
where lookup_type = 'IDENTIFICATION_TYPE' and tag like '^%';
update lookup_type set description = 'Tag = countries where the type is offered: empty = all, "+IN, +US" = only these, "-US" = all except these (codes from the Country lookup). Format Rule = optional regular expression for the number.'
where lookup_type = 'IDENTIFICATION_TYPE';
-- passports are offered for every country, so the Indian-only number format is removed
update lookup_value set format_rule = null, description = 'Any country'
where lookup_type = 'IDENTIFICATION_TYPE' and lookup_code = 'PASSPORT' and format_rule = '^[A-Z][0-9]{7}$';
