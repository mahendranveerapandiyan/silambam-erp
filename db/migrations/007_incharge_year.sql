-- Class incharges are assigned per academic year
alter table class_incharge add column if not exists academic_year_id bigint references academic_year(id);
update class_incharge ci set academic_year_id = y.id
from class_f cf join class c on c.id = cf.id
join academic_year y on y.enterprise_id = c.enterprise_id
where ci.academic_year_id is null and cf.id = ci.class_id
  and ci.start_date between y.start_date and y.end_date;
-- incharge periods that ran to "end of time" stop at the end of their academic year
update class_incharge ci set end_date = y.end_date from academic_year y
where y.id = ci.academic_year_id and ci.end_date > y.end_date;
create index if not exists class_incharge_year_idx on class_incharge(academic_year_id);
