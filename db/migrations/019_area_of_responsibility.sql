-- Areas of Responsibility (AOR): what a staff member or student is responsible for.
--   Student AOR (lookup STUDENT_AOR, e.g. Class Incharge): per academic year, dates inside the year
--   Staff AOR   (lookup STAFF_AOR,   e.g. Staff Representative): date based
insert into lookup_type (lookup_type, meaning, description, module_code, access_level, created_by)
select v.t, v.m, v.d, v.mod, 'EXTENSIBLE', 'MIGRATION'
from (values ('STUDENT_AOR', 'Student Area of Responsibility', 'Responsibilities given to students for an academic year (Student profile › Responsibilities).', 'ACADEMIC'),
             ('STAFF_AOR', 'Staff Area of Responsibility', 'Responsibilities given to staff members, date based (Staff profile › Responsibilities). Usable as approvers.', 'WORKFORCE')) v(t, m, d, mod)
where not exists (select 1 from lookup_type x where x.lookup_type = v.t);
insert into lookup_value (lookup_type, lookup_code, meaning, display_seq, system_flag, created_by)
select v.t, v.c, v.m, 10, 'Y', 'MIGRATION'
from (values ('STUDENT_AOR', 'CLASS_INCHARGE', 'Class Incharge'), ('STAFF_AOR', 'STAFF_REP', 'Staff Representative')) v(t, c, m)
where exists (select 1 from lookup_type where lookup_type = v.t)
  and not exists (select 1 from lookup_value x where x.lookup_type = v.t and x.lookup_code = v.c);

create table if not exists area_of_responsibility (
  id               bigint primary key default nextval('erp_id_seq'),
  enterprise_id    bigint not null references enterprise(id),
  person_id        bigint not null references person(id) on delete cascade,
  person_category  text not null,                      -- STUDENT / STAFF
  aor_type_code    text not null,                      -- STUDENT_AOR / STAFF_AOR lookup code
  academic_year_id bigint references academic_year(id), -- students only
  start_date       date not null,
  end_date         date not null default date '4712-12-31',
  remarks          text,
  created_by text, creation_date timestamptz not null default now(),
  last_updated_by text, last_update_date timestamptz not null default now(),
  check (end_date >= start_date),
  check (person_category <> 'STUDENT' or academic_year_id is not null)
);
create index if not exists aor_person_idx on area_of_responsibility(person_id);
create index if not exists aor_type_idx on area_of_responsibility(aor_type_code, start_date, end_date);
