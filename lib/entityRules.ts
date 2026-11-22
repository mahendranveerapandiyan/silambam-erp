import 'server-only';
import type { Tx } from './db';

type Ctx = { id: string | null; date: string };

/** Extra business rules per setup object (beyond required fields and date checks). */
export async function validateEntity(tx: Tx, key: string, v: Record<string, any>, ctx: Ctx) {
  if (key === 'classes') {
    // the class belongs to a branch; its business unit is the branch's
    if (v.branch_id) {
      const [b]: any[] = await tx`select business_unit_id from branch_f where id = ${v.branch_id} and ${ctx.date}::date between effective_start_date and effective_end_date`;
      if (!b) throw new Error(`The branch is not effective on ${ctx.date}.`);
      v.business_unit_id = b.business_unit_id;
    }
    if (v.duration_type_code === 'FIXED' && v.start_time && v.end_time && v.end_time <= v.start_time)
      throw new Error('Out time must be after the in time.');
    if (v.duration_type_code === 'FLEXIBLE') {
      if (!(v.min_duration_mins > 0)) throw new Error('Minimum duration must be more than 0 minutes.');
      if (v.max_duration_mins < v.min_duration_mins) throw new Error('Maximum duration cannot be less than the minimum duration.');
    }
  }
  if (key === 'positions' && v.parent_position_id) {
    if (ctx.id && String(v.parent_position_id) === String(ctx.id)) throw new Error('A position cannot report to itself.');
    // walk up the hierarchy on the date: the new parent must not be below this position
    let cur: string | null = String(v.parent_position_id);
    const seen = new Set<string>();
    while (cur) {
      if (ctx.id && cur === String(ctx.id)) throw new Error('That parent position reports (directly or indirectly) to this position – it would create a loop.');
      if (seen.has(cur)) break;
      seen.add(cur);
      const [p]: any[] = await tx`select parent_position_id from position_f where id = ${cur} and ${ctx.date}::date between effective_start_date and effective_end_date`;
      cur = p?.parent_position_id ? String(p.parent_position_id) : null;
    }
  }
}
