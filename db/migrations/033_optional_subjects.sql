-- Optional (elective) subjects: each grade sets how many optional subjects every student chooses.
alter table exam_subject add column if not exists optional_flag text not null default 'N';
alter table exam_grade add column if not exists optional_count int not null default 0;
create table if not exists exam_candidate_subject (
  candidate_id bigint not null references exam_candidate(id) on delete cascade,
  exam_subject_id bigint not null references exam_subject(id) on delete cascade,
  chosen_by text, chosen_at timestamptz not null default now(),
  primary key (candidate_id, exam_subject_id)
);
