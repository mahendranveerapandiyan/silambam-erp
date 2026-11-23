-- Approvals: user groups, approval rules (ordered steps), requests and approver tasks.
create table if not exists user_group (
  id bigint primary key default nextval('erp_id_seq'),
  enterprise_id bigint not null references enterprise(id),
  code text not null, name text not null, description text, active_flag text not null default 'Y',
  created_by text, creation_date timestamptz not null default now(), last_updated_by text, last_update_date timestamptz not null default now(),
  unique (enterprise_id, code)
);
create table if not exists user_group_member (
  group_id bigint not null references user_group(id) on delete cascade,
  user_id bigint not null references user_account(id) on delete cascade,
  primary key (group_id, user_id)
);
create table if not exists approval_rule (
  id bigint primary key default nextval('erp_id_seq'),
  enterprise_id bigint not null references enterprise(id),
  process_code text not null,                       -- APPROVAL_PROCESS lookup
  name text not null, description text, active_flag text not null default 'Y',
  created_by text, creation_date timestamptz not null default now(), last_updated_by text, last_update_date timestamptz not null default now()
);
create unique index if not exists approval_rule_one_active on approval_rule(enterprise_id, process_code) where active_flag = 'Y';
create table if not exists approval_rule_step (
  id bigint primary key default nextval('erp_id_seq'),
  rule_id bigint not null references approval_rule(id) on delete cascade,
  step_no int not null,
  approver_type text not null,                      -- APPROVER_TYPE lookup: USER, USER_GROUP, AOR, MANAGER, ROLE
  approver_ref text not null,                       -- user id / group id / AOR code / manager level / role code
  approval_mode text not null default 'ANY',        -- ANY / ALL (groups, AORs, roles)
  unique (rule_id, step_no)
);
create table if not exists approval_request (
  id bigint primary key default nextval('erp_id_seq'),
  enterprise_id bigint not null references enterprise(id),
  process_code text not null,
  title text not null, summary text,
  ref_table text, ref_id bigint,                    -- e.g. fee_exemption id
  payload jsonb,                                    -- the submitted transaction (e.g. admission form)
  rule_id bigint references approval_rule(id) on delete set null,
  requested_by_user_id bigint references user_account(id) on delete set null,
  requested_by text not null,
  status_code text not null default 'PENDING',      -- PENDING, APPROVED, REJECTED, WITHDRAWN
  current_step int,
  result_ref text, result_message text,
  created_at timestamptz not null default now(), completed_at timestamptz
);
create index if not exists approval_request_status_idx on approval_request(enterprise_id, status_code, created_at desc);
create table if not exists approval_task (
  id bigint primary key default nextval('erp_id_seq'),
  request_id bigint not null references approval_request(id) on delete cascade,
  step_no int not null, step_label text,
  approver_user_id bigint references user_account(id) on delete set null,
  approval_mode text not null default 'ANY',
  status_code text not null default 'PENDING',      -- PENDING, APPROVED, REJECTED, SKIPPED, NOT_REQUIRED, REASSIGNED, WITHDRAWN
  acted_by text, acted_at timestamptz, comments text,
  created_at timestamptz not null default now()
);
create index if not exists approval_task_user_idx on approval_task(approver_user_id, status_code);
create table if not exists approval_history (
  id bigint primary key default nextval('erp_id_seq'),
  request_id bigint not null references approval_request(id) on delete cascade,
  action text not null, by_user text, comments text, at timestamptz not null default now()
);

-- lookups
insert into lookup_type (lookup_type, meaning, description, module_code, access_level, created_by)
select v.t, v.m, v.d, 'SYSTEM', 'SYSTEM', 'MIGRATION'
from (values ('APPROVAL_PROCESS', 'Approval Process', 'Processes that can need approval (Configuration › Approval Rules).'),
             ('APPROVER_TYPE', 'Approver Type', 'Who approves a step of an approval rule.'),
             ('APPROVAL_MODE', 'Approval Mode', 'For groups, areas of responsibility and roles: one approval enough or all must approve.')) v(t, m, d)
where not exists (select 1 from lookup_type x where x.lookup_type = v.t);
insert into lookup_value (lookup_type, lookup_code, meaning, display_seq, system_flag, created_by)
select v.t, v.c, v.m, v.s, 'Y', 'MIGRATION'
from (values ('APPROVAL_PROCESS', 'STUDENT_ADMISSION', 'Student Admission (Admission Form)', 10), ('APPROVAL_PROCESS', 'STAFF_HIRE', 'Staff Hire', 20),
             ('APPROVAL_PROCESS', 'FEE_EXCEPTION', 'Fee Exception', 30),
             ('APPROVER_TYPE', 'USER', 'User', 10), ('APPROVER_TYPE', 'USER_GROUP', 'User Group', 20), ('APPROVER_TYPE', 'AOR', 'Area of Responsibility', 30),
             ('APPROVER_TYPE', 'MANAGER', 'Requester''s Manager (level)', 40), ('APPROVER_TYPE', 'ROLE', 'Role', 50),
             ('APPROVAL_MODE', 'ANY', 'Any one approval is enough', 10), ('APPROVAL_MODE', 'ALL', 'All must approve', 20),
             ('APPROVAL_STATUS', 'WITHDRAWN', 'Withdrawn', 40), ('APPROVAL_STATUS', 'SKIPPED', 'Skipped', 50),
             ('APPROVAL_STATUS', 'NOT_REQUIRED', 'Not Required', 60), ('APPROVAL_STATUS', 'REASSIGNED', 'Reassigned', 70)) v(t, c, m, s)
where exists (select 1 from lookup_type where lookup_type = v.t)
  and not exists (select 1 from lookup_value x where x.lookup_type = v.t and x.lookup_code = v.c);

-- default rules: admission form and fee exceptions are approved by an Administrator (any one)
insert into approval_rule (enterprise_id, process_code, name, description, created_by)
select e.id, v.p, v.n, 'Default rule – change it under Configuration › Approval Rules.', 'MIGRATION'
from enterprise e cross join (values ('STUDENT_ADMISSION', 'Admission form approval'), ('FEE_EXCEPTION', 'Fee exception approval')) v(p, n)
where not exists (select 1 from approval_rule r where r.enterprise_id = e.id and r.process_code = v.p);
insert into approval_rule_step (rule_id, step_no, approver_type, approver_ref, approval_mode)
select r.id, 1, 'ROLE', 'ADMIN', 'ANY' from approval_rule r
where r.created_by = 'MIGRATION' and not exists (select 1 from approval_rule_step s where s.rule_id = r.id);

-- fee exceptions already waiting become approval requests (approvers: active administrators)
with pend as (
  select e.id, e.requested_by, e.amount, d.enterprise_id, d.description, d.period_label
  from fee_exemption e join fee_demand d on d.id = e.demand_id
  where e.status_code = 'PENDING' and not exists (select 1 from approval_request q where q.ref_table = 'fee_exemption' and q.ref_id = e.id)
), req as (
  insert into approval_request (enterprise_id, process_code, title, summary, ref_table, ref_id, rule_id, requested_by_user_id, requested_by, current_step)
  select p.enterprise_id, 'FEE_EXCEPTION', 'Fee exception ' || p.amount || ' – ' || p.description || coalesce(' ' || p.period_label, ''), null, 'fee_exemption', p.id,
    (select id from approval_rule r where r.enterprise_id = p.enterprise_id and r.process_code = 'FEE_EXCEPTION' and r.active_flag = 'Y'),
    (select id from user_account where lower(username) = lower(p.requested_by)), coalesce(p.requested_by, 'unknown'), 1
  from pend p returning id, enterprise_id
)
insert into approval_task (request_id, step_no, step_label, approver_user_id, approval_mode)
select req.id, 1, 'Role: Administrator', ua.id, 'ANY' from req
join user_account ua on ua.enterprise_id = req.enterprise_id and ua.active_flag = 'Y'
join user_role ur on ur.user_id = ua.id and ur.role_code = 'ADMIN';
