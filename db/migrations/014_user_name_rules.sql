-- User name rules: how login user names are formed
--   Staff:    staff number, first + last name, or email id (configurable)
--   Students: student number      Parents: typed manually
create table if not exists user_name_rule (
  enterprise_id   bigint not null references enterprise(id),
  person_category text not null,                -- STAFF / STUDENT / PARENT
  method_code     text not null,                -- USER_NAME_METHOD lookup
  separator       text not null default '.',    -- between first and last name
  last_updated_by text, last_update_date timestamptz not null default now(),
  primary key (enterprise_id, person_category)
);

insert into lookup_type (lookup_type, meaning, description, module_code, access_level, created_by)
select 'USER_NAME_METHOD', 'User Name Method', 'How login user names are formed (Configuration › User Name Rules). Tag = the people it applies to.', 'SYSTEM', 'SYSTEM', 'MIGRATION'
where not exists (select 1 from lookup_type where lookup_type = 'USER_NAME_METHOD');
insert into lookup_value (lookup_type, lookup_code, meaning, tag, display_seq, system_flag, created_by)
select 'USER_NAME_METHOD', v.code, v.meaning, v.tag, v.seq, 'Y', 'MIGRATION'
from (values ('STAFF_NUMBER', 'Staff Number', 'STAFF', 10), ('FIRST_LAST', 'First and Last Name', 'STAFF', 20), ('EMAIL', 'Email ID', 'STAFF', 30),
             ('STUDENT_NUMBER', 'Student Number', 'STUDENT', 40), ('MANUAL', 'Entered Manually', 'PARENT', 50)) v(code, meaning, tag, seq)
where not exists (select 1 from lookup_value x where x.lookup_type = 'USER_NAME_METHOD' and x.lookup_code = v.code);

insert into user_name_rule (enterprise_id, person_category, method_code, last_updated_by)
select e.id, c.cat, c.method, 'MIGRATION' from enterprise e
cross join (values ('STAFF', 'STAFF_NUMBER'), ('STUDENT', 'STUDENT_NUMBER'), ('PARENT', 'MANUAL')) c(cat, method)
on conflict do nothing;
