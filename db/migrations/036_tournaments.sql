-- Tournaments: game types and flows, competition categories, registrations, individual scoring and fight fixtures.

-- evaluation templates: criteria grouped under sections (e.g. "Kai Vilaiyattu" › Lessons, Perfection …)
alter table evaluation_section add column if not exists group_name text;

create table if not exists game_type (
  id bigint primary key default nextval('erp_id_seq'),
  enterprise_id bigint not null references enterprise(id),
  code text not null, name text not null, active_flag text not null default 'Y', display_seq int not null default 0,
  created_by text, creation_date timestamptz not null default now(),
  unique (enterprise_id, code)
);
-- how a game is decided: INDIVIDUAL (highest evaluated mark wins), FIGHT (knockout bouts), INDIVIDUAL_FIGHT (evaluated first, marks carried into the bouts)
create table if not exists game_flow (
  id bigint primary key default nextval('erp_id_seq'),
  game_type_id bigint not null references game_type(id) on delete cascade,
  code text not null, name text not null,
  flow_kind text not null check (flow_kind in ('INDIVIDUAL', 'FIGHT', 'INDIVIDUAL_FIGHT')),
  evaluation_template_id bigint references evaluation_template(id) on delete set null,
  regular_rounds int not null default 2,          -- rounds every bout has
  extra_rounds int not null default 2,            -- added when tied after the regular rounds (rounds 3 and 4)
  allow_final_round text not null default 'Y',    -- a further round (5th) when still tied
  allow_toss text not null default 'Y',           -- or a toss decides
  round_minutes numeric(5,2) not null default 2,
  foul_points numeric(6,2) not null default 1,    -- marks deducted per foul
  active_flag text not null default 'Y', description text,
  created_by text, creation_date timestamptz not null default now(),
  unique (game_type_id, code)
);

insert into game_type (enterprise_id, code, name, display_seq, created_by)
select e.id, v.code, v.name, v.seq, 'MIGRATION' from enterprise e,
  (values ('SILAMBAM', 'Silambam', 10), ('CRICKET', 'Cricket', 20), ('FOOTBALL', 'Football', 30), ('VOLLEYBALL', 'Volleyball', 40), ('BASKETBALL', 'Basketball', 50),
          ('KARATE', 'Karate', 60), ('KUNG_FU', 'Kung Fu', 70), ('TRACK_EVENT', 'Track Event', 80), ('FIELD_EVENT', 'Field Event', 90)) v(code, name, seq)
on conflict do nothing;
insert into game_flow (game_type_id, code, name, flow_kind, description, created_by)
select g.id, v.code, v.name, v.kind, v.descr, 'MIGRATION' from game_type g,
  (values ('INDIVIDUAL', 'Individual Based', 'INDIVIDUAL', 'Each participant is evaluated on the template; the highest mark wins.'),
          ('STICK_FIGHT', 'Stick Fight Based', 'FIGHT', 'Knockout bouts of 2 rounds; tied bouts get rounds 3 and 4, then a 5th round or a toss.'),
          ('INDIVIDUAL_STICK_FIGHT', 'Individual and Stick Fight Based', 'INDIVIDUAL_FIGHT', 'Individual evaluation first (no winner), then the marks are carried into the stick fight bouts.')) v(code, name, kind, descr)
where g.code = 'SILAMBAM'
on conflict do nothing;

-- competition categories: a student qualifies when every rule matches (e.g. Gender = Female and Age < 7)
create table if not exists competition_category (
  id bigint primary key default nextval('erp_id_seq'),
  enterprise_id bigint not null references enterprise(id),
  code text not null, name text not null, description text, active_flag text not null default 'Y',
  created_by text, creation_date timestamptz not null default now(),
  unique (enterprise_id, code)
);
create table if not exists competition_category_rule (
  id bigint primary key default nextval('erp_id_seq'),
  category_id bigint not null references competition_category(id) on delete cascade,
  field_code text not null,     -- AGE, GENDER, WEIGHT, HEIGHT, COMPETITION_CATEGORY, GRADE, CLASS, BRANCH, BUSINESS_UNIT, …
  operator text not null,       -- EQ, NE, LT, LE, GT, GE, IN
  value text not null
);

-- a tournament (event) holds competitions: one game flow for one category
create table if not exists event_competition (
  id bigint primary key default nextval('erp_id_seq'),
  event_id bigint not null references event(id) on delete cascade,
  game_flow_id bigint not null references game_flow(id),
  category_id bigint references competition_category(id),
  name text not null,
  evaluation_template_id bigint references evaluation_template(id),
  round_minutes numeric(5,2),
  status_code text not null default 'REGISTRATION',   -- REGISTRATION, SCORING, FIXTURES, COMPLETED
  created_by text, creation_date timestamptz not null default now()
);
create table if not exists event_entry (
  id bigint primary key default nextval('erp_id_seq'),
  competition_id bigint not null references event_competition(id) on delete cascade,
  person_id bigint not null references person(id) on delete cascade,
  assignment_id bigint references assignment(id),
  slot_no int,
  individual_score numeric(10,2),
  place int,                 -- 1st, 2nd, 3rd …
  registered_by text, registered_at timestamptz not null default now(),
  unique (competition_id, person_id)
);
create unique index if not exists event_entry_slot_uq on event_entry(competition_id, slot_no) where slot_no is not null;
create table if not exists event_entry_score (
  entry_id bigint not null references event_entry(id) on delete cascade,
  section_id bigint not null references evaluation_section(id) on delete cascade,
  value numeric(8,2),
  entered_by text, entered_at timestamptz not null default now(),
  primary key (entry_id, section_id)
);
-- knockout bouts
create table if not exists event_bout (
  id bigint primary key default nextval('erp_id_seq'),
  competition_id bigint not null references event_competition(id) on delete cascade,
  round_no int not null,
  bout_no int not null,
  stage_code text not null default 'ROUND',   -- ROUND, SEMI_FINAL, THIRD_PLACE, FINAL
  red_entry_id bigint references event_entry(id) on delete cascade,
  blue_entry_id bigint references event_entry(id) on delete cascade,   -- null = bye for red
  winner_entry_id bigint references event_entry(id),
  decided_by text,            -- SCORE, TOSS, BYE
  toss_call text,             -- HEAD / TAIL, called by red
  seq int not null default 0,
  unique (competition_id, round_no, bout_no)
);
create table if not exists event_bout_round (
  bout_id bigint not null references event_bout(id) on delete cascade,
  round_no int not null,
  minutes numeric(5,2),
  red_points numeric(8,2), blue_points numeric(8,2),
  red_fouls int not null default 0, blue_fouls int not null default 0,
  entered_by text, entered_at timestamptz not null default now(),
  primary key (bout_id, round_no)
);
