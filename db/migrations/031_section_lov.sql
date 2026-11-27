-- Evaluation sections are a list of values (LOV) or a user-entered field; LOV sections carry their values.
create table if not exists evaluation_section_value (
  id bigint primary key default nextval('erp_id_seq'),
  section_id bigint not null references evaluation_section(id) on delete cascade,
  label text not null,
  value numeric(8,2) not null,
  display_seq int not null default 0,
  unique (section_id, value)
);
-- ratings with whole-number steps become LOVs (one value per step); everything else is entered
insert into evaluation_section_value (section_id, label, value, display_seq)
select s.id, g::text, g, g from evaluation_section s, generate_series(ceil(s.min_rating)::int, floor(s.max_rating)::int) g
where s.input_type = 'RATING' and s.max_rating - s.min_rating <= 20
on conflict do nothing;
update evaluation_section s set input_type = case when s.input_type = 'RATING' and exists (select 1 from evaluation_section_value v where v.section_id = s.id) then 'LOV' else 'ENTRY' end
where s.input_type in ('RATING', 'MARK');
alter table evaluation_section alter column input_type set default 'ENTRY';
-- the weight is in marks: a template fits a subject when its weights total the subject's maximum marks
alter table evaluation_section drop constraint if exists evaluation_section_weight_pct_check;
alter table evaluation_section add constraint evaluation_section_weight_check check (weight_pct > 0);
