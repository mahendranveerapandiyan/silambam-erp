-- The exam code is the exam name (unique within an academic year).
drop index if exists exam_code_uq;
update exam e set code = x.code from (
  select id, case when row_number() over (partition by enterprise_id, academic_year_id, lower(name) order by id) = 1 then name
                  else name || ' (' || row_number() over (partition by enterprise_id, academic_year_id, lower(name) order by id) || ')' end code
  from exam) x
where x.id = e.id;
create unique index if not exists exam_code_uq on exam(enterprise_id, academic_year_id, lower(code));
