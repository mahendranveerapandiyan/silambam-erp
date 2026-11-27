import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requirePriv, can } from '@/lib/auth';
import { sql } from '@/lib/db';
import { lk } from '@/lib/lookups';
import { templateSections, ratingChoices } from '@/lib/examSetup';
import { studentScopeSql } from '@/lib/scope';
import { categoryRules, studentFacts, ruleFails, flowKindLabel, hasIndividual, hasFight, proposeBye, STAGES, boutState, ruleDescriber, type FlowRules } from '@/lib/tournament';
import { fmtDate, todayISO } from '@/lib/util';
import { PageHeader, Flash, Back, Badge, Empty, Tabs, type SP, s as one, here } from '@/components/ui';
import { CheckAll, ConfirmButton } from '@/components/client';
import { registerEntries, withdrawEntry, saveSlots, saveIndividualScores, announceIndividual, generateRound, undoRound, reopenCompetition } from '../../../tournamentActions';

const PLACE = ['', '🥇 First', '🥈 Second', '🥉 Third', 'Fourth'];

/** One competition of a tournament: entries, slots, evaluation, fixtures and results. */
export default async function Competition({ params, searchParams }: { params: Promise<{ id: string; cid: string }>; searchParams: SP }) {
  const u = await requirePriv(['CD_EVENT_SETUP_PRV', 'CD_EVENT_PARTICIPANT_PRV', 'CD_TOURNAMENT_SCORING_PRV'], 'READ');
  const { id, cid } = await params;
  const sp = await searchParams;
  const [c] = await sql`select c.*, e.name event_name, e.status_code event_status, e.start_date, e.end_date, e.venue,
      f.flow_kind, f.name flow_name, f.regular_rounds, f.extra_rounds, f.allow_final_round, f.allow_toss, f.foul_points, f.round_minutes flow_minutes,
      g.name game_name, k.name category_name, (select name from evaluation_template t where t.id = c.evaluation_template_id) template_name
    from event_competition c join event e on e.id = c.event_id join game_flow f on f.id = c.game_flow_id join game_type g on g.id = f.game_type_id
    left join competition_category k on k.id = c.category_id
    where c.id = ${cid} and c.event_id = ${id} and e.enterprise_id = ${u.enterpriseId}`;
  if (!c) notFound();
  const L = await lk();
  const today = todayISO();
  const score = can(u, 'CD_TOURNAMENT_SCORING_PRV', 'WRITE');
  const setup = can(u, 'CD_EVENT_SETUP_PRV', 'WRITE');
  const register = can(u, 'CD_EVENT_PARTICIPANT_PRV', 'WRITE') || setup;
  const ind = hasIndividual(c.flow_kind), fight = hasFight(c.flow_kind);
  const entries = await sql`
    select e.*, a.assignment_number, trim(concat_ws(' ', pf.first_name, pf.last_name)) full_name,
      (select name from class_f cf where cf.id = af.class_id order by effective_start_date desc limit 1) class_name
    from event_entry e join assignment a on a.id = e.assignment_id
    left join assignment_f af on af.id = a.id and ${today}::date between af.effective_start_date and af.effective_end_date
    left join lateral (select * from person_f x where x.id = e.person_id order by effective_start_date desc limit 1) pf on true
    where e.competition_id = ${cid}
    order by e.slot_no nulls last, full_name`;
  // slot number first, so students with the same name are easy to tell apart
  const name = new Map(entries.map((e) => [String(e.id), `${e.slot_no ? `#${e.slot_no} ` : ''}${e.full_name}`]));
  const bouts = fight ? await sql`select * from event_bout where competition_id = ${cid} order by round_no, (stage_code = 'THIRD_PLACE'), bout_no` : [];
  const rules = await categoryRules(c.category_id);
  const { describe, nameOf } = await ruleDescriber(u.enterpriseId, c.start_date);
  const tabs: [string, string][] = [['entries', `Entries (${entries.length})`], ['slots', 'Slots'], ...(ind ? [['evaluate', c.flow_kind === 'INDIVIDUAL' ? 'Evaluation' : 'Individual Evaluation'] as [string, string]] : []),
    ...(fight ? [['fixtures', 'Fixtures'] as [string, string]] : []), ['results', 'Results']];
  const tab = one(sp.tab) ?? 'entries';
  const back = here(`/events/${id}/c/${cid}`, sp);
  const statusText: Record<string, string> = { REGISTRATION: 'Registration', SCORING: 'Evaluating', FIXTURES: 'Fights', COMPLETED: 'Completed' };

  return (
    <div className="max-w-7xl">
      <PageHeader title={c.name}
        subtitle={<>{c.event_name} · {fmtDate(c.start_date)} · {c.game_name} · {flowKindLabel(c.flow_kind)} · {c.category_name ?? 'Open to all'} · <Badge color={c.status_code === 'COMPLETED' ? 'green' : 'blue'}>{statusText[c.status_code]}</Badge></>}
        actions={<Link href={`/events/${id}`} className="btn">Back to tournament</Link>} />
      <Flash sp={sp} />
      {rules.length > 0 && <div className="mb-3 flex flex-wrap gap-2 text-xs">{rules.map((r, i) => <Badge key={i} color="gray">{describe(r)}</Badge>)}</div>}
      <Tabs tabs={tabs} active={tab} base={`/events/${id}/c/${cid}`} />
      {tab === 'entries' && <Entries />}
      {tab === 'slots' && <Slots />}
      {tab === 'evaluate' && ind && <Evaluate />}
      {tab === 'fixtures' && fight && <Fixtures />}
      {tab === 'results' && <Results />}
    </div>
  );

  async function Entries() {
    const open = c.event_status === 'OPEN' && c.status_code === 'REGISTRATION';
    // the user's students, checked against the category rules
    const mine = register && open ? await sql`select a.person_id from assignment a join assignment_f af on af.id = a.id and ${today}::date between af.effective_start_date and af.effective_end_date
        join assignment_status_f st on st.id = af.assignment_status_id and ${today}::date between st.effective_start_date and st.effective_end_date
        where a.enterprise_id = ${u.enterpriseId} and a.assignment_type = 'STUDENT' and st.system_status_code = 'ACTIVE' ${studentScopeSql(u, today)}
          and not exists (select 1 from event_entry x where x.competition_id = ${cid} and x.person_id = a.person_id)` : [];
    const facts = mine.length ? await studentFacts(u.enterpriseId, c.start_date, mine.map((m) => String(m.person_id))) : [];
    const cand = facts.map((s) => ({ ...s, why: rules.map((r) => ruleFails(r, s.facts, describe, nameOf)).filter(Boolean) })).sort((a, b) => a.why.length - b.why.length || String(a.row.full_name).localeCompare(b.row.full_name));
    const ok = cand.filter((x) => !x.why.length).length;
    return (
      <div className="grid gap-4 lg:grid-cols-[1fr_26rem]">
        <div className="card overflow-x-auto">
          <h2 className="h2">Registered ({entries.length})</h2>
          <table className="tbl"><thead><tr><th>Student</th><th>Class</th><th>Registered by</th><th></th></tr></thead>
            <tbody>{entries.map((e) => (
              <tr key={e.id}><td><Link className="link" href={`/students/${e.person_id}?tab=events`}>{e.full_name}</Link><div className="text-xs text-gray-500">{e.assignment_number}</div></td>
                <td>{e.class_name}</td><td className="text-xs">{e.registered_by}</td>
                <td>{register && c.status_code === 'REGISTRATION' && <form action={withdrawEntry.bind(null, cid, e.id)}><Back to={back} /><ConfirmButton className="btn btn-sm" message={`Withdraw ${e.full_name}?`}>Withdraw</ConfirmButton></form>}</td></tr>))}</tbody></table>
          {!entries.length && <Empty>No one registered yet.</Empty>}
        </div>
        <div className="card h-fit">
          <h2 className="h2">Register Students</h2>
          {!open ? <p className="muted">{c.event_status !== 'OPEN' ? 'Registration opens when the tournament is published.' : 'Registration is closed – the competition has started.'}</p>
            : !register ? <p className="muted">You cannot register students.</p> : (
            <form action={registerEntries.bind(null, cid)} className="space-y-2">
              <Back to={back} />
              <p className="muted">{ok} of your {cand.length} student(s) qualify{rules.length ? ' for this category' : ''}. Students who do not qualify are shown with the reason.</p>
              <div className="max-h-96 space-y-1 overflow-y-auto rounded border p-2">
                {ok > 0 && <label className="flex items-center gap-2 text-xs font-semibold"><CheckAll name="person" /> Select all who qualify</label>}
                {cand.map((s) => (
                  <label key={s.row.person_id} className={`flex items-start gap-2 text-sm ${s.why.length ? 'text-slate-400' : ''}`}>
                    <input type="checkbox" name="person" value={s.row.person_id} disabled={s.why.length > 0} className="mt-1" />
                    <span>{s.row.full_name} <span className="text-xs">{s.row.assignment_number}</span>{s.why.length > 0 && <span className="block text-xs text-red-700">{s.why.join('; ')}</span>}</span>
                  </label>))}
              </div>
              <button className="btn btn-primary w-full" disabled={!ok}>Register</button>
            </form>)}
        </div>
      </div>
    );
  }

  function Slots() {
    const locked = bouts.length > 0 || !score;
    return (
      <form action={saveSlots.bind(null, cid)} className="card overflow-x-auto">
        <Back to={back} />
        <p className="muted mb-2">Each participant gets a slot number from 1 to {entries.length} – entered once for the competition. Fixtures pair the slots in order (1 v 2, 3 v 4 …); with an odd number the bye goes to the last, then the first, then the middle participant.</p>
        <table className="tbl"><thead><tr><th>Slot</th><th>Participant</th><th>Class</th></tr></thead>
          <tbody>{entries.map((e) => (
            <tr key={e.id}><td><input name={`slot_${e.id}`} type="number" min="1" max={entries.length} defaultValue={e.slot_no ?? ''} disabled={locked} required className="input w-24" aria-label={`${e.full_name} slot`} /></td>
              <td>{e.full_name}<div className="text-xs text-gray-500">{e.assignment_number}</div></td><td>{e.class_name}</td></tr>))}</tbody></table>
        {!entries.length && <Empty />}
        {bouts.length > 0 && <p className="mt-2 text-sm text-amber-700">Fixtures have been made – slots are fixed.</p>}
        {!locked && entries.length > 0 && <div className="mt-3 flex gap-2"><button className="btn btn-primary">Save Slots</button><button name="auto" value="Y" className="btn" formNoValidate>Draw slots at random</button></div>}
      </form>
    );
  }

  async function Evaluate() {
    const secs = await templateSections(c.evaluation_template_id);
    const max = secs.reduce((t, s) => t + s.weight_pct, 0);
    const vals = entries.length ? await sql`select * from event_entry_score where entry_id in ${sql(entries.map((e) => e.id))}` : [];
    const V = new Map(vals.map((v) => [`${v.entry_id}_${v.section_id}`, v.value]));
    const locked = !score || c.status_code === 'COMPLETED' || bouts.length > 0;
    const groups = [...new Set(secs.map((s) => s.group_name ?? ''))];
    return (
      <div className="space-y-3">
        <form key={cid} action={saveIndividualScores.bind(null, cid)} className="card overflow-x-auto">
          <Back to={back} />
          <p className="muted mb-2">{c.template_name ?? 'No template'} · total {max}. {c.flow_kind === 'INDIVIDUAL_FIGHT' ? 'No winner is announced – these marks are carried into every fight as the Individual Mark.' : 'The highest mark wins.'}</p>
          <table className="tbl">
            <thead>
              {groups.some(Boolean) && <tr><th />{groups.map((g) => <th key={g} colSpan={secs.filter((s) => (s.group_name ?? '') === g).length} className="text-center">{g || '—'}</th>)}<th /></tr>}
              <tr><th>Participant</th>{secs.map((s) => <th key={s.id} className="font-normal normal-case">{s.name}<div className="text-[10px]">weight {s.weight_pct} · {s.input_type === 'LOV' ? 'list' : 'enter'} {s.min_rating}–{s.max_rating}</div></th>)}<th>Mark / {max}</th></tr>
            </thead>
            <tbody>{entries.map((e) => (
              <tr key={e.id}>
                <td><input type="hidden" name={`seen_${e.id}`} value="1" />{e.slot_no && <span className="mr-1 text-xs text-slate-500">#{e.slot_no}</span>}{e.full_name}</td>
                {secs.map((s) => {
                  const ch = ratingChoices(s); const v = V.get(`${e.id}_${s.id}`); const nm = `v_${e.id}_${s.id}`;
                  return <td key={s.id}>{ch
                    ? <select name={nm} defaultValue={v === null || v === undefined ? '' : String(Number(v))} disabled={locked} className="input min-w-28" aria-label={`${e.full_name} ${s.name}`}><option value="">–</option>{ch.map((x) => <option key={x.value} value={x.value}>{x.label}{x.label !== String(x.value) ? ` (${x.value})` : ''}</option>)}</select>
                    : <input name={nm} type="number" step="0.01" min={s.min_rating} max={s.max_rating} defaultValue={v ?? ''} placeholder="0" disabled={locked} className="input w-20" aria-label={`${e.full_name} ${s.name}`} />}</td>;
                })}
                <td className="font-semibold">{e.individual_score ?? '—'}</td>
              </tr>))}</tbody>
          </table>
          {!entries.length && <Empty />}
          {!locked && entries.length > 0 && <button className="btn btn-primary mt-3">Save Marks</button>}
        </form>
        {c.flow_kind === 'INDIVIDUAL' && score && c.status_code !== 'COMPLETED' && entries.length > 0 && (
          <form action={announceIndividual.bind(null, cid)} className="card flex items-center justify-between"><Back to={back} />
            <span>When every participant is marked, announce the results – the highest mark wins.</span>
            <ConfirmButton className="btn btn-primary" message="Announce the results? Places follow the marks.">Announce Results</ConfirmButton></form>)}
      </div>
    );
  }

  async function Fixtures() {
    const rounds = [...new Set(bouts.map((b) => Number(b.round_no)))];
    const last = rounds.length ? Math.max(...rounds) : 0;
    const lastDone = last ? bouts.filter((b) => Number(b.round_no) === last).every((b) => b.winner_entry_id) : true;
    const finalDone = bouts.some((b) => b.stage_code === 'FINAL' && b.winner_entry_id);
    let entrants: { id: string }[] = [];
    if (!last) entrants = entries.filter((e) => e.slot_no).sort((a, b) => a.slot_no - b.slot_no).map((e) => ({ id: String(e.id) }));
    else if (lastDone && !bouts.some((b) => b.stage_code === 'FINAL')) entrants = bouts.filter((b) => Number(b.round_no) === last && b.stage_code !== 'THIRD_PLACE').map((b) => ({ id: String(b.winner_entry_id) }));
    const hadBye = new Set(bouts.filter((b) => !b.blue_entry_id).map((b) => String(b.red_entry_id)));
    const proposed = entrants.length > 1 ? proposeBye(entrants, bouts.filter((b) => !b.blue_entry_id).length, hadBye) : null;
    const slotsReady = entries.length > 1 && entries.every((e) => e.slot_no);
    const indivReady = c.flow_kind !== 'INDIVIDUAL_FIGHT' || entries.every((e) => e.individual_score !== null);
    const canDraw = score && !finalDone && entrants.length > 1 && (last ? lastDone : slotsReady && indivReady);
    const nextLabel = entrants.length === 2 ? 'Final' : entrants.length === 4 ? 'Semi Finals' : `Round ${last + 1}`;
    const roundsMap = new Map<string, { red: number; blue: number }>();
    const allRounds = bouts.length ? await sql`select * from event_bout_round where bout_id in ${sql(bouts.map((b) => b.id))}` : [];
    const indiv = (eid: string | null) => (c.flow_kind === 'INDIVIDUAL_FIGHT' && eid ? Number(entries.find((e) => String(e.id) === String(eid))?.individual_score ?? 0) : 0);
    for (const b of bouts) if (b.blue_entry_id) roundsMap.set(String(b.id), boutState(allRounds.filter((r) => String(r.bout_id) === String(b.id)), c as unknown as FlowRules, indiv(b.red_entry_id), indiv(b.blue_entry_id)).totals);
    const title = (r: number) => { const st = bouts.find((b) => Number(b.round_no) === r && b.stage_code !== 'ROUND')?.stage_code; return st === 'FINAL' ? 'Final' : st === 'SEMI_FINAL' ? 'Semi Finals' : `Round ${r}`; };
    return (
      <div className="space-y-4">
        {!slotsReady && <div className="card border-amber-300 bg-amber-50 text-sm">Give every participant a slot number first (Slots tab).</div>}
        {!indivReady && <div className="card border-amber-300 bg-amber-50 text-sm">Finish the individual evaluation first – its marks are carried into the fights.</div>}
        {rounds.map((r) => (
          <div key={r} className="card overflow-x-auto">
            <h3 className="mb-2 font-semibold">{title(r)}</h3>
            <table className="tbl"><thead><tr><th>Bout</th><th className="text-red-700">Red</th><th /><th className="text-blue-700">Blue</th><th>Score</th><th>Winner</th><th /></tr></thead>
              <tbody>{bouts.filter((b) => Number(b.round_no) === r).map((b) => {
                const t = roundsMap.get(String(b.id));
                return (
                  <tr key={b.id}>
                    <td className="text-sm">{b.stage_code === 'THIRD_PLACE' ? 'Third place' : `${STAGES[b.stage_code] === 'Round' ? '' : STAGES[b.stage_code] + ' '}${b.bout_no}`}</td>
                    <td className={String(b.winner_entry_id) === String(b.red_entry_id) ? 'font-semibold' : ''}>{name.get(String(b.red_entry_id))}</td>
                    <td className="text-xs text-slate-400">{b.blue_entry_id ? 'vs' : ''}</td>
                    <td className={String(b.winner_entry_id) === String(b.blue_entry_id) ? 'font-semibold' : ''}>{b.blue_entry_id ? name.get(String(b.blue_entry_id)) : <Badge color="gray">Bye – goes through</Badge>}</td>
                    <td className="text-sm">{t ? `${t.red} – ${t.blue}` : ''}</td>
                    <td>{b.winner_entry_id ? <><Badge color="green">{name.get(String(b.winner_entry_id))}</Badge>{b.decided_by && b.decided_by !== 'SCORE' && <span className="ml-1 text-xs text-slate-500">{b.decided_by === 'BYE' ? 'bye' : b.decided_by === 'TOSS' ? 'by toss' : 'referee'}</span>}</> : <span className="text-xs text-slate-500">to play</span>}</td>
                    <td>{b.blue_entry_id && <Link className="btn btn-sm" href={`/events/${id}/c/${cid}/b/${b.id}`}>{score && !b.winner_entry_id ? 'Score' : 'Open'}</Link>}</td>
                  </tr>);
              })}</tbody></table>
          </div>))}
        {!rounds.length && <div className="card muted">No fixtures yet.</div>}
        {canDraw && (
          <form action={generateRound.bind(null, cid)} className="card flex flex-wrap items-end gap-3">
            <Back to={here(`/events/${id}/c/${cid}`, { tab: 'fixtures' })} />
            <div className="flex-1"><h3 className="font-semibold">Draw the {nextLabel}</h3>
              <p className="muted">{entrants.length} participant(s): {entrants.map((e) => name.get(e.id)).join(', ')}.{entrants.length === 2 && bouts.some((b) => b.stage_code === 'SEMI_FINAL') && ' The semi-final losers meet in the third-place bout.'}</p></div>
            {proposed && <label className="text-sm">Bye (odd number) <select name="bye_entry_id" defaultValue={proposed} className="input">{entrants.map((e) => <option key={e.id} value={e.id}>{name.get(e.id)}{e.id === proposed ? ' (suggested)' : ''}{hadBye.has(e.id) ? ' – had a bye' : ''}</option>)}</select></label>}
            <button className="btn btn-primary">Draw {nextLabel}</button>
          </form>)}
        {score && last > 0 && !finalDone && (
          <form action={undoRound.bind(null, cid)}><Back to={here(`/events/${id}/c/${cid}`, { tab: 'fixtures' })} /><ConfirmButton className="btn btn-sm" message={`Undo ${title(last)}? Possible only while none of its bouts is scored.`}>Undo {title(last)}</ConfirmButton></form>)}
      </div>
    );
  }

  function Results() {
    const placed = entries.filter((e) => e.place).sort((a, b) => a.place - b.place);
    return (
      <div className="card overflow-x-auto">
        <h2 className="h2">{c.status_code === 'COMPLETED' ? 'Final Results' : 'Results'}</h2>
        {placed.length ? (
          <table className="tbl"><thead><tr><th>Place</th><th>Participant</th><th>Class</th>{ind && <th>Individual Mark</th>}</tr></thead>
            <tbody>{placed.map((e) => <tr key={e.id}><td className="font-semibold">{PLACE[e.place] ?? `${e.place}th`}</td><td>{e.full_name}<div className="text-xs text-gray-500">{e.assignment_number}</div></td><td>{e.class_name}</td>{ind && <td>{e.individual_score}</td>}</tr>)}</tbody></table>
        ) : <Empty>Results appear when the {fight ? 'final is decided' : 'results are announced'}.</Empty>}
        {c.status_code === 'COMPLETED' && <p className="muted mt-2">The top three places are written to the students&apos; profiles (Events).</p>}
        {setup && c.status_code === 'COMPLETED' && <form action={reopenCompetition.bind(null, cid)} className="mt-2"><Back to={back} /><ConfirmButton className="btn btn-sm" message="Reopen the results to correct scores?">Reopen results</ConfirmButton></form>}
      </div>
    );
  }
}
