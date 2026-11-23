-- Fee amount on the student's assignment (date-effective). It is the first
-- preference when fees are generated; the Fee Structures page is used when empty.
alter table assignment_f add column if not exists fee_type_code text;
alter table assignment_f add column if not exists fee_amount numeric(12,2) check (fee_amount >= 0);

-- amounts typed on admission were stored as a fee structure for that student:
-- move them onto the assignment (all versions) and re-point their fee lines
with s as (
  select fs.id, fs.person_id, a.id assignment_id, fa.frequency_code, fa.amount
  from fee_structure fs
  join fee_structure_amount fa on fa.fee_structure_id = fs.id
  join assignment a on a.person_id = fs.person_id and a.assignment_type = 'STUDENT'
  where fs.person_id is not null and fs.fee_type_code = 'TUITION' and fs.description like 'Set on admission of %'
)
update assignment_f af set fee_type_code = 'TUITION', fee_amount = s.amount
from s where af.id = s.assignment_id and af.fee_amount is null and af.fee_frequency_code = s.frequency_code;
update fee_demand d set fee_structure_id = null
where d.fee_structure_id in (select id from fee_structure where person_id is not null and fee_type_code = 'TUITION' and description like 'Set on admission of %');
delete from fee_structure where person_id is not null and fee_type_code = 'TUITION' and description like 'Set on admission of %';
