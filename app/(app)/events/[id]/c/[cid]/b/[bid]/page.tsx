import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requirePriv, can } from '@/lib/auth';
import { sql } from '@/lib/db';
import { boutState, STAGES, type FlowRules } from '@/lib/tournament';
import { fmtDate } from '@/lib/util';
import { PageHeader, Flash, Back, Badge, type SP, here } from '@/components/ui';
import { ConfirmButton } from '@/components/client';
import { saveBoutScores, decideBout } from '../../../../../tournamentActions';

/** Score sheet of one bout: points and negative marks per round, tie-break rounds, toss, disqualification or referee decision. */
export default async function Bout({ params, searchParams }: { params: Promise<{ id: string; cid: string; bid: string }>; searchParams: SP }) {
  const u = await requirePriv(['CD_EVENT_SETUP_PRV', 'CD_EVENT_PARTICIPANT_PRV', 'CD_TOURNAMENT_SCORING_PRV'], 'READ');
  const { id, cid, bid } = await params;
  const sp = await searchParams;
  const [b] = await sql`select b.*, c.name comp_name, (select name from competition_category k where k.id = c.category_id) category_name, f.name flow_name, c.status_code comp_status, c.round_minutes comp_minutes, e.name event_name, e.start_date,
      f.flow_kind, f.regular_rounds, f.extra_rounds, f.allow_final_round, f.allow_toss, f.foul_points, f.round_minutes flow_minutes
    from event_bout b join event_competition c on c.id = b.competition_id join event e on e.id = c.event_id join game_flow f on f.id = c.game_flow_id
    where b.id = ${bid} and c.id = ${cid} and e.id = ${id} and e.enterprise_id = ${u.enterpriseId}`;
  if (!b || !b.blue_entry_id) notFound();
  const who = async (eid: string) => (await sql`select e.*, a.assignment_number, trim(concat_ws(' ', pf.first_name, pf.last_name)) full_name from event_entry e join assignment a on a.id = e.assignment_id
    left join lateral (select * from person_f x where x.id = e.person_id order by effective_start_date desc limit 1) pf on true where e.id = ${eid}`)[0];
  const red = await who(b.red_entry_id), blue = await who(b.blue_entry_id);
  for (const x of [red, blue]) x.full_name = `#${x.slot_no} ${x.full_name} (${x.assignment_number})`;
  const rounds = await sql`select * from event_bout_round where bout_id = ${bid} order by round_no`;
  const combined = b.flow_kind === 'INDIVIDUAL_FIGHT';
  const ri = combined ? Number(red.individual_score ?? 0) : 0, bi = combined ? Number(blue.individual_score ?? 0) : 0;
  const st = boutState(rounds, b as unknown as FlowRules, ri, bi);
  const [later] = await sql`select 1 from event_bout where competition_id = ${cid} and round_no > ${b.round_no} limit 1`;
  const locked = !can(u, 'CD_TOURNAMENT_SCORING_PRV', 'WRITE') || b.comp_status === 'COMPLETED' || !!later;
  const R = Number(b.regular_rounds), X = Number(b.extra_rounds);
  const minutes = Number(b.comp_minutes ?? b.flow_minutes);
  const R_ = new Map(rounds.map((r) => [Number(r.round_no), r]));
  const show = Math.max(st.shown, ...rounds.map((r) => Number(r.round_no)), R);
  const label = (n: number) => (n <= R ? `Round ${n}` : n <= R + X ? `Round ${n} (tie-break)` : `Round ${n} (final tie-break)`);
  const back = here(`/events/${id}/c/${cid}/b/${bid}`, sp);
  const winner = b.winner_entry_id ? (String(b.winner_entry_id) === String(b.red_entry_id) ? red : blue) : null;

  return (
    <div className="max-w-5xl">
      <PageHeader title={`${red.full_name} vs ${blue.full_name}`}
        subtitle={<>{b.comp_name} · {b.stage_code === 'THIRD_PLACE' ? 'Third place' : STAGES[b.stage_code] === 'Round' ? `Round ${b.round_no}` : STAGES[b.stage_code]} · bout {b.bout_no} · {fmtDate(b.start_date)}</>}
        actions={<Link href={`/events/${id}/c/${cid}?tab=fixtures`} className="btn">Back to fixtures</Link>} />
      <Flash sp={sp} />
      {winner && <div className="card mb-3 border-green-300 bg-green-50"><b>Winner: {winner.full_name}</b> {b.decided_by === 'TOSS' ? `– by toss (${b.toss_call?.replace('/', ' called, ')} came)` : b.decided_by === 'REFEREE' ? '– referee decision' : b.decided_by === 'DISQUALIFIED' ? '– opponent disqualified' : `– ${st.totals.red} : ${st.totals.blue}`}</div>}
      <form key={bid} action={saveBoutScores.bind(null, bid)} className="card overflow-x-auto">
        <Back to={back} />
        <div className="mb-3 grid gap-3 sm:grid-cols-2">
          {[[red, 'Red', 'border-red-300 bg-red-50'], [blue, 'Blue', 'border-blue-300 bg-blue-50']].map(([p, side, cls]) => (
            <div key={side as string} className={`rounded border p-2 text-sm ${cls}`}>
              <div className="font-semibold">{side as string} · {(p as Record<string, any>).full_name}</div>
              <div className="text-xs text-slate-600">Competing method: {b.flow_name}{combined && <> · Individual Score <b>{(p as Record<string, any>).individual_score ?? '—'}</b></>}</div>
            </div>))}
        </div>
        <p className="muted mb-2">Category: <b>{b.category_name ?? 'Open to all'}</b>. Points per round; negative marks are deducted from that side&apos;s total. {R} round(s) are added up; if tied, {X ? `rounds ${R + 1}–${R + X} are fought (all rounds count)` : 'the tie-break follows'}{b.allow_final_round === 'Y' ? ', then a further round' : ''}{b.allow_toss === 'Y' ? ', then a toss' : ''}.</p>
        <table className="tbl">
          <thead><tr><th>Round</th><th>Minutes</th><th className="text-red-700">{red.full_name} – points</th><th className="text-red-700">negative mark</th><th className="text-blue-700">{blue.full_name} – points</th><th className="text-blue-700">negative mark</th></tr></thead>
          <tbody>
            {combined && <tr className="bg-slate-50"><td colSpan={2}>Individual Mark (carried in)</td><td colSpan={2} className="font-semibold">{ri}</td><td colSpan={2} className="font-semibold">{bi}</td></tr>}
            {Array.from({ length: show }, (_, i) => i + 1).map((n) => {
              const r = R_.get(n);
              return (
                <tr key={n} className={n > R ? 'bg-amber-50/60' : ''}>
                  <td>{label(n)}<input type="hidden" name={`seen_${n}`} value="1" /></td>
                  <td><input name={`min_${n}`} type="number" step="0.25" min="0" defaultValue={r?.minutes ?? minutes} disabled={locked} className="input w-20" aria-label={`Round ${n} minutes`} /></td>
                  <td><input name={`red_${n}`} type="number" step="0.25" min="0" defaultValue={r?.red_points ?? ''} placeholder="0" disabled={locked} className="input w-24" aria-label={`Round ${n} red points`} /></td>
                  <td><input name={`redf_${n}`} type="number" step="0.25" min="0" defaultValue={r?.red_fouls != null ? Number(r.red_fouls) : ''} placeholder="0" disabled={locked} className="input w-20" aria-label={`Round ${n} red negative mark`} /></td>
                  <td><input name={`blue_${n}`} type="number" step="0.25" min="0" defaultValue={r?.blue_points ?? ''} placeholder="0" disabled={locked} className="input w-24" aria-label={`Round ${n} blue points`} /></td>
                  <td><input name={`bluef_${n}`} type="number" step="0.25" min="0" defaultValue={r?.blue_fouls != null ? Number(r.blue_fouls) : ''} placeholder="0" disabled={locked} className="input w-20" aria-label={`Round ${n} blue negative mark`} /></td>
                </tr>);
            })}
          </tbody>
          <tfoot><tr className="font-semibold"><td colSpan={2}>Total (negative marks deducted)</td><td colSpan={2} className="text-red-700">{st.totals.red}</td><td colSpan={2} className="text-blue-700">{st.totals.blue}</td></tr></tfoot>
        </table>
        {st.tie && !winner && <p className="mt-2 text-sm font-semibold text-amber-700">Tied after {Math.min(st.shown, rounds.length)} round(s){st.tossOpen || st.refereeOpen ? '' : ' – fight the next round(s) shown above'}.</p>}
        {!locked && <button className="btn btn-primary mt-3">Save Scores</button>}
      </form>
      {!locked && !winner && (st.tossOpen || st.refereeOpen) && (
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          {st.tossOpen && (
            <form action={decideBout.bind(null, bid)} className="card space-y-2">
              <Back to={back} /><input type="hidden" name="mode" value="TOSS" />
              <h3 className="font-semibold">Decide by toss</h3>
              <p className="muted">{red.full_name} (red) calls; the winner of the toss wins the bout.</p>
              <div className="flex gap-2">
                <label className="text-sm">Call <select name="call" className="input" required><option value="">—</option><option value="HEAD">Head</option><option value="TAIL">Tail</option></select></label>
                <label className="text-sm">Coin came <select name="result" className="input" required><option value="">—</option><option value="HEAD">Head</option><option value="TAIL">Tail</option></select></label>
              </div>
              <ConfirmButton className="btn btn-primary" message="Record the toss and decide the bout?">Record Toss</ConfirmButton>
            </form>)}
          <form action={decideBout.bind(null, bid)} className="card space-y-2">
            <Back to={back} /><input type="hidden" name="mode" value="REFEREE" />
            <h3 className="font-semibold">Referee decision</h3>
            <select name="winner" className="input" required><option value="">— Winner —</option><option value={red.id}>{red.full_name}</option><option value={blue.id}>{blue.full_name}</option></select>
            <ConfirmButton className="btn" message="Declare the winner by the referee's decision?">Declare Winner</ConfirmButton>
          </form>
        </div>)}
      {!locked && !winner && (
        <form action={decideBout.bind(null, bid)} className="card mt-3 flex flex-wrap items-end gap-2">
          <Back to={back} /><input type="hidden" name="mode" value="DISQUALIFY" />
          <div className="flex-1"><h3 className="font-semibold">Disqualify</h3><p className="muted">The disqualified player loses this bout; the opponent goes through.</p></div>
          <select name="disqualified" className="input w-auto" required><option value="">— Player —</option><option value={red.id}>{red.full_name}</option><option value={blue.id}>{blue.full_name}</option></select>
          <ConfirmButton className="btn btn-danger" message="Disqualify this player? The opponent wins the bout.">Disqualify</ConfirmButton>
        </form>)}
      {later && <p className="muted mt-2">The next round has been drawn – this bout is final.</p>}
      <div className="mt-3 flex gap-2 text-xs text-slate-500"><Badge color="red">Red</Badge> {red.assignment_number} · <Badge color="blue">Blue</Badge> {blue.assignment_number}</div>
    </div>
  );
}
