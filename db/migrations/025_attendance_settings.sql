-- Attendance settings (Attendance › Attendance Settings):
--   how far back attendance may be marked, whether in / out times are captured,
--   and the weight of a half day in attendance %.
create table if not exists attendance_setting (
  enterprise_id         bigint primary key references enterprise(id),
  student_back_days     int not null default 7,     -- student attendance: days back from today that can be marked
  staff_back_days       int not null default 7,     -- staff attendance
  capture_student_times text not null default 'N',  -- Y = record in / out times for students
  capture_staff_times   text not null default 'Y',  -- Y = record in / out times for staff
  half_day_value        numeric(4,2) not null default 0.5,
  last_updated_by text, last_update_date timestamptz not null default now()
);
insert into attendance_setting (enterprise_id, last_updated_by) select id, 'MIGRATION' from enterprise on conflict do nothing;
alter table student_attendance add column if not exists check_out_time timestamptz;
