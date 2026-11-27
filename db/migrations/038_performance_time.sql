-- Individual performances: a time window each participant must perform within.
alter table game_flow add column if not exists perform_min_seconds int;
alter table game_flow add column if not exists perform_max_seconds int;
alter table game_flow add column if not exists time_penalty numeric(8,2) not null default 0;   -- marks deducted when outside the window
alter table event_competition add column if not exists perform_min_seconds int;            -- per competition (empty = the flow's)
alter table event_competition add column if not exists perform_max_seconds int;
alter table event_entry add column if not exists perform_seconds int;
alter table event_entry add column if not exists evaluation_score numeric(10,2);            -- template mark before any time deduction
