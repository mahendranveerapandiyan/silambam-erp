-- Targeted Outcome: promotions take effect on a set date, into a set academic year.
alter table exam add column if not exists promotion_date date;
alter table exam add column if not exists promotion_ay_id bigint references academic_year(id);
alter table exam_candidate add column if not exists promoted_from_ay_id bigint references academic_year(id);
