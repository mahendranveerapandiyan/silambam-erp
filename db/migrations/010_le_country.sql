-- Legal employers have a country; identification types offered on hire /
-- admission follow it (Identification Type tag: +IN, -US ...).
alter table legal_employer_f add column if not exists country_code text;
update legal_employer_f lf set country_code = coalesce(
    (select l.country_code from location_f l where l.id = lf.location_id and l.country_code is not null order by l.effective_start_date desc limit 1),
    (select e.country_code from legal_employer b join enterprise e on e.id = b.enterprise_id where b.id = lf.id),
    'IN')
where country_code is null;
update lookup_type set description = 'Tag = countries where the type is offered, by the country of the legal employer the person is hired under: empty = all, "+IN, +US" = only these, "-US" = all except these (codes from the Country lookup). Format Rule = optional regular expression for the number.'
where lookup_type = 'IDENTIFICATION_TYPE';
-- number format rules are not used
update lookup_value set format_rule = null where lookup_type = 'IDENTIFICATION_TYPE';
update lookup_type set description = 'Tag = countries where the type is offered, by the country of the legal employer the person is hired under: empty = all, "+IN, +US" = only these, "-US" = all except these (codes from the Country lookup).'
where lookup_type = 'IDENTIFICATION_TYPE';
