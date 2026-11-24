-- Exam setup in 7 stops: details (code), grades, student eligibility, subjects per
-- grade (incl. combined subjects), evaluation template, targeted outcome, examiners.
alter table exam add column if not exists code text;
alter table exam add column if not exists outcome_code text;                          -- EXAM_OUTCOME: PROMOTE / RECORD
alter table exam add column if not exists evaluation_template_id bigint;
alter table exam add column if not exists setup_step int not null default 7;          -- furthest stop reached in the setup
update exam set outcome_code = case when exam_type_code = 'GRADE_EXAM' then 'PROMOTE' else 'RECORD' end where outcome_code is null;
update exam e set code = x.code from (
  select e2.id, 'EX-' || coalesce(y.code, 'AY') || '-' || lpad((row_number() over (partition by e2.enterprise_id, e2.academic_year_id order by e2.id))::text, 3, '0') as code
  from exam e2 left join academic_year y on y.id = e2.academic_year_id) x
where x.id = e.id and e.code is null;
create unique index if not exists exam_code_uq on exam(enterprise_id, code);

-- grades that may sit the exam (none = any grade, for exams made before)
create table if not exists exam_grade (
  exam_id bigint not null references exam(id) on delete cascade,
  grade_id bigint not null references student_grade(id),
  target_grade_id bigint references student_grade(id),   -- promote to (empty = the grade's next grade)
  primary key (exam_id, grade_id)
);
insert into exam_grade (exam_id, grade_id, target_grade_id)
select id, from_grade_id, target_grade_id from exam where from_grade_id is not null on conflict do nothing;

-- subjects per grade; a subject can combine two (or more) subjects
alter table exam_subject add column if not exists grade_id bigint references student_grade(id);   -- empty = every grade
alter table exam_subject add column if not exists combined_flag text not null default 'N';
alter table exam_subject add column if not exists weight_type text not null default 'PERCENT';    -- PERCENT / MARK
alter table exam_subject drop constraint if exists exam_subject_exam_id_subject_id_subject_type_code_key;
create table if not exists exam_subject_component (
  id bigint primary key default nextval('erp_id_seq'),
  exam_subject_id bigint not null references exam_subject(id) on delete cascade,
  subject_id bigint not null references subject(id),
  weight numeric(8,2) not null,          -- % of the combined subject, or the marks it contributes
  max_marks numeric(8,2) not null,
  pass_marks numeric(8,2) not null,
  display_seq int not null default 0
);

-- examiners per grade
create table if not exists exam_examiner (
  exam_id bigint not null references exam(id) on delete cascade,
  grade_id bigint not null references student_grade(id),
  person_id bigint not null references person(id) on delete cascade,
  primary key (exam_id, grade_id, person_id)
);

-- evaluation templates: per subject, sections with weight % and the rating range
create table if not exists evaluation_template (
  id bigint primary key default nextval('erp_id_seq'),
  enterprise_id bigint not null references enterprise(id),
  code text not null, name text not null, description text, active_flag text not null default 'Y',
  created_by text, creation_date timestamptz not null default now(), last_updated_by text, last_update_date timestamptz not null default now(),
  unique (enterprise_id, code)
);
create table if not exists evaluation_section (
  id bigint primary key default nextval('erp_id_seq'),
  template_id bigint not null references evaluation_template(id) on delete cascade,
  subject_id bigint not null references subject(id),
  name text not null,
  weight_pct numeric(6,2) not null check (weight_pct > 0 and weight_pct <= 100),
  min_rating numeric(8,2) not null default 0,
  max_rating numeric(8,2) not null check (max_rating > 0),
  display_seq int not null default 0,
  check (min_rating <= max_rating)
);
alter table exam add constraint exam_template_fk foreign key (evaluation_template_id) references evaluation_template(id) on delete set null not valid;

-- marks entered per part (component of a combined subject, or the subject itself) and per section rating
create table if not exists exam_unit_mark (
  candidate_id bigint not null references exam_candidate(id) on delete cascade,
  exam_subject_id bigint not null references exam_subject(id) on delete cascade,
  component_id bigint not null default 0,      -- 0 = the subject itself
  marks numeric(8,2), absent_flag text not null default 'N',
  entered_by text, entered_at timestamptz not null default now(),
  primary key (candidate_id, exam_subject_id, component_id)
);
create table if not exists exam_section_rating (
  candidate_id bigint not null references exam_candidate(id) on delete cascade,
  exam_subject_id bigint not null references exam_subject(id) on delete cascade,
  component_id bigint not null default 0,
  section_id bigint not null references evaluation_section(id) on delete cascade,
  rating numeric(8,2),
  entered_by text, entered_at timestamptz not null default now(),
  primary key (candidate_id, exam_subject_id, component_id, section_id)
);

-- lookups
insert into lookup_type (lookup_type, meaning, description, module_code, access_level, created_by)
select 'EXAM_OUTCOME', 'Exam Outcome', 'What happens to students who pass an exam.', 'EXAMS', 'SYSTEM', 'MIGRATION'
where not exists (select 1 from lookup_type where lookup_type = 'EXAM_OUTCOME');
insert into lookup_value (lookup_type, lookup_code, meaning, display_seq, system_flag, created_by)
select v.t, v.c, v.m, v.s, 'Y', 'MIGRATION'
from (values ('EXAM_OUTCOME', 'PROMOTE', 'Promote passed students to the next grade', 10), ('EXAM_OUTCOME', 'RECORD', 'Record the result on the profile only', 20),
             ('EXAM_STATUS', 'DRAFT', 'Draft – being set up', 5)) v(t, c, m, s)
where exists (select 1 from lookup_type where lookup_type = v.t)
  and not exists (select 1 from lookup_value x where x.lookup_type = v.t and x.lookup_code = v.c);

-- subject-level result kept with the computed mark (combined subjects pass only when every part passes)
alter table exam_mark add column if not exists pass_flag text;
