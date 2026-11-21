-- =====================================================================
-- Roles & privileges, additional fields, class duration, position
-- hierarchy, action reasons per action
-- =====================================================================

-- Roles and privileges ----------------------------------------------------
create table if not exists privilege (
  code        text primary key,               -- e.g. CD_LOCATION_PRV
  name        text not null,
  module      text not null,
  description text,
  display_seq int not null default 0
);
create table if not exists app_role (
  code        text primary key,               -- e.g. ADMIN, INCHARGE
  name        text not null,
  description text,
  system_flag text not null default 'N',      -- built-in roles cannot be deleted
  landing     text,                           -- optional landing page
  active_flag text not null default 'Y',
  created_by text, creation_date timestamptz not null default now(),
  last_updated_by text, last_update_date timestamptz not null default now()
);
create table if not exists role_privilege (
  role_code      text not null references app_role(code) on delete cascade,
  privilege_code text not null references privilege(code) on delete cascade,
  can_view  text not null default 'Y',
  can_read  text not null default 'N',
  can_write text not null default 'N',
  primary key (role_code, privilege_code)
);
insert into app_role (code, name, description, system_flag) values
  ('ADMIN', 'Administrator', 'Full access to every task', 'Y'),
  ('INCHARGE', 'Class Incharge', 'Attendance, fees, exams and events for own classes', 'Y'),
  ('STAFF', 'Staff', 'Own profile, QR and attendance', 'Y'),
  ('ACCOUNTANT', 'Accountant', 'Fees, inventory and finance for all branches', 'Y'),
  ('PARENT', 'Parent / Guardian', 'Portal for linked students', 'Y'),
  ('STUDENT', 'Student', 'Own portal', 'Y')
on conflict (code) do nothing;
-- user_role.role_code now points at app_role
do $$ begin
  alter table user_role add constraint user_role_role_fk foreign key (role_code) references app_role(code) on update cascade;
exception when duplicate_object then null; end $$;

-- Additional (user-defined) fields ---------------------------------------
create table if not exists additional_field (
  id            bigint primary key default nextval('erp_id_seq'),
  enterprise_id bigint not null references enterprise(id),
  context_code  text not null,                -- 'setup:<entity>', 'STUDENT', 'STAFF'
  field_code    text not null,
  label         text not null,
  data_type     text not null,                -- TEXT, NUMBER, DATE, YESNO, LOOKUP
  lookup_type   text references lookup_type(lookup_type),
  required_flag text not null default 'N',
  active_flag   text not null default 'Y',
  display_seq   int not null default 0,
  help_text     text,
  created_by text, creation_date timestamptz not null default now(),
  last_updated_by text, last_update_date timestamptz not null default now(),
  unique (enterprise_id, context_code, field_code)
);
-- every date-tracked table gets a JSON column for additional field values
do $$ declare t text; begin
  for t in select table_name from information_schema.tables where table_schema = 'public' and table_name like '%\_f' escape '\' loop
    execute format('alter table %I add column if not exists attributes jsonb not null default ''{}''', t);
  end loop;
end $$;

-- Class duration -----------------------------------------------------------
alter table class_f add column if not exists duration_type_code text;
alter table class_f add column if not exists start_time time;
alter table class_f add column if not exists end_time time;
alter table class_f add column if not exists min_duration_mins int;
alter table class_f add column if not exists max_duration_mins int;
update class_f set duration_type_code = 'HYBRID' where duration_type_code is null;

-- Position hierarchy -------------------------------------------------------
alter table position_f add column if not exists parent_position_id bigint references position(id);

-- New lookups --------------------------------------------------------------
insert into lookup_type (lookup_type, meaning, module_code, access_level, created_by) values
  ('CLASS_DURATION_TYPE', 'Class Duration Type', 'COMMON', 'SYSTEM', 'MIGRATION'),
  ('ADDITIONAL_FIELD_TYPE', 'Additional Field Data Type', 'SYSTEM', 'SYSTEM', 'MIGRATION')
on conflict (lookup_type) do nothing;
insert into lookup_value (lookup_type, lookup_code, meaning, description, display_seq, system_flag, created_by) values
  ('CLASS_DURATION_TYPE', 'FIXED', 'Fixed', 'Fixed in and out time', 10, 'Y', 'MIGRATION'),
  ('CLASS_DURATION_TYPE', 'FLEXIBLE', 'Flexible', 'Minimum and maximum duration', 20, 'Y', 'MIGRATION'),
  ('CLASS_DURATION_TYPE', 'HYBRID', 'Hybrid', 'Training days only', 30, 'Y', 'MIGRATION'),
  ('ADDITIONAL_FIELD_TYPE', 'TEXT', 'Text', null, 10, 'Y', 'MIGRATION'),
  ('ADDITIONAL_FIELD_TYPE', 'NUMBER', 'Number', null, 20, 'Y', 'MIGRATION'),
  ('ADDITIONAL_FIELD_TYPE', 'DATE', 'Date', null, 30, 'Y', 'MIGRATION'),
  ('ADDITIONAL_FIELD_TYPE', 'YESNO', 'Yes / No', null, 40, 'Y', 'MIGRATION'),
  ('ADDITIONAL_FIELD_TYPE', 'LOOKUP', 'List of values (lookup)', null, 50, 'Y', 'MIGRATION')
on conflict (lookup_type, lookup_code) do nothing;

-- Action reasons belong to an action type (parent) and optionally to
-- students or staff (tag = STUDENT / STAFF, empty = both)
update lookup_type set parent_lookup_type = 'ACTION_TYPE' where lookup_type = 'ACTION_REASON';
update lookup_value set parent_code = case lookup_code
    when 'NEW_JOINER' then 'HIRE' when 'GRADE_EXAM_PASSED' then 'PROMOTION' when 'PERFORMANCE' then 'PROMOTION'
    when 'RELOCATION' then 'TRANSFER' when 'BATCH_CHANGE' then 'TRANSFER' when 'PERSONAL' then 'TERMINATION'
    when 'FEES_DUE' then 'SUSPENSION' when 'DISCIPLINARY' then 'SUSPENSION' else parent_code end,
  tag = case lookup_code when 'GRADE_EXAM_PASSED' then 'STUDENT' when 'BATCH_CHANGE' then 'STUDENT' when 'FEES_DUE' then 'STUDENT' else tag end
where lookup_type = 'ACTION_REASON';
-- (only on existing installations; a fresh install gets these from the seed)
insert into lookup_value (lookup_type, lookup_code, meaning, parent_code, tag, display_seq, system_flag, created_by)
select v.* from (values
  ('ACTION_REASON', 'HIRE', 'Hire', 'HIRE', 'STAFF', 1, 'Y', 'MIGRATION'),
  ('ACTION_REASON', 'NEW_ADMISSION', 'New Admission', 'HIRE', 'STUDENT', 2, 'Y', 'MIGRATION'),
  ('ACTION_REASON', 'REJOINED', 'Rejoined', 'REHIRE', null, 3, 'N', 'MIGRATION'),
  ('ACTION_REASON', 'RESIGNATION', 'Resignation', 'TERMINATION', 'STAFF', 4, 'N', 'MIGRATION'),
  ('ACTION_REASON', 'GRADE_CHANGE', 'Grade / Pay Change', 'PROMOTION', 'STAFF', 5, 'N', 'MIGRATION'),
  ('ACTION_REASON', 'RETURN', 'Returned', 'REINSTATE', null, 6, 'N', 'MIGRATION')
) as v(lookup_type, lookup_code, meaning, parent_code, tag, display_seq, system_flag, created_by)
where exists (select 1 from lookup_type where lookup_type = 'ACTION_REASON')
on conflict (lookup_type, lookup_code) do nothing;
update lookup_value set tag = 'STUDENT' where lookup_type = 'ACTION_REASON' and lookup_code = 'NEW_JOINER' and tag is null;
