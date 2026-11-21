'use client';
import { useRef, useState, type ReactNode } from 'react';

/**
 * A form that opens read-only. Users who may edit get an "Edit" button that
 * unlocks the fields and shows Save / Cancel. Cancel restores the original values.
 */
export function EditableForm({
  action, canEdit, children, className = 'card', saveLabel = 'Save', editLabel = 'Edit', startEditing = false, id,
}: { action: (fd: FormData) => Promise<void>; canEdit: boolean; children: ReactNode; className?: string; saveLabel?: string; editLabel?: string; startEditing?: boolean; id?: string }) {
  const [editing, setEditing] = useState(startEditing && canEdit);
  const form = useRef<HTMLFormElement>(null);
  return (
    <form ref={form} action={action} className={className} id={id}>
      <fieldset disabled={!editing} className="contents">{children}</fieldset>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        {editing ? (
          <>
            <button key="save" type="submit" className="btn btn-primary">{saveLabel}</button>
            <button key="cancel" type="button" className="btn" onClick={() => { form.current?.reset(); setEditing(false); }}>Cancel</button>
          </>
        ) : canEdit ? (
          // separate key + preventDefault: the click must not "become" a click on Save
          <button key="edit" type="button" className="btn btn-primary" onClick={(e) => { e.preventDefault(); setEditing(true); }}>✎ {editLabel}</button>
        ) : (
          <span className="muted">Read only</span>
        )}
      </div>
    </form>
  );
}

/**
 * Read-only wrapper for pages that contain several small forms (e.g. lookup
 * values): everything inside is locked until "Edit" is pressed.
 */
export function EditScope({ canEdit, children, label = 'Edit' }: { canEdit: boolean; children: ReactNode; label?: string }) {
  const [editing, setEditing] = useState(false);
  return (
    <div>
      <div className="mb-3 flex items-center gap-2 no-print">
        {editing ? (
          <button key="done" type="button" className="btn" onClick={(e) => { e.preventDefault(); setEditing(false); }}>Done editing</button>
        ) : canEdit ? (
          <button key="edit" type="button" className="btn btn-primary" onClick={(e) => { e.preventDefault(); setEditing(true); }}>✎ {label}</button>
        ) : (
          <span className="muted">Read only</span>
        )}
      </div>
      <fieldset disabled={!editing} className="contents">{children}</fieldset>
    </div>
  );
}
