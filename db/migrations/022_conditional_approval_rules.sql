-- Several approval rules per process, checked in priority order; the first
-- rule whose conditions all match decides: approval steps, or no approval.
drop index if exists approval_rule_one_active;
alter table approval_rule add column if not exists priority int not null default 10;
alter table approval_rule add column if not exists outcome_code text not null default 'APPROVAL';   -- APPROVAL_OUTCOME lookup
create table if not exists approval_rule_condition (
  id bigint primary key default nextval('erp_id_seq'),
  rule_id bigint not null references approval_rule(id) on delete cascade,
  attribute_code text not null,     -- APPROVAL_ATTRIBUTE lookup (FEE_TYPE, AMOUNT, BUSINESS_UNIT, BRANCH, CLASS, DEPARTMENT, JOB)
  operator_code text not null,      -- APPROVAL_OPERATOR lookup (IN, NOT_IN, GE, LE)
  value_text text not null          -- comma separated codes / ids, or a number
);
create index if not exists approval_rule_condition_rule_idx on approval_rule_condition(rule_id);

insert into lookup_type (lookup_type, meaning, description, module_code, access_level, created_by)
select v.t, v.m, v.d, 'SYSTEM', 'SYSTEM', 'MIGRATION'
from (values ('APPROVAL_OUTCOME', 'Approval Outcome', 'What a matching approval rule does.'),
             ('APPROVAL_ATTRIBUTE', 'Approval Condition Attribute', 'What approval rule conditions can test. Tag = processes it applies to.'),
             ('APPROVAL_OPERATOR', 'Approval Condition Operator', 'How an approval rule condition compares.')) v(t, m, d)
where not exists (select 1 from lookup_type x where x.lookup_type = v.t);
insert into lookup_value (lookup_type, lookup_code, meaning, tag, display_seq, system_flag, created_by)
select v.t, v.c, v.m, v.tag, v.s, 'Y', 'MIGRATION'
from (values
  ('APPROVAL_OUTCOME', 'APPROVAL', 'Needs approval (steps below)', null, 10),
  ('APPROVAL_OUTCOME', 'AUTO', 'No approval required – approved automatically', null, 20),
  ('APPROVAL_ATTRIBUTE', 'FEE_TYPE', 'Fee Type', 'FEE_EXCEPTION', 10),
  ('APPROVAL_ATTRIBUTE', 'AMOUNT', 'Exception Amount', 'FEE_EXCEPTION', 20),
  ('APPROVAL_ATTRIBUTE', 'BUSINESS_UNIT', 'Business Unit', 'FEE_EXCEPTION,STUDENT_ADMISSION,STAFF_HIRE', 30),
  ('APPROVAL_ATTRIBUTE', 'BRANCH', 'Branch', 'STUDENT_ADMISSION', 40),
  ('APPROVAL_ATTRIBUTE', 'CLASS', 'Class', 'STUDENT_ADMISSION', 50),
  ('APPROVAL_ATTRIBUTE', 'DEPARTMENT', 'Department', 'STAFF_HIRE', 60),
  ('APPROVAL_ATTRIBUTE', 'JOB', 'Job', 'STAFF_HIRE', 70),
  ('APPROVAL_OPERATOR', 'IN', 'is one of', null, 10),
  ('APPROVAL_OPERATOR', 'NOT_IN', 'is not one of', null, 20),
  ('APPROVAL_OPERATOR', 'GE', 'is at least', null, 30),
  ('APPROVAL_OPERATOR', 'LE', 'is at most', null, 40)) v(t, c, m, tag, s)
where exists (select 1 from lookup_type where lookup_type = v.t)
  and not exists (select 1 from lookup_value x where x.lookup_type = v.t and x.lookup_code = v.c);
