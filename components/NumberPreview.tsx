'use client';
import { useEffect, useState } from 'react';

type Previews = { single: string | null; byScope: Record<string, string>; classToScope: Record<string, string>; buToScope: Record<string, string> } | null;

/** Shows the auto-generated number the new student / staff member will get. */
export function NumberPreview({ previews, watch }: { previews: Previews; watch: string }) {
  const [v, setV] = useState('');
  useEffect(() => {
    const el = document.querySelector<HTMLSelectElement>(`select[name="${watch}"]`);
    if (!el) return;
    const sync = () => setV(el.value);
    sync();
    el.addEventListener('change', sync);
    return () => el.removeEventListener('change', sync);
  }, [watch]);
  let text = 'Auto-generated';
  if (previews?.single) text = previews.single;
  else if (previews) {
    const scope = watch === 'class_section' ? previews.classToScope[v.split(':')[0]] : previews.buToScope[v];
    text = scope && previews.byScope[scope] ? previews.byScope[scope] : watch === 'class_section' ? 'Choose the class to see the number' : 'Choose the business unit to see the number';
  }
  return <input value={text} readOnly className="input bg-gray-50 font-mono" title="Final number is assigned when you save" />;
}
