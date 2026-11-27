'use server';
import { sql } from '@/lib/db';
import { requirePriv } from '@/lib/auth';
import { act, backOf, formObj } from '@/lib/util';

const PRIV = 'CD_GAME_SETUP_PRV';
const codeOf = (s: string) => s.toUpperCase().trim().replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '');

export async function saveGameType(id: string | null, fd: FormData) {
  const u = await requirePriv(PRIV, 'WRITE');
  await act(backOf(fd, '/events/games'), async () => {
    const o = formObj(fd);
    if (!o.name) throw new Error('The game name is required');
    const code = codeOf(o.code ?? o.name);
    const [dup] = await sql`select 1 from game_type where enterprise_id = ${u.enterpriseId} and (code = ${code} or lower(name) = lower(${o.name})) and id <> ${id ?? 0}`;
    if (dup) throw new Error(`${o.name} already exists`);
    const v = { code, name: o.name, active_flag: o.active_flag === 'N' ? 'N' : 'Y', display_seq: Number(o.display_seq ?? 0) };
    if (id) await sql`update game_type set ${sql(v)} where id = ${id} and enterprise_id = ${u.enterpriseId}`;
    else await sql`insert into game_type ${sql({ ...v, enterprise_id: u.enterpriseId, created_by: u.username })}`;
    return { msg: `${o.name} game type has been ${id ? 'updated' : 'created'}.` };
  });
}

export async function deleteGameType(id: string, fd: FormData) {
  const u = await requirePriv(PRIV, 'WRITE');
  await act(backOf(fd, '/events/games'), async () => {
    const [g] = await sql`select * from game_type where id = ${id} and enterprise_id = ${u.enterpriseId}`;
    if (!g) throw new Error('Game type not found');
    const [used] = await sql`select count(*)::int n from event_competition c join game_flow f on f.id = c.game_flow_id where f.game_type_id = ${id}`;
    if (used.n) throw new Error(`${g.name} is used in ${used.n} tournament competition(s) – make it inactive instead.`);
    await sql`delete from game_type where id = ${id}`;
    return { to: '/events/games', msg: `${g.name} game type has been deleted.` };
  });
}

export async function saveGameFlow(gameTypeId: string, id: string | null, fd: FormData) {
  const u = await requirePriv(PRIV, 'WRITE');
  await act(backOf(fd, '/events/games'), async () => {
    const [g] = await sql`select * from game_type where id = ${gameTypeId} and enterprise_id = ${u.enterpriseId}`;
    if (!g) throw new Error('Game type not found');
    const o = formObj(fd);
    if (!o.name || !o.flow_kind) throw new Error('Flow name and type are required');
    if (!['INDIVIDUAL', 'FIGHT', 'INDIVIDUAL_FIGHT'].includes(o.flow_kind)) throw new Error('Unknown flow type');
    const n = (k: string, d: number) => (o[k] === null || o[k] === undefined ? d : Number(o[k]));
    const v = {
      code: codeOf(o.code ?? o.name), name: o.name, flow_kind: o.flow_kind, description: o.description,
      evaluation_template_id: o.flow_kind === 'FIGHT' ? null : o.evaluation_template_id,
      regular_rounds: n('regular_rounds', 2), extra_rounds: n('extra_rounds', 2), round_minutes: n('round_minutes', 2), foul_points: n('foul_points', 1),
      allow_final_round: o.allow_final_round === 'N' ? 'N' : 'Y', allow_toss: o.allow_toss === 'N' ? 'N' : 'Y', active_flag: o.active_flag === 'N' ? 'N' : 'Y',
    };
    if (v.regular_rounds < 1 || v.extra_rounds < 0 || v.round_minutes <= 0 || v.foul_points < 0) throw new Error('Rounds, minutes and foul marks must be positive numbers');
    const [dup] = await sql`select 1 from game_flow where game_type_id = ${gameTypeId} and code = ${v.code} and id <> ${id ?? 0}`;
    if (dup) throw new Error(`${g.name} already has a flow coded ${v.code}`);
    if (id) await sql`update game_flow set ${sql(v)} where id = ${id} and game_type_id = ${gameTypeId}`;
    else await sql`insert into game_flow ${sql({ ...v, game_type_id: gameTypeId, created_by: u.username })}`;
    return { to: `/events/games?game=${gameTypeId}`, msg: `${o.name} flow of ${g.name} has been ${id ? 'updated' : 'created'}.` };
  });
}

export async function deleteGameFlow(gameTypeId: string, id: string, fd: FormData) {
  const u = await requirePriv(PRIV, 'WRITE');
  await act(backOf(fd, '/events/games'), async () => {
    const [f] = await sql`select f.* from game_flow f join game_type g on g.id = f.game_type_id where f.id = ${id} and g.enterprise_id = ${u.enterpriseId}`;
    if (!f) throw new Error('Flow not found');
    const [used] = await sql`select count(*)::int n from event_competition where game_flow_id = ${id}`;
    if (used.n) throw new Error(`${f.name} is used in ${used.n} competition(s) – make it inactive instead.`);
    await sql`delete from game_flow where id = ${id}`;
    return { to: `/events/games?game=${gameTypeId}`, msg: `${f.name} flow has been deleted.` };
  });
}
