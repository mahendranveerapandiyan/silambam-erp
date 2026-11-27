-- Bout rounds: negative marks are typed directly (no longer a foul count × marks per foul).
alter table event_bout_round alter column red_fouls type numeric(8,2);
alter table event_bout_round alter column blue_fouls type numeric(8,2);
update event_bout_round r set red_fouls = r.red_fouls * f.foul_points, blue_fouls = r.blue_fouls * f.foul_points
from event_bout b join event_competition c on c.id = b.competition_id join game_flow f on f.id = c.game_flow_id
where b.id = r.bout_id and f.foul_points <> 1;
