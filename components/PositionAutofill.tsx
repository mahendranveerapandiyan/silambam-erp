'use client';
import { useEffect } from 'react';

export type PositionVersion = { id: string; start: string; end: string; business_unit_id: string | null; department_id: string | null; job_id: string | null; staff_grade_id: string | null; full_time_flag: string | null };

/** When a position is chosen, copies its branch, department, job, grade and employment type into the form. */
export function PositionAutofill({ positions, dateField }: { positions: PositionVersion[]; dateField: string }) {
  useEffect(() => {
    const pos = document.querySelector<HTMLSelectElement>('select[name="position_id"]');
    if (!pos) return;
    const set = (name: string, v: string | null) => {
      const el = document.querySelector<HTMLSelectElement>(`select[name="${name}"]`);
      if (el && v) el.dispatchEvent(new CustomEvent('cd:set', { detail: v }));
    };
    const apply = () => {
      const date = document.querySelector<HTMLInputElement>(`[name="${dateField}"]`)?.value ?? '';
      const p = positions.find((x) => x.id === pos.value && (!date || (date >= x.start && date <= x.end)));
      if (!p) return;
      set('business_unit_id', p.business_unit_id);
      set('department_id', p.department_id);
      set('job_id', p.job_id);
      set('staff_grade_id', p.staff_grade_id);
      set('employment_type_code', p.full_time_flag === 'N' ? 'PART_TIME' : 'FULL_TIME');
    };
    pos.addEventListener('change', apply);
    return () => pos.removeEventListener('change', apply);
  }, [positions, dateField]);
  return null;
}
