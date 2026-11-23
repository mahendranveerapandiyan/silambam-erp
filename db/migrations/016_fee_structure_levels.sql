-- Fee structures can also target a branch, a section or one student.
-- Most specific wins: student > section > grade > class > branch > business unit > all.
alter table fee_structure add column if not exists branch_id bigint references branch(id);
alter table fee_structure add column if not exists section_id bigint references section(id);
alter table fee_structure add column if not exists person_id bigint references person(id) on delete cascade;
create index if not exists fee_structure_person_idx on fee_structure(person_id);
