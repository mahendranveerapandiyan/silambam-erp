-- Branch: a new level between Business Unit and Class
--   Enterprise > Legal Employer > Business Unit > Branch > Class > Section
select erp_create_dt('branch', $c$
  business_unit_id bigint not null references business_unit(id),
  location_id bigint references location(id), phone text, email text, active_flag text not null default 'Y'
$c$);
-- additional field values, like every other date-tracked table
alter table branch_f add column if not exists attributes jsonb not null default '{}';
create index if not exists branch_f_bu_idx on branch_f(business_unit_id);

alter table class_f add column if not exists branch_id bigint references branch(id);
alter table assignment_f add column if not exists branch_id bigint references branch(id);
create index if not exists class_f_branch_idx on class_f(branch_id);
create index if not exists assignment_f_branch_idx on assignment_f(branch_id);

-- existing data: one branch per business unit (same code, name and dates),
-- classes and assignments linked to it
insert into branch (enterprise_id, code, created_by)
select b.enterprise_id, b.code, 'MIGRATION' from business_unit b
where not exists (select 1 from branch x where x.enterprise_id = b.enterprise_id and x.code = b.code);
insert into branch_f (id, effective_start_date, effective_end_date, name, description, business_unit_id, location_id, phone, email, active_flag, created_by, last_updated_by)
select br.id, f.effective_start_date, f.effective_end_date, f.name, f.description, f.id, f.location_id, f.phone, f.email, f.active_flag, 'MIGRATION', 'MIGRATION'
from business_unit_f f join business_unit b on b.id = f.id join branch br on br.enterprise_id = b.enterprise_id and br.code = b.code
where not exists (select 1 from branch_f x where x.id = br.id);
update class_f c set branch_id = br.id from business_unit b join branch br on br.enterprise_id = b.enterprise_id and br.code = b.code
where b.id = c.business_unit_id and c.branch_id is null;
update assignment_f a set branch_id = coalesce(
    (select c.branch_id from class_f c where c.id = a.class_id and a.effective_start_date between c.effective_start_date and c.effective_end_date),
    (select br.id from business_unit b join branch br on br.enterprise_id = b.enterprise_id and br.code = b.code where b.id = a.business_unit_id))
where a.branch_id is null and a.business_unit_id is not null;
alter table class_f alter column branch_id set not null;

-- numbering can also run per branch
insert into lookup_value (lookup_type, lookup_code, meaning, display_seq, system_flag, created_by)
select 'NUMBER_SCOPE', 'BRANCH', 'Branch', 40, 'Y', 'MIGRATION'
where exists (select 1 from lookup_type where lookup_type = 'NUMBER_SCOPE')
  and not exists (select 1 from lookup_value where lookup_type = 'NUMBER_SCOPE' and lookup_code = 'BRANCH');
