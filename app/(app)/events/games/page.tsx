import Link from 'next/link';
import { requirePriv, can } from '@/lib/auth';
import { sql } from '@/lib/db';
import { PageHeader, Flash, Field, Select, Back, Badge, Empty, type SP, s as one, here } from '@/components/ui';
import { ConfirmButton, ShowFor } from '@/components/client';
import { saveGameType, deleteGameType, saveGameFlow, deleteGameFlow } from './actions';
import { FLOW_KINDS } from '@/lib/tournament';

/** Events › Game Types & Flows. */
export default async function Games({ searchParams }: { searchParams: SP }) {
  const u = await requirePriv('CD_GAME_SETUP_PRV');
  const write = can(u, 'CD_GAME_SETUP_PRV', 'WRITE');
  const sp = await searchParams;
  const games = await sql`select g.*, (select count(*) from game_flow f where f.game_type_id = g.id)::int flows from game_type g where g.enterprise_id = ${u.enterpriseId} order by g.display_seq, g.name`;
  const game = games.find((g) => String(g.id) === one(sp.game)) ?? games[0];
  const flows = game ? await sql`select f.*, (select name from evaluation_template t where t.id = f.evaluation_template_id) template_name from game_flow f where f.game_type_id = ${game.id} order by f.id` : [];
  const templates = (await sql`select t.id, t.name, (select coalesce(sum(weight_pct), 0)::float from evaluation_section s where s.template_id = t.id) w from evaluation_template t where t.enterprise_id = ${u.enterpriseId} and t.active_flag = 'Y' order by t.name`)
    .map((t) => ({ value: String(t.id), label: `${t.name} (total ${t.w})` }));
  const edit = flows.find((f) => String(f.id) === one(sp.flow));
  const back = here('/events/games', sp);
  const kindLabel = (k: string) => FLOW_KINDS.find((x) => x[0] === k)?.[1] ?? k;
  const e = edit ?? ({} as Record<string, any>);

  return (
    <div className="max-w-6xl">
      <PageHeader title="Game Types & Flows" subtitle="The games played in tournaments, and how each is decided – individual evaluation, knockout fights, or both." />
      <Flash sp={sp} />
      <div className="grid gap-4 lg:grid-cols-[18rem_1fr]">
        <div className="card h-fit">
          <h2 className="h2">Game Types</h2>
          <ul className="space-y-1">{games.map((g) => (
            <li key={g.id}><Link href={`/events/games?game=${g.id}`} className={`flex items-center justify-between rounded px-2 py-1 text-sm ${game && g.id === game.id ? 'bg-sky-50 font-semibold text-sky-800' : 'hover:bg-slate-50'}`}>
              <span>{g.name}{g.active_flag === 'N' && <span className="ml-1 text-xs text-slate-400">(inactive)</span>}</span><span className="text-xs text-slate-500">{g.flows} flow(s)</span></Link></li>))}</ul>
          {write && (
            <form action={saveGameType.bind(null, null)} className="mt-3 flex gap-2 border-t pt-3">
              <Back to="/events/games" /><input name="name" placeholder="New game, e.g. Kabaddi" required className="input" aria-label="New game type" /><button className="btn btn-sm">Add</button>
            </form>)}
        </div>

        {game ? (
          <div className="space-y-4">
            <div className="card">
              <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="h2 mb-0">{game.name}</h2>
                {write && <form action={deleteGameType.bind(null, game.id)}><Back to={back} /><ConfirmButton className="btn btn-sm" message={`Delete the game type ${game.name} with its flows?`}>Delete game</ConfirmButton></form>}</div>
              {write && (
                <form action={saveGameType.bind(null, game.id)} className="mt-2 grid gap-2 sm:grid-cols-4">
                  <Back to={back} />
                  <Field label="Name"><input name="name" defaultValue={game.name} required className="input" /></Field>
                  <Field label="Code"><input name="code" defaultValue={game.code} className="input" /></Field>
                  <Field label="Active"><select name="active_flag" defaultValue={game.active_flag} className="input"><option value="Y">Yes</option><option value="N">No</option></select></Field>
                  <div className="flex items-end"><button className="btn btn-sm">Save</button></div>
                </form>)}
            </div>
            <div className="card overflow-x-auto">
              <h3 className="mb-2 font-semibold">Game Flows</h3>
              <table className="tbl"><thead><tr><th>Flow</th><th>Type</th><th>Evaluation Template</th><th>Rounds</th><th>Round time</th><th>Foul</th><th>Tie-break</th><th></th></tr></thead>
                <tbody>{flows.map((f) => (
                  <tr key={f.id} className={edit && edit.id === f.id ? 'bg-sky-50' : ''}>
                    <td>{f.name}{f.active_flag === 'N' && <span className="ml-1 text-xs text-slate-400">(inactive)</span>}<div className="text-xs text-slate-500">{f.description}</div></td>
                    <td><Badge color={f.flow_kind === 'INDIVIDUAL' ? 'blue' : f.flow_kind === 'FIGHT' ? 'red' : 'purple'}>{kindLabel(f.flow_kind)}</Badge></td>
                    <td className="text-sm">{f.flow_kind === 'FIGHT' ? '—' : f.template_name ?? <span className="text-amber-700">choose per competition</span>}</td>
                    <td className="text-sm">{f.flow_kind === 'INDIVIDUAL' ? '—' : `${f.regular_rounds} + ${f.extra_rounds} if tied`}</td>
                    <td className="text-sm">{f.flow_kind === 'INDIVIDUAL' ? '—' : `${Number(f.round_minutes)} min`}</td>
                    <td className="text-sm">{f.flow_kind === 'INDIVIDUAL' ? '—' : `−${Number(f.foul_points)} each`}</td>
                    <td className="text-xs">{f.flow_kind === 'INDIVIDUAL' ? 'highest mark wins' : [f.allow_final_round === 'Y' && 'final round', f.allow_toss === 'Y' && 'toss'].filter(Boolean).join(' or ') || 'none'}</td>
                    <td className="whitespace-nowrap">{write && <div className="flex gap-1"><Link className="btn btn-sm" href={`/events/games?game=${game.id}&flow=${f.id}`}>Edit</Link>
                      <form action={deleteGameFlow.bind(null, game.id, f.id)}><Back to={back} /><ConfirmButton className="btn btn-sm" message={`Delete the ${f.name} flow?`}>✕</ConfirmButton></form></div>}</td>
                  </tr>))}</tbody></table>
              {!flows.length && <Empty>No flows yet – add how {game.name} is decided.</Empty>}
            </div>
            {write && (
              <form key={edit?.id ?? 'new'} action={saveGameFlow.bind(null, game.id, edit ? String(edit.id) : null)} className={`card ${edit ? '' : 'bg-green-50/40'}`}>
                <Back to={back} />
                <h3 className="mb-2 font-semibold">{edit ? `Edit ${edit.name}` : `Add a flow to ${game.name}`}</h3>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <Field label="Flow Name *"><input name="name" defaultValue={e.name} required className="input" placeholder="e.g. Stick Fight Based" /></Field>
                  <Field label="Flow Type *" className="lg:col-span-2">
                    <select name="flow_kind" defaultValue={e.flow_kind ?? 'INDIVIDUAL'} className="input">{FLOW_KINDS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
                    <ShowFor select="flow_kind" />
                  </Field>
                  <Field label="Active"><select name="active_flag" defaultValue={e.active_flag ?? 'Y'} className="input"><option value="Y">Yes</option><option value="N">No</option></select></Field>
                  <div data-show-for-flow_kind="INDIVIDUAL,INDIVIDUAL_FIGHT" className="lg:col-span-2">
                    <Field label="Default Evaluation Template" help="Sections and criteria the judges score (can be changed per competition)"><Select name="evaluation_template_id" options={templates} value={e.evaluation_template_id ? String(e.evaluation_template_id) : ''} empty="— Choose per competition —" /></Field>
                  </div>
                  <div data-show-for-flow_kind="FIGHT,INDIVIDUAL_FIGHT" className="grid gap-3 sm:grid-cols-3 lg:col-span-4">
                    <Field label="Rounds per bout"><input name="regular_rounds" type="number" min="1" defaultValue={e.regular_rounds ?? 2} className="input" /></Field>
                    <Field label="Extra rounds when tied" help="e.g. rounds 3 and 4"><input name="extra_rounds" type="number" min="0" defaultValue={e.extra_rounds ?? 2} className="input" /></Field>
                    <Field label="Minutes per round"><input name="round_minutes" type="number" step="0.25" min="0.25" defaultValue={e.round_minutes ? Number(e.round_minutes) : 2} className="input" /></Field>
                    <Field label="Marks deducted per foul"><input name="foul_points" type="number" step="0.25" min="0" defaultValue={e.foul_points ? Number(e.foul_points) : 1} className="input" /></Field>
                    <Field label="Still tied: a final round"><select name="allow_final_round" defaultValue={e.allow_final_round ?? 'Y'} className="input"><option value="Y">Allowed (e.g. round 5)</option><option value="N">No</option></select></Field>
                    <Field label="Still tied: a toss"><select name="allow_toss" defaultValue={e.allow_toss ?? 'Y'} className="input"><option value="Y">Allowed (head / tail)</option><option value="N">No</option></select></Field>
                  </div>
                  <Field label="Description" className="lg:col-span-4"><input name="description" defaultValue={e.description ?? ''} className="input" /></Field>
                </div>
                <div className="mt-3 flex gap-2"><button className="btn btn-primary">{edit ? 'Save Flow' : 'Add Flow'}</button>{edit && <Link className="btn" href={`/events/games?game=${game.id}`}>Cancel</Link>}</div>
              </form>)}
          </div>
        ) : <div className="card muted">No game types yet.</div>}
      </div>
    </div>
  );
}
