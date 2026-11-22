-- Numbers are now worked out from the numbers actually in use
-- (highest in use + 1). number_sequence keeps a lock row per counter and the
-- optional minimum set with "Set Next Number".
alter table number_sequence add column if not exists next_min bigint;
