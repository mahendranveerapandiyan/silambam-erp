import { requireUser, requirePriv, can, canAny, type SessionUser } from '@/lib/auth';
import { EditableForm, EditScope } from '@/components/EditMode';
import { getTheme, THEME_KEYS } from '@/lib/theme';
import { PageHeader, Flash, Field, type SP } from '@/components/ui';
import { saveTheme } from '../actions';

export default async function ThemePage({ searchParams }: { searchParams: SP }) {
  const u = await requirePriv('CD_THEME_PRV');
  const write = can(u, 'CD_THEME_PRV', 'WRITE');
  const t = await getTheme(u.enterpriseId);
  return (
    <div className="max-w-4xl">
      <PageHeader title="UI Theme" subtitle="Header, menu, body and text colours and font size. Changes apply to every user immediately." />
      <Flash sp={await searchParams} />
      <EditableForm action={saveTheme} canEdit={write} saveLabel="Save Theme">
        <div className="grid-form">
          {THEME_KEYS.map(([k, label, type]) => (
            <Field key={k} label={label}>
              {type === 'color' ? (
                <div className="flex items-center gap-2"><input type="color" name={k} defaultValue={t[k]} className="h-9 w-14 rounded border" /><span className="font-mono text-xs">{t[k]}</span></div>
              ) : type === 'number' ? (
                <input type="number" name={k} min={11} max={22} defaultValue={t[k]} className="input" />
              ) : (
                <select name={k} defaultValue={t[k]} className="input">
                  {['Inter, system-ui, sans-serif', 'Arial, sans-serif', 'Georgia, serif', 'Verdana, sans-serif', 'Tahoma, sans-serif', '"Noto Sans Tamil", sans-serif'].map((f) => <option key={f} value={f}>{f.split(',')[0].replace(/"/g, '')}</option>)}
                </select>
              )}
            </Field>
          ))}
        </div>
        <div className="mt-4"><button name="_reset" value="1" className="btn">Reset to Defaults</button></div>
      </EditableForm>
    </div>
  );
}
