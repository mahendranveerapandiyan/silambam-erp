-- =====================================================================
-- Attendance, Fees, Exams, Events, Inventory, Finance
-- =====================================================================

-- Attendance ------------------------------------------------------------
create table student_attendance (
  id bigint primary key default nextval('erp_id_seq'),
  person_id bigint not null references person(id) on delete cascade,
  assignment_id bigint not null references assignment(id) on delete cascade,
  attendance_date date not null,
  business_unit_id bigint references business_unit(id),
  class_id bigint references class(id),
  section_id bigint references section(id),
  status_code text not null,
  source_code text not null default 'MANUAL',
  check_in_time timestamptz,
  remarks text,
  marked_by text, marked_at timestamptz not null default now(),
  unique (person_id, attendance_date)
);
create index student_attendance_class_idx on student_attendance(class_id, attendance_date);

create table staff_attendance (
  id bigint primary key default nextval('erp_id_seq'),
  person_id bigint not null references person(id) on delete cascade,
  assignment_id bigint not null references assignment(id) on delete cascade,
  attendance_date date not null,
  business_unit_id bigint references business_unit(id),
  status_code text not null,
  check_in_time timestamptz,
  check_out_time timestamptz,
  source_code text not null default 'MANUAL',
  reason text,
  marked_by text, marked_at timestamptz not null default now(),
  unique (person_id, attendance_date)
);

-- Fees ------------------------------------------------------------------
create table fee_structure (
  id bigint primary key default nextval('erp_id_seq'),
  enterprise_id bigint not null references enterprise(id),
  academic_year_id bigint not null references academic_year(id),
  fee_type_code text not null,
  name text not null,
  description text,
  business_unit_id bigint references business_unit(id),
  class_id bigint references class(id),
  student_grade_id bigint references student_grade(id),
  active_flag text not null default 'Y',
  copied_from_id bigint references fee_structure(id),
  created_by text, creation_date timestamptz not null default now(),
  last_updated_by text, last_update_date timestamptz not null default now(),
  object_version_number int not null default 1
);
create table fee_structure_amount (
  fee_structure_id bigint not null references fee_structure(id) on delete cascade,
  frequency_code text not null,
  amount numeric(12,2) not null check (amount >= 0),
  primary key (fee_structure_id, frequency_code)
);

create table fee_demand (
  id bigint primary key default nextval('erp_id_seq'),
  enterprise_id bigint not null references enterprise(id),
  person_id bigint not null references person(id) on delete cascade,
  assignment_id bigint references assignment(id),
  academic_year_id bigint references academic_year(id),
  business_unit_id bigint references business_unit(id),
  fee_type_code text not null,
  fee_structure_id bigint references fee_structure(id),
  source_type text not null default 'MANUAL',   -- STRUCTURE, EXAM, EVENT, SALE, MANUAL
  source_id bigint,
  description text not null,
  frequency_code text,
  period_label text,
  period_start date,
  period_end date,
  due_date date not null,
  amount numeric(12,2) not null check (amount >= 0),
  cancelled_flag text not null default 'N',
  created_by text, creation_date timestamptz not null default now(),
  last_updated_by text, last_update_date timestamptz not null default now()
);
create unique index fee_demand_structure_uk
  on fee_demand(person_id, fee_structure_id, period_start) where fee_structure_id is not null and cancelled_flag = 'N';
create index fee_demand_person_idx on fee_demand(person_id, due_date);

create table fee_payment (
  id bigint primary key default nextval('erp_id_seq'),
  enterprise_id bigint not null references enterprise(id),
  receipt_number text not null,
  person_id bigint not null references person(id) on delete cascade,
  business_unit_id bigint references business_unit(id),
  payment_date date not null,
  amount numeric(12,2) not null check (amount > 0),
  payment_mode_code text not null,
  reference text,
  remarks text,
  status_code text not null default 'ACTIVE',
  collected_by text,
  created_by text, creation_date timestamptz not null default now(),
  unique (enterprise_id, receipt_number)
);
create table fee_allocation (
  payment_id bigint not null references fee_payment(id) on delete cascade,
  demand_id bigint not null references fee_demand(id) on delete cascade,
  amount numeric(12,2) not null check (amount > 0),
  primary key (payment_id, demand_id)
);
create table fee_exemption (
  id bigint primary key default nextval('erp_id_seq'),
  demand_id bigint not null references fee_demand(id) on delete cascade,
  amount numeric(12,2) not null check (amount > 0),
  reason_code text not null,
  remarks text,
  status_code text not null default 'PENDING',  -- PENDING / APPROVED / REJECTED
  requested_by text, requested_at timestamptz not null default now(),
  decided_by text, decided_at timestamptz
);

-- Derived status per demand. Status is never stored, so it cannot drift.
create view fee_demand_v as
select d.*,
  coalesce(p.paid, 0)      as paid_amount,
  coalesce(x.exempted, 0)  as exempted_amount,
  greatest(d.amount - coalesce(p.paid,0) - coalesce(x.exempted,0), 0) as balance_amount,
  case
    when d.cancelled_flag = 'Y' then 'CANCELLED'
    when coalesce(x.exempted,0) >= d.amount and d.amount > 0 then 'FULL_EXEMPT'
    when coalesce(x.exempted,0) > 0 then 'PARTIAL_EXEMPT'
    when coalesce(p.paid,0) >= d.amount then 'PAID'
    when coalesce(p.paid,0) > 0 then 'PARTIAL'
    else 'UNPAID'
  end as payment_status
from fee_demand d
left join (
  select a.demand_id, sum(a.amount) paid
  from fee_allocation a join fee_payment fp on fp.id = a.payment_id and fp.status_code = 'ACTIVE'
  group by a.demand_id) p on p.demand_id = d.id
left join (
  select demand_id, sum(amount) exempted from fee_exemption where status_code = 'APPROVED' group by demand_id
) x on x.demand_id = d.id;

-- Exams -------------------------------------------------------------------
create table exam_fee (
  id bigint primary key default nextval('erp_id_seq'),
  academic_year_id bigint not null references academic_year(id),
  exam_type_code text not null,
  student_grade_id bigint not null references student_grade(id),
  amount numeric(12,2) not null check (amount >= 0),
  unique (academic_year_id, exam_type_code, student_grade_id)
);
create table exam (
  id bigint primary key default nextval('erp_id_seq'),
  enterprise_id bigint not null references enterprise(id),
  academic_year_id bigint not null references academic_year(id),
  exam_type_code text not null,             -- GRADE_EXAM / ASSESSMENT / TERM_EXAM
  name text not null,
  description text,
  business_unit_id bigint references business_unit(id),
  class_id bigint references class(id),
  from_grade_id bigint references student_grade(id),
  target_grade_id bigint references student_grade(id),
  exam_date date not null,
  min_attendance_pct numeric(5,2),
  fees_cleared_flag text not null default 'N',
  min_months_in_grade int,
  min_age int,
  pass_percentage numeric(5,2),
  status_code text not null default 'SCHEDULED',
  created_by text, creation_date timestamptz not null default now(),
  last_updated_by text, last_update_date timestamptz not null default now()
);
create table exam_subject (
  id bigint primary key default nextval('erp_id_seq'),
  exam_id bigint not null references exam(id) on delete cascade,
  subject_id bigint not null references subject(id),
  subject_type_code text not null,
  max_marks numeric(8,2) not null,
  pass_marks numeric(8,2) not null,
  display_seq int not null default 0,
  unique (exam_id, subject_id, subject_type_code)
);
create table exam_candidate (
  id bigint primary key default nextval('erp_id_seq'),
  exam_id bigint not null references exam(id) on delete cascade,
  person_id bigint not null references person(id) on delete cascade,
  assignment_id bigint references assignment(id),
  academic_year_id bigint not null references academic_year(id),
  exam_type_code text not null,
  current_grade_id bigint references student_grade(id),
  fee_demand_id bigint references fee_demand(id) on delete set null,
  result_code text not null default 'PENDING',
  total_marks numeric(10,2),
  percentage numeric(6,2),
  promoted_flag text not null default 'N',
  assigned_by text, assigned_at timestamptz not null default now(),
  unique (exam_id, person_id)
);
-- A student can appear for only ONE grade exam per academic year
create unique index exam_candidate_one_grade_exam
  on exam_candidate(person_id, academic_year_id) where exam_type_code = 'GRADE_EXAM';
create table exam_mark (
  candidate_id bigint not null references exam_candidate(id) on delete cascade,
  exam_subject_id bigint not null references exam_subject(id) on delete cascade,
  marks numeric(8,2),
  absent_flag text not null default 'N',
  entered_by text, entered_at timestamptz not null default now(),
  primary key (candidate_id, exam_subject_id)
);

-- Events ----------------------------------------------------------------
create table event (
  id bigint primary key default nextval('erp_id_seq'),
  enterprise_id bigint not null references enterprise(id),
  name text not null,
  event_type_code text not null,
  business_unit_id bigint references business_unit(id),
  start_date date not null,
  end_date date not null,
  venue text,
  description text,
  fee_amount numeric(12,2) not null default 0,
  status_code text not null default 'PLANNED',
  created_by text, creation_date timestamptz not null default now(),
  last_updated_by text, last_update_date timestamptz not null default now(),
  check (end_date >= start_date)
);
create table event_participant (
  id bigint primary key default nextval('erp_id_seq'),
  event_id bigint not null references event(id) on delete cascade,
  person_id bigint not null references person(id) on delete cascade,
  participation_code text,
  achievement text,
  fee_demand_id bigint references fee_demand(id) on delete set null,
  assigned_by text, assigned_at timestamptz not null default now(),
  unique (event_id, person_id)
);

-- Inventory -------------------------------------------------------------
create table item (
  id bigint primary key default nextval('erp_id_seq'),
  enterprise_id bigint not null references enterprise(id),
  code text not null,
  name text not null,
  category_code text not null,
  size_label text,
  uom_code text not null default 'EA',
  unit_price numeric(12,2) not null default 0,
  reorder_level numeric(12,2) not null default 0,
  active_flag text not null default 'Y',
  created_by text, creation_date timestamptz not null default now(),
  last_updated_by text, last_update_date timestamptz not null default now(),
  unique (enterprise_id, code)
);
create table stock_txn (
  id bigint primary key default nextval('erp_id_seq'),
  item_id bigint not null references item(id),
  business_unit_id bigint not null references business_unit(id),
  txn_date date not null,
  txn_type_code text not null,            -- RECEIPT / SALE / RETURN / ADJUSTMENT
  quantity numeric(12,2) not null,        -- signed: + in, - out
  unit_price numeric(12,2),
  person_id bigint references person(id) on delete set null,
  fee_demand_id bigint references fee_demand(id) on delete set null,
  reference text,
  remarks text,
  created_by text, creation_date timestamptz not null default now()
);

-- Finance (non-fee income and expenses) -----------------------------------
create table finance_txn (
  id bigint primary key default nextval('erp_id_seq'),
  enterprise_id bigint not null references enterprise(id),
  business_unit_id bigint references business_unit(id),
  txn_date date not null,
  txn_kind text not null check (txn_kind in ('INCOME','EXPENSE')),
  category_code text not null,
  amount numeric(12,2) not null check (amount > 0),
  payment_mode_code text,
  description text,
  reference text,
  created_by text, creation_date timestamptz not null default now()
);
