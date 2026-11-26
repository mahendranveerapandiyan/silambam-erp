import Link from 'next/link';
import { requirePriv } from '@/lib/auth';
import { getAsOf } from '@/lib/asof';
import { academicYearOn } from '@/lib/people';
import { PageHeader, Flash, type SP, s as one } from '@/components/ui';
import { Stepper, DetailsForm } from '@/components/ExamSetup';

/** Create Exam – stop 1 of the setup; the exam is saved as a draft and the next stops follow. */
export default async function NewExam({ searchParams }: { searchParams: SP }) {
  const u = await requirePriv('CD_EXAM_SETUP_PRV', 'WRITE');
  const sp = await searchParams;
  const asOf = await getAsOf();
  const ay = one(sp.ay) ?? String((await academicYearOn(u.enterpriseId, asOf))?.id ?? '');
  return (
    <div className="max-w-6xl">
      <PageHeader title="Create Exam" subtitle="Eight stops: details, grades, student eligibility, subjects, evaluation template, grading range, outcome and examiners. The exam stays a draft until the last stop is finished."
        actions={<Link href="/exams" className="btn">All exams</Link>} />
      <Flash sp={sp} />
      <Stepper examId={null} step={1} reached={0} />
      <h2 className="h2">Stop 1 of 8 · Exam Details</h2>
      <DetailsForm u={u} defaultAy={ay || undefined} asOf={asOf} readOnly={false} />
    </div>
  );
}
