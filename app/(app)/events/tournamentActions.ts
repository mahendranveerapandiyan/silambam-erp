'use server';
import { sql, type Row, type Tx } from '@/lib/db';
import { requirePriv, can, type SessionUser } from '@/lib/auth';
import { act, backOf, formObj, todayISO } from '@/lib/util';
import { addDemand } from '@/lib/fees';
import { assertStudentAccess } from '@/lib/scope';
import { academicYearOn } from '@/lib/people';
import { templateSections, partMark } from '@/lib/examSetup';
import { categoryRules, studentFacts, ruleFails, hasIndividual, hasFight, proposeBye, pairRound, boutState, type FlowRules, ruleDescriber } from '@/lib/tournament';

const SETUP = 'CD_EVENT_SETUP_PRV';
const SCORE = 'CD_TOURNAMENT_SCORING_PRV';

async function loadComp(u: SessionUser, compId: string) {
  const [c] = await sql`select c.*, e.name event_name, e.status_code event_status, e.start_date, e.fee_amount, e.enterprise_id, e.id event_id,
      f.flow_kind, f.regular_rounds, f.extra_rounds, f.allow_final_round, f.allow_toss, f.foul_points, f.round_minutes flow_minutes, f.name flow_name,
      (select name from game_type g where g.id = f.game_type_id) game_name
    from event_competition c join event e on e.id = c.event_id join game_flow f on f.id = c.game_flow_id
    where c.id = ${compId} and e.enterprise_id = ${u.enterpriseId}`;
  if (!c) throw new Error('Competition not found');
  return c;
}

/* ---------- competitions (organisers) ---------- */

export async function saveCompetition(eventId: string, compId: string | null, fd: FormData) {
  const u = await requirePriv(SETUP, 'WRITE');
  await act(backOf(fd), async () => {
    const [ev] = await sql`select * from event where id = ${eventId} and enterprise_id = ${u.enterpriseId}`;
    if (!ev) throw new Error('Event not found');
    const o = formObj(fd);
    if (!o.game_flow_id) throw new Error('Choose the game and flow');
    const [f] = await sql`select f.*, g.name game_name from game_flow f join game_type g on g.id = f.game_type_id where f.id = ${o.game_flow_id} and g.enterprise_id = ${u.enterpriseId}`;
    if (!f) throw new Error('Game flow not found');
    const [cat] = o.category_id ? await sql`select * from competition_category where id = ${o.category_id} and enterprise_id = ${u.enterpriseId}` : [];
    const template = hasIndividual(f.flow_kind) ? (o.evaluation_template_id ?? f.evaluation_template_id) : null;
    if (hasIndividual(f.flow_kind) && !template) throw new Error(`${f.name} needs an evaluation template – choose one`);
    const v = {
      game_flow_id: f.id, category_id: o.category_id, evaluation_template_id: template,
      name: o.name ?? `${f.game_name} – ${f.name}${cat ? ` – ${cat.name}` : ''}`,
      round_minutes: o.round_minutes ? Number(o.round_minutes) : null,
    };
    if (compId) {
      const [b] = await sql`select count(*)::int n from event_bout where competition_id = ${compId}`;
      if (b.n) throw new Error('Fixtures have started – the competition can no longer be changed.');
      await sql`update event_competition set ${sql(v)} where id = ${compId} and event_id = ${eventId}`;
    } else await sql`insert into event_competition ${sql({ ...v, event_id: eventId, created_by: u.username })}`;
    return { msg: `${v.name} competition has been ${compId ? 'updated' : 'added'}.` };
  });
}

export async function deleteCompetition(eventId: string, compId: string, fd: FormData) {
  const u = await requirePriv(SETUP, 'WRITE');
  await act(backOf(fd), async () => {
    const c = await loadComp(u, compId);
    const [n] = await sql`select count(*)::int n from event_entry where competition_id = ${compId}`;
    if (n.n) throw new Error(`${n.n} student(s) are registered for ${c.name} – withdraw them first.`);
    await sql`delete from event_competition where id = ${compId}`;
    return { to: `/events/${eventId}`, msg: `${c.name} competition has been removed.` };
  });
}

/** Publish the tournament: staff can then register their students. */
export async function publishTournament(eventId: string, fd: FormData) {
  const u = await requirePriv(SETUP, 'WRITE');
  await act(backOf(fd), async () => {
    const [ev] = await sql`select * from event where id = ${eventId} and enterprise_id = ${u.enterpriseId}`;
    if (!ev) throw new Error('Event not found');
    const [n] = await sql`select count(*)::int n from event_competition where event_id = ${eventId}`;
    if (!n.n) throw new Error('Add at least one competition (game, flow and category) first.');
    const open = formObj(fd).open !== 'N';
    await sql`update event set status_code = ${open ? 'OPEN' : 'PLANNED'}, last_updated_by = ${u.username}, last_update_date = now() where id = ${eventId}`;
    return { msg: open ? `${ev.name} has been published – staff can now register their students.` : `Registration for ${ev.name} has been closed.` };
  });
}

/* ---------- registration (staff, own students) ---------- */

async function ensureParticipant(tx: Tx, u: SessionUser, ev: Row, personId: string, assignmentId: string) {
  const [ex] = await tx`select 1 from event_participant where event_id = ${ev.id} and person_id = ${personId}`;
  if (ex) return;
  let did: string | null = null;
  if (Number(ev.fee_amount) > 0) {
    const date = todayISO();
    const ay = await academicYearOn(u.enterpriseId, ev.start_date);
    const [a] = await tx`select af.business_unit_id from assignment_f af where af.id = ${assignmentId} and ${date}::date between af.effective_start_date and af.effective_end_date`;
    did = await addDemand(tx, { enterpriseId: u.enterpriseId, personId, feeType: 'EVENT', description: `${ev.name} – event fee`, amount: Number(ev.fee_amount),
      dueDate: ev.start_date < date ? date : ev.start_date, by: u.username, sourceType: 'EVENT', sourceId: ev.id, ayId: ay?.id, buId: a?.business_unit_id, assignmentId });
  }
  await tx`insert into event_participant (event_id, person_id, participation_code, fee_demand_id, assigned_by) values (${ev.id}, ${personId}, 'PARTICIPANT', ${did}, ${u.username})`;
}

export async function registerEntries(compId: string, fd: FormData) {
  const u = await requirePriv(['CD_EVENT_PARTICIPANT_PRV', SETUP], 'WRITE');
  await act(backOf(fd), async () => {
    const c = await loadComp(u, compId);
    if (c.event_status !== 'OPEN') throw new Error(`Registration for ${c.event_name} is not open.`);
    if (c.status_code !== 'REGISTRATION') throw new Error(`${c.name} has started – registration is closed.`);
    const ids = [...new Set(fd.getAll('person').map(String))];
    if (!ids.length) throw new Error('Tick the students to register');
    const rules = await categoryRules(c.category_id);
    const { describe, nameOf } = await ruleDescriber(u.enterpriseId, c.start_date);
    const facts = await studentFacts(u.enterpriseId, c.start_date, ids);
    const [ev] = await sql`select * from event where id = ${c.event_id}`;
    let n = 0;
    await sql.begin(async (tx) => {
      for (const pid of ids) {
        await assertStudentAccess(u, pid, todayISO());
        const s = facts.find((x) => String(x.row.person_id) === pid);
        if (!s) throw new Error('Only active students can be registered');
        const why = rules.map((r) => ruleFails(r, s.facts, describe, nameOf)).filter(Boolean);
        if (why.length) throw new Error(`${s.row.full_name} does not qualify for ${c.name}: ${why.join('; ')}`);
        const [ex] = await tx`select 1 from event_entry where competition_id = ${compId} and person_id = ${pid}`;
        if (ex) continue;
        await tx`insert into event_entry (competition_id, person_id, assignment_id, registered_by) values (${compId}, ${pid}, ${s.row.assignment_id}, ${u.username})`;
        await ensureParticipant(tx as unknown as Tx, u, ev, pid, s.row.assignment_id);
        n++;
      }
    });
    return { msg: `${n} student(s) have been registered for ${c.name}.${Number(ev.fee_amount) > 0 ? ' The event fee has been added to their fee pages.' : ''}` };
  });
}

export async function withdrawEntry(compId: string, entryId: string, fd: FormData) {
  const u = await requirePriv(['CD_EVENT_PARTICIPANT_PRV', SETUP], 'WRITE');
  await act(backOf(fd), async () => {
    const c = await loadComp(u, compId);
    const [e] = await sql`select e.*, (select trim(concat_ws(' ', first_name, last_name)) from person_f x where x.id = e.person_id order by effective_start_date desc limit 1) full_name
      from event_entry e where e.id = ${entryId} and e.competition_id = ${compId}`;
    if (!e) throw new Error('Entry not found');
    await assertStudentAccess(u, e.person_id, todayISO());
    if (c.status_code !== 'REGISTRATION') throw new Error(`${c.name} has started – entries can no longer be withdrawn.`);
    await sql`delete from event_entry where id = ${entryId}`;
    return { msg: `${e.full_name} has been withdrawn from ${c.name}.` };
  });
}

/* ---------- slots (once per competition) ---------- */

export async function saveSlots(compId: string, fd: FormData) {
  const u = await requirePriv(SCORE, 'WRITE');
  await act(backOf(fd), async () => {
    const c = await loadComp(u, compId);
    const [b] = await sql`select count(*)::int n from event_bout where competition_id = ${compId}`;
    if (b.n) throw new Error('Fixtures have been made – slot numbers can no longer be changed.');
    const entries = await sql`select id from event_entry where competition_id = ${compId}`;
    const o = formObj(fd);
    let slots: Map<string, number>;
    if (o.auto === 'Y') {
      const shuffled = entries.map((e) => String(e.id)).sort(() => Math.random() - 0.5);
      slots = new Map(shuffled.map((id, i) => [id, i + 1]));
    } else {
      slots = new Map(entries.map((e) => [String(e.id), Number(o[`slot_${e.id}`])]));
      const vals = [...slots.values()];
      if (vals.some((v) => !Number.isInteger(v) || v < 1 || v > entries.length)) throw new Error(`Give every participant a slot number from 1 to ${entries.length}`);
      if (new Set(vals).size !== vals.length) throw new Error('Each slot number can be used only once');
    }
    await sql.begin(async (tx) => {
      await tx`update event_entry set slot_no = null where competition_id = ${compId}`;
      for (const [id, s] of slots) await tx`update event_entry set slot_no = ${s} where id = ${id}`;
    });
    return { msg: `Slot numbers have been ${o.auto === 'Y' ? 'drawn' : 'saved'} for ${entries.length} participant(s) of ${c.name}.` };
  });
}

/* ---------- individual evaluation ---------- */

export async function saveIndividualScores(compId: string, fd: FormData) {
  const u = await requirePriv(SCORE, 'WRITE');
  await act(backOf(fd), async () => {
    const c = await loadComp(u, compId);
    if (!hasIndividual(c.flow_kind)) throw new Error('This competition has no individual evaluation');
    if (c.status_code === 'COMPLETED') throw new Error('Results are final');
    const [b] = await sql`select count(*)::int n from event_bout where competition_id = ${compId}`;
    if (b.n) throw new Error('Fights have started – individual marks can no longer be changed.');
    const secs = await templateSections(c.evaluation_template_id);
    if (!secs.length) throw new Error('The evaluation template has no sections');
    const max = secs.reduce((t, s) => t + s.weight_pct, 0);
    const o = formObj(fd);
    const entries = await sql`select * from event_entry where competition_id = ${compId}`;
    let n = 0;
    await sql.begin(async (tx) => {
      for (const e of entries) {
        if (!(`seen_${e.id}` in o)) continue;
        const vals = new Map<string, number | null>();
        for (const s of secs) {
          const raw = o[`v_${e.id}_${s.id}`];
          const v = raw === null || raw === undefined ? null : Number(raw);
          if (v !== null && (Number.isNaN(v) || v < s.min_rating || v > s.max_rating)) throw new Error(`${s.name} must be between ${s.min_rating} and ${s.max_rating}`);
          if (v !== null && s.input_type === 'LOV' && s.values.length && !s.values.some((x) => Math.abs(x.value - v) < 0.001)) throw new Error(`${s.name}: choose one of the listed values`);
          vals.set(s.id, v);
          await tx`insert into event_entry_score (entry_id, section_id, value, entered_by) values (${e.id}, ${s.id}, ${v}, ${u.username})
            on conflict (entry_id, section_id) do update set value = excluded.value, entered_by = excluded.entered_by, entered_at = now()`;
        }
        const score = partMark({ id: '0', subjectId: '0', name: '', weight: 100, max, pass: 0, templateId: null }, secs, vals, null);
        await tx`update event_entry set individual_score = ${score} where id = ${e.id}`;
        n++;
      }
      if (c.status_code === 'REGISTRATION') await tx`update event_competition set status_code = 'SCORING' where id = ${compId}`;
    });
    return { msg: `Marks have been saved for ${n} participant(s).` };
  });
}

/** Individual competitions: the highest mark wins (equal marks share a place). */
export async function announceIndividual(compId: string, fd: FormData) {
  const u = await requirePriv(SCORE, 'WRITE');
  await act(backOf(fd), async () => {
    const c = await loadComp(u, compId);
    if (c.flow_kind !== 'INDIVIDUAL') throw new Error('Winners of this competition are decided by the fights');
    const entries = await sql`select * from event_entry where competition_id = ${compId} order by individual_score desc nulls last`;
    const missing = entries.filter((e) => e.individual_score === null).length;
    if (missing) throw new Error(`${missing} participant(s) have no marks yet`);
    await sql.begin(async (tx) => {
      let place = 0, prev: number | null = null;
      for (const [i, e] of entries.entries()) {
        if (prev === null || Number(e.individual_score) !== prev) place = i + 1;
        prev = Number(e.individual_score);
        await tx`update event_entry set place = ${place} where id = ${e.id}`;
      }
      await tx`update event_competition set status_code = 'COMPLETED' where id = ${compId}`;
      await writeAchievements(tx as unknown as Tx, c);
    });
    return { msg: `${c.name} results have been announced.` };
  });
}

/* ---------- knockout fixtures ---------- */

export async function generateRound(compId: string, fd: FormData) {
  const u = await requirePriv(SCORE, 'WRITE');
  await act(backOf(fd), async () => {
    const c = await loadComp(u, compId);
    if (!hasFight(c.flow_kind)) throw new Error('This competition has no fights');
    const entries = await sql`select * from event_entry where competition_id = ${compId} order by slot_no`;
    if (entries.length < 2) throw new Error('At least two participants are needed');
    if (entries.some((e) => e.slot_no === null)) throw new Error('Give every participant a slot number first');
    if (c.flow_kind === 'INDIVIDUAL_FIGHT' && entries.some((e) => e.individual_score === null)) throw new Error('Finish the individual evaluation first – its marks are carried into the fights');
    const bouts = await sql`select * from event_bout where competition_id = ${compId} order by round_no, bout_no`;
    const last = bouts.length ? Math.max(...bouts.map((b) => Number(b.round_no))) : 0;
    let entrants: { id: string }[];
    if (!last) entrants = entries.map((e) => ({ id: String(e.id) }));
    else {
      const prev = bouts.filter((b) => Number(b.round_no) === last && b.stage_code !== 'THIRD_PLACE');
      if (bouts.some((b) => Number(b.round_no) === last && !b.winner_entry_id)) throw new Error(`Finish every bout of round ${last} first`);
      if (prev.some((b) => b.stage_code === 'FINAL')) throw new Error('The final has been played');
      entrants = prev.map((b) => ({ id: String(b.winner_entry_id) }));
    }
    const round = last + 1;
    const hadBye = new Set(bouts.filter((b) => !b.blue_entry_id).map((b) => String(b.red_entry_id)));
    const byesSoFar = bouts.filter((b) => !b.blue_entry_id).length;
    let bye = proposeBye(entrants, byesSoFar, hadBye);
    const chosen = formObj(fd).bye_entry_id;
    if (bye && chosen) {
      if (!entrants.some((e) => e.id === chosen)) throw new Error('The bye must go to someone in this round');
      bye = chosen;
    }
    const pairs = pairRound(entrants, bye);
    const real = pairs.filter((p) => p.blue).length;
    const stage = entrants.length === 2 ? 'FINAL' : entrants.length === 4 ? 'SEMI_FINAL' : 'ROUND';
    await sql.begin(async (tx) => {
      let no = 0;
      for (const p of pairs) {
        no++;
        await tx`insert into event_bout (competition_id, round_no, bout_no, stage_code, red_entry_id, blue_entry_id, winner_entry_id, decided_by, seq)
          values (${compId}, ${round}, ${no}, ${p.blue ? stage : 'ROUND'}, ${p.red.id}, ${p.blue?.id ?? null}, ${p.blue ? null : p.red.id}, ${p.blue ? null : 'BYE'}, ${no})`;
      }
      // the final comes with the third-place bout between the semi-final losers
      if (stage === 'FINAL' && last) {
        const semis = bouts.filter((b) => Number(b.round_no) === last && b.stage_code === 'SEMI_FINAL' && b.blue_entry_id);
        if (semis.length === 2) {
          const losers = semis.map((b) => String(b.winner_entry_id) === String(b.red_entry_id) ? b.blue_entry_id : b.red_entry_id);
          await tx`insert into event_bout (competition_id, round_no, bout_no, stage_code, red_entry_id, blue_entry_id, seq)
            values (${compId}, ${round}, ${no + 1}, 'THIRD_PLACE', ${losers[0]}, ${losers[1]}, 0)`;
        }
      }
      await tx`update event_competition set status_code = 'FIXTURES' where id = ${compId}`;
    });
    const label = stage === 'FINAL' ? 'The final has' : stage === 'SEMI_FINAL' ? 'The semi finals have' : `Round ${round} has`;
    return { msg: `${label} been drawn for ${c.name}: ${real} bout(s)${bye ? ' and one bye' : ''}.` };
  });
}

/** Undo the last drawn round while none of its bouts has been scored. */
export async function undoRound(compId: string, fd: FormData) {
  const u = await requirePriv(SCORE, 'WRITE');
  await act(backOf(fd), async () => {
    const c = await loadComp(u, compId);
    const [m] = await sql`select max(round_no) r from event_bout where competition_id = ${compId}`;
    if (!m.r) throw new Error('No round has been drawn');
    const [s] = await sql`select count(*)::int n from event_bout_round r join event_bout b on b.id = r.bout_id where b.competition_id = ${compId} and b.round_no = ${m.r}`;
    if (s.n) throw new Error(`Bouts of round ${m.r} have scores – it cannot be undone.`);
    await sql`delete from event_bout where competition_id = ${compId} and round_no = ${m.r}`;
    if (Number(m.r) === 1) await sql`update event_competition set status_code = ${hasIndividual(c.flow_kind) ? 'SCORING' : 'REGISTRATION'} where id = ${compId}`;
    return { msg: `Round ${m.r} has been undone – it can be drawn again (e.g. with another bye).` };
  });
}

async function boutContext(u: SessionUser, boutId: string) {
  const [b] = await sql`select * from event_bout where id = ${boutId}`;
  if (!b) throw new Error('Bout not found');
  const c = await loadComp(u, String(b.competition_id));
  return { b, c };
}

/** Scores of a bout: points and fouls per round; the winner follows from the totals. */
export async function saveBoutScores(boutId: string, fd: FormData) {
  const u = await requirePriv(SCORE, 'WRITE');
  await act(backOf(fd), async () => {
    const { b, c } = await boutContext(u, boutId);
    if (!b.blue_entry_id) throw new Error('This is a bye');
    if (c.status_code === 'COMPLETED') throw new Error('Results are final');
    const [later] = await sql`select 1 from event_bout where competition_id = ${b.competition_id} and round_no > ${b.round_no} limit 1`;
    if (later) throw new Error('The next round has been drawn – this bout can no longer be changed.');
    const o = formObj(fd);
    const num = (k: string) => (o[k] === null || o[k] === undefined ? null : Number(o[k]));
    await sql.begin(async (tx) => {
      for (let r = 1; r <= 9; r++) {
        if (!(`seen_${r}` in o)) continue;
        const rp = num(`red_${r}`), bp = num(`blue_${r}`), rf = num(`redf_${r}`) ?? 0, bf = num(`bluef_${r}`) ?? 0, mins = num(`min_${r}`);
        for (const v of [rp, bp, rf, bf]) if (v !== null && (Number.isNaN(v) || v < 0)) throw new Error('Points and fouls cannot be negative – fouls are deducted automatically');
        if (rp === null && bp === null && !rf && !bf) { await tx`delete from event_bout_round where bout_id = ${boutId} and round_no = ${r}`; continue; }
        await tx`insert into event_bout_round (bout_id, round_no, minutes, red_points, blue_points, red_fouls, blue_fouls, entered_by)
          values (${boutId}, ${r}, ${mins}, ${rp}, ${bp}, ${rf}, ${bf}, ${u.username})
          on conflict (bout_id, round_no) do update set minutes = excluded.minutes, red_points = excluded.red_points, blue_points = excluded.blue_points,
            red_fouls = excluded.red_fouls, blue_fouls = excluded.blue_fouls, entered_by = excluded.entered_by, entered_at = now()`;
      }
      const rounds = await tx`select * from event_bout_round where bout_id = ${boutId} order by round_no`;
      const [ents] = await tx`select (select individual_score from event_entry where id = ${b.red_entry_id}) red, (select individual_score from event_entry where id = ${b.blue_entry_id}) blue`;
      const indiv = c.flow_kind === 'INDIVIDUAL_FIGHT';
      const st = boutState(rounds, c as unknown as FlowRules, indiv ? Number(ents.red ?? 0) : 0, indiv ? Number(ents.blue ?? 0) : 0);
      const w = st.winner ? (st.winner === 'RED' ? b.red_entry_id : b.blue_entry_id) : null;
      await tx`update event_bout set winner_entry_id = ${w}, decided_by = ${w ? 'SCORE' : null}, toss_call = null where id = ${boutId}`;
      if (b.stage_code === 'FINAL' || b.stage_code === 'THIRD_PLACE') await settlePlaces(tx as unknown as Tx, c);
    });
    const [nb] = await sql`select winner_entry_id from event_bout where id = ${boutId}`;
    return { msg: nb.winner_entry_id ? 'Scores saved – the winner is decided.' : 'Scores saved.' };
  });
}

/** Still tied: a toss (the red corner calls head or tail) or the referee's decision. */
export async function decideBout(boutId: string, fd: FormData) {
  const u = await requirePriv(SCORE, 'WRITE');
  await act(backOf(fd), async () => {
    const { b, c } = await boutContext(u, boutId);
    const o = formObj(fd);
    const rounds = await sql`select * from event_bout_round where bout_id = ${boutId} order by round_no`;
    const [ents] = await sql`select (select individual_score from event_entry where id = ${b.red_entry_id}) red, (select individual_score from event_entry where id = ${b.blue_entry_id}) blue`;
    const indiv = c.flow_kind === 'INDIVIDUAL_FIGHT';
    const st = boutState(rounds, c as unknown as FlowRules, indiv ? Number(ents.red ?? 0) : 0, indiv ? Number(ents.blue ?? 0) : 0);
    if (!st.tossOpen && !st.refereeOpen) throw new Error('The bout is not tied after the required rounds');
    let winner: string;
    let by: string;
    if (o.mode === 'TOSS') {
      if (!st.tossOpen) throw new Error('A toss is not allowed for this flow');
      if (!o.call || !o.result) throw new Error('Record the call and the toss result');
      winner = o.call === o.result ? b.red_entry_id : b.blue_entry_id; by = 'TOSS';
    } else {
      if (!o.winner || ![String(b.red_entry_id), String(b.blue_entry_id)].includes(o.winner)) throw new Error('Choose the winner');
      winner = o.winner; by = 'REFEREE';
    }
    await sql.begin(async (tx) => {
      await tx`update event_bout set winner_entry_id = ${winner}, decided_by = ${by}, toss_call = ${o.mode === 'TOSS' ? `${o.call}/${o.result}` : null} where id = ${boutId}`;
      if (b.stage_code === 'FINAL' || b.stage_code === 'THIRD_PLACE') await settlePlaces(tx as unknown as Tx, c);
    });
    return { msg: by === 'TOSS' ? `Toss: ${o.call} called, ${o.result} came – the winner is decided.` : 'The referee has decided the winner.' };
  });
}

/** Final and third-place bouts decided → 1st, 2nd and 3rd places; the competition is complete. */
async function settlePlaces(tx: Tx, c: Row) {
  const bouts = await tx`select * from event_bout where competition_id = ${c.id} order by round_no, bout_no`;
  const final = bouts.find((b) => b.stage_code === 'FINAL' && b.blue_entry_id);
  const third = bouts.find((b) => b.stage_code === 'THIRD_PLACE');
  await tx`update event_entry set place = null where competition_id = ${c.id}`;
  if (!final?.winner_entry_id) { await tx`update event_competition set status_code = 'FIXTURES' where id = ${c.id}`; return; }
  const loser = (b: Row) => (String(b.winner_entry_id) === String(b.red_entry_id) ? b.blue_entry_id : b.red_entry_id);
  await tx`update event_entry set place = 1 where id = ${final.winner_entry_id}`;
  await tx`update event_entry set place = 2 where id = ${loser(final)}`;
  if (third?.winner_entry_id) {
    await tx`update event_entry set place = 3 where id = ${third.winner_entry_id}`;
    await tx`update event_entry set place = 4 where id = ${loser(third)}`;
  } else if (!third) {
    // three entrants: the loser of the bout before the final is third
    const before = bouts.filter((b) => Number(b.round_no) === Number(final.round_no) - 1 && b.blue_entry_id && b.winner_entry_id);
    if (before.length === 1) await tx`update event_entry set place = 3 where id = ${loser(before[0])}`;
  }
  const done = !third || !!third.winner_entry_id;
  await tx`update event_competition set status_code = ${done ? 'COMPLETED' : 'FIXTURES'} where id = ${c.id}`;
  if (done) await writeAchievements(tx, c);
}

/** Places go to the event participants' achievement (student profile › Events). */
async function writeAchievements(tx: Tx, c: Row) {
  const label = ['', 'First Place', 'Second Place', 'Third Place'];
  for (const e of await tx`select * from event_entry where competition_id = ${c.id} and place between 1 and 3`)
    await tx`update event_participant set achievement = ${`${label[e.place]} – ${c.name}`} where event_id = ${c.event_id} and person_id = ${e.person_id}`;
}

export async function reopenCompetition(compId: string, fd: FormData) {
  const u = await requirePriv(SCORE, 'WRITE');
  await act(backOf(fd), async () => {
    const c = await loadComp(u, compId);
    if (!can(u, SETUP, 'WRITE')) throw new Error('Only organisers can reopen results');
    await sql`update event_competition set status_code = ${c.flow_kind === 'INDIVIDUAL' ? 'SCORING' : 'FIXTURES'} where id = ${compId}`;
    await sql`update event_entry set place = null where competition_id = ${compId}`;
    return { msg: `${c.name} results have been reopened.` };
  });
}
