-- Results are published per student, so they can be rolled back for all, selected students or a section.
alter table exam_candidate add column if not exists published_flag text not null default 'N';
alter table exam_candidate add column if not exists promoted_on date;
alter table exam_candidate add column if not exists promoted_from_grade_id bigint references student_grade(id);
alter table exam_candidate add column if not exists promoted_to_grade_id bigint references student_grade(id);
update exam_candidate c set published_flag = 'Y' from exam e where e.id = c.exam_id and e.status_code = 'PUBLISHED' and c.published_flag = 'N';
-- promotions made before: find the version the promotion created
update exam_candidate c set promoted_on = v.effective_start_date, promoted_to_grade_id = v.student_grade_id, promoted_from_grade_id = c.current_grade_id
from (select c2.id cid, (select af.effective_start_date from assignment_f af where af.id = c2.assignment_id and af.comments = 'Passed ' || e.name order by af.effective_start_date limit 1) effective_start_date,
             (select af.student_grade_id from assignment_f af where af.id = c2.assignment_id and af.comments = 'Passed ' || e.name order by af.effective_start_date limit 1) student_grade_id
      from exam_candidate c2 join exam e on e.id = c2.exam_id where c2.promoted_flag = 'Y' and c2.promoted_on is null) v
where v.cid = c.id;

-- the evaluation template is chosen per subject of each grade
alter table exam_subject add column if not exists evaluation_template_id bigint references evaluation_template(id) on delete set null;
alter table exam_subject add column if not exists evaluation_chosen_flag text not null default 'N';   -- Y once stop 5 has been answered for the subject
update exam_subject es set evaluation_template_id = e.evaluation_template_id, evaluation_chosen_flag = 'Y'
from exam e where e.id = es.exam_id and e.evaluation_template_id is not null and es.evaluation_template_id is null
  and exists (select 1 from evaluation_section s where s.template_id = e.evaluation_template_id
              and (s.subject_id = es.subject_id or s.subject_id in (select subject_id from exam_subject_component c where c.exam_subject_id = es.id)));
update exam_subject es set evaluation_chosen_flag = 'Y' from exam e where e.id = es.exam_id and e.setup_step >= 5;

-- template sections: entered as manual marks or as a rating, each between a minimum and a maximum
alter table evaluation_section add column if not exists input_type text not null default 'RATING';   -- RATING / MARK
