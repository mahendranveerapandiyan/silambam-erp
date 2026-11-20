-- Enterprise: registration / tax numbers, user-defined code locked after first save
alter table enterprise add column if not exists registration_number text;
alter table enterprise add column if not exists tax_number text;
alter table enterprise add column if not exists code_locked_flag text not null default 'N';

-- Lookups: days of week (multi-select on classes) and time zones
insert into lookup_type (lookup_type, meaning, module_code, access_level, created_by)
values ('DAY_OF_WEEK', 'Day of Week', 'COMMON', 'SYSTEM', 'MIGRATION'),
       ('TIMEZONE', 'Time Zone', 'COMMON', 'EXTENSIBLE', 'MIGRATION')
on conflict (lookup_type) do nothing;
insert into lookup_value (lookup_type, lookup_code, meaning, display_seq, system_flag, created_by) values
  ('DAY_OF_WEEK', 'SUN', 'Sunday', 10, 'Y', 'MIGRATION'), ('DAY_OF_WEEK', 'MON', 'Monday', 20, 'Y', 'MIGRATION'),
  ('DAY_OF_WEEK', 'TUE', 'Tuesday', 30, 'Y', 'MIGRATION'), ('DAY_OF_WEEK', 'WED', 'Wednesday', 40, 'Y', 'MIGRATION'),
  ('DAY_OF_WEEK', 'THU', 'Thursday', 50, 'Y', 'MIGRATION'), ('DAY_OF_WEEK', 'FRI', 'Friday', 60, 'Y', 'MIGRATION'),
  ('DAY_OF_WEEK', 'SAT', 'Saturday', 70, 'Y', 'MIGRATION'),
  ('TIMEZONE', 'Asia/Kolkata', 'India (IST, UTC+05:30)', 10, 'Y', 'MIGRATION'),
  ('TIMEZONE', 'Asia/Colombo', 'Sri Lanka (UTC+05:30)', 20, 'N', 'MIGRATION'),
  ('TIMEZONE', 'Asia/Kuala_Lumpur', 'Malaysia (UTC+08:00)', 30, 'N', 'MIGRATION'),
  ('TIMEZONE', 'Asia/Singapore', 'Singapore (UTC+08:00)', 40, 'N', 'MIGRATION'),
  ('TIMEZONE', 'Asia/Dubai', 'UAE (UTC+04:00)', 50, 'N', 'MIGRATION'),
  ('TIMEZONE', 'Europe/London', 'United Kingdom (GMT/BST)', 60, 'N', 'MIGRATION'),
  ('TIMEZONE', 'America/New_York', 'US Eastern (EST/EDT)', 70, 'N', 'MIGRATION'),
  ('TIMEZONE', 'UTC', 'UTC', 80, 'N', 'MIGRATION')
on conflict (lookup_type, lookup_code) do nothing;

-- Class training days become DAY_OF_WEEK codes: 'Mon, Wed, Fri' -> 'MON,WED,FRI'
update class_f set training_days = upper(regexp_replace(training_days, '\s*,\s*', ',', 'g'))
where training_days is not null and training_days ~* '^(sun|mon|tue|wed|thu|fri|sat)';

-- Missing foreign key (so "is it in use?" checks see it)
do $$ begin
  alter table student_grade_f add constraint student_grade_f_next_grade_fk foreign key (next_grade_id) references student_grade(id);
exception when duplicate_object then null; end $$;
