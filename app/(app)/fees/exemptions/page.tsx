import { redirect } from 'next/navigation';

/** Fee exception approvals now live in the approvals area. */
export default function Exemptions() {
  redirect('/approvals');
}
