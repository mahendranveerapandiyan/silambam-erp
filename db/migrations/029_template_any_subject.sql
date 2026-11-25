-- Evaluation templates are no longer tied to subjects: a template's sections apply to any subject.
-- A template that already had sections for several subjects is split: the first subject's sections
-- stay, each other subject's sections become a template of their own ("<name> – <subject>"),
-- and exam subjects that used them point to the new template.
do $$
declare t record; s record; nid bigint; n int;
begin
  for t in select * from evaluation_template loop
    n := 0;
    for s in select es.subject_id, min(es.display_seq) seq,
               (select f.name from subject_f f where f.id = es.subject_id order by f.effective_start_date desc limit 1) sname
             from evaluation_section es where es.template_id = t.id and es.subject_id is not null
             group by es.subject_id order by min(es.display_seq), es.subject_id loop
      n := n + 1;
      if n = 1 then continue; end if;
      insert into evaluation_template (enterprise_id, code, name, description, active_flag, created_by)
        values (t.enterprise_id, left(t.code || '_' || upper(regexp_replace(coalesce(s.sname, s.subject_id::text), '[^A-Za-z0-9]+', '_', 'g')), 60),
                t.name || ' – ' || coalesce(s.sname, s.subject_id::text), t.description, t.active_flag, 'MIGRATION')
        returning id into nid;
      update evaluation_section set template_id = nid where template_id = t.id and subject_id = s.subject_id;
      update exam_subject es set evaluation_template_id = nid
        where es.evaluation_template_id = t.id
          and (es.subject_id = s.subject_id or exists (select 1 from exam_subject_component c where c.exam_subject_id = es.id and c.subject_id = s.subject_id))
          and not exists (select 1 from evaluation_section x where x.template_id = t.id and (x.subject_id = es.subject_id
                          or x.subject_id in (select c.subject_id from exam_subject_component c where c.exam_subject_id = es.id)));
    end loop;
  end loop;
end $$;
alter table evaluation_section alter column subject_id drop not null;
update evaluation_section set subject_id = null;
