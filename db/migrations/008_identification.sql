-- Identification documents (Aadhaar, passport ...) for students and staff
insert into lookup_type (lookup_type, meaning, description, module_code, access_level, parent_lookup_type, created_by)
values ('IDENTIFICATION_TYPE', 'Identification Type', 'Tag = optional format rule (regular expression) for the number', 'COMMON', 'USER', null, 'MIGRATION')
on conflict (lookup_type) do nothing;
insert into lookup_value (lookup_type, lookup_code, meaning, description, tag, display_seq, created_by) values
  ('IDENTIFICATION_TYPE', 'AADHAAR', 'Aadhaar', '12 digits', '^[0-9]{12}$', 10, 'MIGRATION'),
  ('IDENTIFICATION_TYPE', 'PASSPORT', 'Passport', 'Letter + 7 digits (Indian passport)', '^[A-Z][0-9]{7}$', 20, 'MIGRATION'),
  ('IDENTIFICATION_TYPE', 'PAN', 'PAN Card', 'e.g. ABCDE1234F', '^[A-Z]{5}[0-9]{4}[A-Z]$', 30, 'MIGRATION'),
  ('IDENTIFICATION_TYPE', 'DRIVING_LICENCE', 'Driving Licence', null, null, 40, 'MIGRATION'),
  ('IDENTIFICATION_TYPE', 'VOTER_ID', 'Voter ID (EPIC)', null, '^[A-Z]{3}[0-9]{7}$', 50, 'MIGRATION'),
  ('IDENTIFICATION_TYPE', 'BIRTH_CERT', 'Birth Certificate', null, null, 60, 'MIGRATION')
on conflict (lookup_type, lookup_code) do nothing;

create table if not exists person_identifier (
  id               bigint primary key default nextval('erp_id_seq'),
  enterprise_id    bigint not null references enterprise(id),
  person_id        bigint not null references person(id) on delete cascade,
  id_type_code     text not null,
  id_number        text not null,
  -- number without spaces / hyphens, upper case: used for the uniqueness rule
  id_number_norm   text generated always as (upper(regexp_replace(id_number, '[\s-]', '', 'g'))) stored,
  issuing_country_code text,
  issue_date       date,
  expiry_date      date,
  primary_flag     text not null default 'N',
  created_by text, creation_date timestamptz not null default now(),
  last_updated_by text, last_update_date timestamptz not null default now(),
  check (expiry_date is null or issue_date is null or expiry_date >= issue_date)
);
-- the same document can belong to only one person
create unique index if not exists person_identifier_unique on person_identifier(enterprise_id, id_type_code, id_number_norm);
create index if not exists person_identifier_person_idx on person_identifier(person_id);
create index if not exists person_identifier_norm_idx on person_identifier(id_number_norm);
