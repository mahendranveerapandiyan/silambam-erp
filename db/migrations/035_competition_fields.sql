-- Students: competition category on the assignment; weight and height in personal details.
alter table assignment_f add column if not exists competition_category_code text;   -- COMPETITION_CATEGORY: OPEN / SCHOOL
alter table person_f add column if not exists weight_kg numeric(6,2);
alter table person_f add column if not exists height_cm numeric(6,2);
insert into lookup_type (lookup_type, meaning, description, module_code, access_level, created_by)
select 'COMPETITION_CATEGORY', 'Competition Category', 'Open or school competitions a student takes part in.', 'STUDENTS', 'USER', 'MIGRATION'
where not exists (select 1 from lookup_type where lookup_type = 'COMPETITION_CATEGORY');
insert into lookup_value (lookup_type, lookup_code, meaning, display_seq, created_by)
select 'COMPETITION_CATEGORY', v.c, v.m, v.s, 'MIGRATION' from (values ('OPEN', 'Open', 10), ('SCHOOL', 'School', 20)) v(c, m, s)
where not exists (select 1 from lookup_value x where x.lookup_type = 'COMPETITION_CATEGORY' and x.lookup_code = v.c);
