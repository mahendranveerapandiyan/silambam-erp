-- =====================================================================
-- Silambam ERP - Core schema
-- Conventions
--   * Date-tracked ("_f") tables: (id, effective_start_date) primary key,
--     effective_end_date defaults to 4712-12-31 (end of time) and an
--     exclusion constraint forbids overlapping versions of the same id.
--   * Every list value (incl. Yes/No) is a lookup code (lookup_value).
--   * Audit columns on every table.
-- =====================================================================
create extension if not exists btree_gist;
create sequence if not exists erp_id_seq start 10000;

-- ---------------------------------------------------------------------
-- Lookups
-- ---------------------------------------------------------------------
create table lookup_type (
  lookup_type      text primary key,
  meaning          text not null,
  description      text,
  module_code      text not null default 'COMMON',
  access_level     text not null default 'USER' check (access_level in ('SYSTEM','EXTENSIBLE','USER')),
  parent_lookup_type text references lookup_type(lookup_type),
  created_by text, creation_date timestamptz not null default now(),
  last_updated_by text, last_update_date timestamptz not null default now()
);

create table lookup_value (
  lookup_type   text not null references lookup_type(lookup_type) on delete cascade,
  lookup_code   text not null,
  meaning       text not null,
  description   text,
  tag           text,
  display_seq   int not null default 0,
  enabled_flag  text not null default 'Y',
  start_date    date not null default date '1951-01-01',
  end_date      date not null default date '4712-12-31',
  parent_code   text,
  system_flag   text not null default 'N',
  created_by text, creation_date timestamptz not null default now(),
  last_updated_by text, last_update_date timestamptz not null default now(),
  primary key (lookup_type, lookup_code),
  check (end_date >= start_date)
);
create index lookup_value_parent_idx on lookup_value(lookup_type, parent_code);

-- ---------------------------------------------------------------------
-- Enterprise (top of the enterprise structure)
-- ---------------------------------------------------------------------
create table enterprise (
  id            bigint primary key default nextval('erp_id_seq'),
  code          text not null unique,
  name          text not null,
  short_name    text,
  country_code  text,
  currency_code text,
  timezone      text not null default 'Asia/Kolkata',
  address       text,
  phone         text,
  email         text,
  website       text,
  logo_mime     text,
  logo_data     bytea,
  created_by text, creation_date timestamptz not null default now(),
  last_updated_by text, last_update_date timestamptz not null default now(),
  object_version_number int not null default 1
);

-- Helper: creates a date-tracked entity (base + _f table)
create or replace function erp_create_dt(p_name text, p_cols text) returns void
language plpgsql as $$
begin
  execute format(
    'create table %I (
       id bigint primary key default nextval(''erp_id_seq''),
       enterprise_id bigint not null references enterprise(id),
       code text not null,
       created_by text, creation_date timestamptz not null default now(),
       unique (enterprise_id, code))', p_name);
  execute format(
    'create table %I (
       id bigint not null references %I(id) on delete cascade,
       effective_start_date date not null,
       effective_end_date date not null default date ''4712-12-31'',
       name text not null,
       description text,
       %s
       created_by text, creation_date timestamptz not null default now(),
       last_updated_by text, last_update_date timestamptz not null default now(),
       object_version_number int not null default 1,
       primary key (id, effective_start_date),
       check (effective_end_date >= effective_start_date),
       exclude using gist (id with =, daterange(effective_start_date, effective_end_date, ''[]'') with &&))',
    p_name || '_f', p_name, case when coalesce(p_cols,'') = '' then '' else p_cols || ',' end);
end $$;

-- Enterprise structure ------------------------------------------------
select erp_create_dt('location', $c$
  location_type_code text, address_line1 text, address_line2 text, city text,
  state_code text, country_code text, postal_code text, phone text, active_flag text not null default 'Y'
$c$);
select erp_create_dt('division', $c$ active_flag text not null default 'Y' $c$);
select erp_create_dt('legal_employer', $c$
  division_id bigint references division(id), registration_number text, tax_number text,
  location_id bigint references location(id), currency_code text, active_flag text not null default 'Y'
$c$);
select erp_create_dt('business_unit', $c$
  legal_employer_id bigint not null references legal_employer(id),
  location_id bigint references location(id), phone text, email text, active_flag text not null default 'Y'
$c$);
select erp_create_dt('class', $c$
  business_unit_id bigint not null references business_unit(id), batch_timing text,
  training_days text, capacity int, active_flag text not null default 'Y'
$c$);
select erp_create_dt('section', $c$
  class_id bigint not null references class(id), capacity int, active_flag text not null default 'Y'
$c$);

-- Academic structure --------------------------------------------------
create table academic_year (
  id            bigint primary key default nextval('erp_id_seq'),
  enterprise_id bigint not null references enterprise(id),
  code          text not null,
  name          text not null,
  start_date    date not null,
  end_date      date not null,
  status_code   text not null default 'OPEN',
  created_by text, creation_date timestamptz not null default now(),
  last_updated_by text, last_update_date timestamptz not null default now(),
  object_version_number int not null default 1,
  unique (enterprise_id, code),
  check (end_date > start_date),
  exclude using gist (enterprise_id with =, daterange(start_date, end_date, '[]') with &&)
);

select erp_create_dt('student_grade', $c$
  sequence_no int not null default 0, belt_color text, min_months_in_grade int,
  next_grade_id bigint, active_flag text not null default 'Y'
$c$);
select erp_create_dt('house', $c$ color text, active_flag text not null default 'Y' $c$);
select erp_create_dt('club', $c$ active_flag text not null default 'Y' $c$);
select erp_create_dt('community', $c$ active_flag text not null default 'Y' $c$);
select erp_create_dt('subject', $c$
  subject_type_code text not null, default_max_marks numeric(8,2), default_pass_marks numeric(8,2),
  active_flag text not null default 'Y'
$c$);

-- Shared person/assignment setup ---------------------------------------
select erp_create_dt('person_type', $c$
  person_category text not null check (person_category in ('STUDENT','STAFF')),
  active_flag text not null default 'Y'
$c$);
select erp_create_dt('assignment_status', $c$
  person_category text not null check (person_category in ('STUDENT','STAFF')),
  system_status_code text not null, payroll_eligible_flag text not null default 'N',
  active_flag text not null default 'Y'
$c$);
select erp_create_dt('action', $c$
  person_category text not null check (person_category in ('STUDENT','STAFF')),
  action_type_code text not null, assignment_status_id bigint references assignment_status(id),
  active_flag text not null default 'Y'
$c$);

-- Workforce structure ---------------------------------------------------
select erp_create_dt('job', $c$ job_family_code text, active_flag text not null default 'Y' $c$);
select erp_create_dt('staff_grade', $c$
  min_salary numeric(12,2), max_salary numeric(12,2), currency_code text, active_flag text not null default 'Y'
$c$);
select erp_create_dt('department', $c$
  business_unit_id bigint references business_unit(id), location_id bigint references location(id),
  active_flag text not null default 'Y'
$c$);
select erp_create_dt('position', $c$
  business_unit_id bigint references business_unit(id), department_id bigint references department(id),
  job_id bigint references job(id), staff_grade_id bigint references staff_grade(id),
  headcount int not null default 1, full_time_flag text not null default 'Y',
  active_flag text not null default 'Y'
$c$);

-- ---------------------------------------------------------------------
-- Number generation
-- ---------------------------------------------------------------------
create table number_rule (
  id              bigint primary key default nextval('erp_id_seq'),
  enterprise_id   bigint not null references enterprise(id),
  object_code     text not null,
  method_code     text not null default 'AUTO',
  scope_code      text not null default 'ENTERPRISE',
  prefix          text,
  suffix          text,
  separator       text not null default '',
  include_scope_code_flag text not null default 'N',
  include_year_flag text not null default 'N',
  reset_yearly_flag text not null default 'N',
  padding         int not null default 4,
  start_number    bigint not null default 1,
  active_flag     text not null default 'Y',
  created_by text, creation_date timestamptz not null default now(),
  last_updated_by text, last_update_date timestamptz not null default now(),
  object_version_number int not null default 1,
  unique (enterprise_id, object_code)
);
create table number_sequence (
  rule_id   bigint not null references number_rule(id) on delete cascade,
  scope_id  bigint not null default 0,
  period    text not null default 'ALL',
  last_value bigint not null,
  primary key (rule_id, scope_id, period)
);

-- ---------------------------------------------------------------------
-- UI management
-- ---------------------------------------------------------------------
create table ui_setting (
  enterprise_id bigint not null references enterprise(id),
  setting_key   text not null,
  setting_value text not null,
  last_updated_by text, last_update_date timestamptz not null default now(),
  primary key (enterprise_id, setting_key)
);

-- ---------------------------------------------------------------------
-- Person & assignments (students and staff share one person model)
-- ---------------------------------------------------------------------
create table person (
  id             bigint primary key default nextval('erp_id_seq'),
  enterprise_id  bigint not null references enterprise(id),
  person_number  text not null,
  date_of_birth  date,
  qr_token       text not null unique,
  created_by text, creation_date timestamptz not null default now(),
  unique (enterprise_id, person_number)
);
create table person_f (
  id bigint not null references person(id) on delete cascade,
  effective_start_date date not null,
  effective_end_date date not null default date '4712-12-31',
  title_code text, first_name text not null, middle_name text, last_name text,
  known_as text, gender_code text, blood_group_code text, marital_status_code text,
  nationality_code text, religion_code text, mother_tongue_code text,
  phone text, alt_phone text, email text,
  address_line1 text, address_line2 text, city text, state_code text, country_code text, postal_code text,
  emergency_contact_name text, emergency_contact_phone text, medical_notes text,
  created_by text, creation_date timestamptz not null default now(),
  last_updated_by text, last_update_date timestamptz not null default now(),
  object_version_number int not null default 1,
  primary key (id, effective_start_date),
  check (effective_end_date >= effective_start_date),
  exclude using gist (id with =, daterange(effective_start_date, effective_end_date, '[]') with &&)
);
create table person_photo (
  person_id bigint primary key references person(id) on delete cascade,
  mime text not null, data bytea not null,
  last_update_date timestamptz not null default now()
);
create table person_contact (
  id bigint primary key default nextval('erp_id_seq'),
  person_id bigint not null references person(id) on delete cascade,
  relationship_code text not null,
  name text not null, phone text, email text, occupation text,
  primary_flag text not null default 'N',
  created_by text, creation_date timestamptz not null default now(),
  last_updated_by text, last_update_date timestamptz not null default now()
);

create table assignment (
  id bigint primary key default nextval('erp_id_seq'),
  enterprise_id bigint not null references enterprise(id),
  person_id bigint not null references person(id) on delete cascade,
  assignment_type text not null check (assignment_type in ('STUDENT','STAFF')),
  assignment_number text not null,
  original_start_date date not null,
  created_by text, creation_date timestamptz not null default now(),
  unique (enterprise_id, assignment_type, assignment_number)
);
create unique index assignment_one_per_type on assignment(person_id, assignment_type);
create table assignment_f (
  id bigint not null references assignment(id) on delete cascade,
  effective_start_date date not null,
  effective_end_date date not null default date '4712-12-31',
  action_id bigint references action(id),
  action_reason_code text,
  assignment_status_id bigint references assignment_status(id),
  person_type_id bigint references person_type(id),
  legal_employer_id bigint references legal_employer(id),
  business_unit_id bigint references business_unit(id),
  location_id bigint references location(id),
  -- student attributes
  academic_year_id bigint references academic_year(id),
  class_id bigint references class(id),
  section_id bigint references section(id),
  student_grade_id bigint references student_grade(id),
  house_id bigint references house(id),
  club_id bigint references club(id),
  community_id bigint references community(id),
  fee_frequency_code text,
  -- staff attributes
  job_id bigint references job(id),
  staff_grade_id bigint references staff_grade(id),
  department_id bigint references department(id),
  position_id bigint references position(id),
  employment_type_code text,
  employment_category_code text,
  payroll_status_code text,
  comments text,
  created_by text, creation_date timestamptz not null default now(),
  last_updated_by text, last_update_date timestamptz not null default now(),
  object_version_number int not null default 1,
  primary key (id, effective_start_date),
  check (effective_end_date >= effective_start_date),
  exclude using gist (id with =, daterange(effective_start_date, effective_end_date, '[]') with &&)
);

-- Class incharge (data security for staff) -------------------------------
create table class_incharge (
  id bigint primary key default nextval('erp_id_seq'),
  person_id bigint not null references person(id) on delete cascade,
  class_id bigint not null references class(id),
  section_id bigint references section(id),
  start_date date not null,
  end_date date not null default date '4712-12-31',
  primary_flag text not null default 'Y',
  created_by text, creation_date timestamptz not null default now(),
  check (end_date >= start_date)
);

-- Payment QR images uploaded by incharges / admins ----------------------
create table payment_qr (
  id bigint primary key default nextval('erp_id_seq'),
  person_id bigint references person(id) on delete cascade,
  business_unit_id bigint references business_unit(id),
  label text not null,
  upi_id text,
  mime text not null, data bytea not null,
  active_flag text not null default 'Y',
  created_by text, creation_date timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Users & roles
-- ---------------------------------------------------------------------
create table user_account (
  id bigint primary key default nextval('erp_id_seq'),
  enterprise_id bigint not null references enterprise(id),
  username text not null unique,
  password_hash text not null,
  display_name text not null,
  person_id bigint references person(id) on delete set null,
  active_flag text not null default 'Y',
  must_change_password text not null default 'N',
  last_login timestamptz,
  created_by text, creation_date timestamptz not null default now(),
  last_updated_by text, last_update_date timestamptz not null default now()
);
create table user_role (
  user_id bigint not null references user_account(id) on delete cascade,
  role_code text not null,
  primary key (user_id, role_code)
);
-- parent/guardian logins -> the students they may view
create table user_student_access (
  user_id bigint not null references user_account(id) on delete cascade,
  person_id bigint not null references person(id) on delete cascade,
  primary key (user_id, person_id)
);
