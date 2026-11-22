-- Staff manager on the assignment (date-effective). When empty, the manager is
-- the active holder of the position's parent position (position hierarchy).
alter table assignment_f add column if not exists manager_person_id bigint references person(id);
create index if not exists assignment_f_manager_idx on assignment_f(manager_person_id);
