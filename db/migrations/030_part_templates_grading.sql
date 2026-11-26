-- Each part of a combined subject has its own evaluation template (or direct marks).
alter table exam_subject_component add column if not exists evaluation_template_id bigint references evaluation_template(id) on delete set null;
update exam_subject_component c set evaluation_template_id = es.evaluation_template_id
from exam_subject es where es.id = c.exam_subject_id and c.evaluation_template_id is null and es.evaluation_template_id is not null;
update exam_subject set evaluation_template_id = null where combined_flag = 'Y';

-- Grading ranges: a rating (grade) for each range of marks (out of 100)
create table if not exists grading_scale (
  id bigint primary key default nextval('erp_id_seq'),
  enterprise_id bigint not null references enterprise(id),
  code text not null, name text not null, description text, active_flag text not null default 'Y',
  created_by text, creation_date timestamptz not null default now(), last_updated_by text, last_update_date timestamptz not null default now(),
  unique (enterprise_id, code)
);
create table if not exists grading_band (
  id bigint primary key default nextval('erp_id_seq'),
  scale_id bigint not null references grading_scale(id) on delete cascade,
  mark_from numeric(6,2) not null, mark_to numeric(6,2) not null,
  rating text not null, description text,
  check (mark_from >= 0 and mark_to <= 100 and mark_from <= mark_to)
);
alter table exam add column if not exists grading_scale_id bigint references grading_scale(id) on delete set null;
alter table exam_candidate add column if not exists grade_rating text;
alter table exam_mark add column if not exists grade_rating text;

-- new setup stop 6 (Grading Range): later stops move up by one
update exam set setup_step = setup_step + 1 where setup_step >= 6;
alter table exam alter column setup_step set default 8;
