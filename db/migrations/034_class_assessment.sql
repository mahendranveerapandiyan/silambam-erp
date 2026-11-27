-- Class assessments: created and published by a class incharge for their own class; results are recorded only.
alter table exam add column if not exists exam_scope text not null default 'ORG';   -- ORG / CLASS
