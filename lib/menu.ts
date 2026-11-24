// Menu: every item is a task guarded by its own privilege (VIEW shows it).
/** `hideWith`: not shown to users who hold that privilege with write access (they have a better task). */
export type MenuItem = { label: string; href: string; priv: string; hideWith?: string };
export type MenuGroup = { label: string; items: MenuItem[] };

const lk = (t: string, label: string, priv: string): MenuItem => ({ label, href: `/config/lookups/${t}`, priv });
const st = (k: string, label: string, priv: string): MenuItem => ({ label, href: `/setup/${k}`, priv });

export const MENU: MenuGroup[] = [
  { label: 'Home', items: [{ label: 'Dashboard', href: '/', priv: 'CD_DASHBOARD_PRV' }, { label: 'My Profile & QR', href: '/me', priv: 'CD_MY_PROFILE_PRV' }, { label: 'Portal', href: '/portal', priv: 'CD_PORTAL_PRV' }] },
  {
    label: 'Students',
    items: [
      { label: 'Student Directory', href: '/students', priv: 'CD_STUDENT_DIRECTORY_PRV' },
      { label: 'Add New Student', href: '/students/new', priv: 'CD_STUDENT_ADMISSION_PRV' },
      { label: 'Admission Form', href: '/students/admission-form', priv: 'CD_ADMISSION_FORM_PRV', hideWith: 'CD_STUDENT_ADMISSION_PRV' },
      { label: 'QR ID Cards', href: '/students/cards', priv: 'CD_STUDENT_ID_CARD_PRV' },
    ],
  },
  {
    label: 'Academic Structure',
    items: [
      { label: 'Academic Years', href: '/academic/years', priv: 'CD_ACADEMIC_YEAR_PRV' },
      st('student-grades', 'Grades / Levels', 'CD_STUDENT_GRADE_PRV'), st('houses', 'Houses', 'CD_HOUSE_PRV'), st('clubs', 'Clubs', 'CD_CLUB_PRV'),
      st('communities', 'Communities', 'CD_COMMUNITY_PRV'), st('subjects', 'Subjects', 'CD_SUBJECT_PRV'), lk('SUBJECT_TYPE', 'Subject Types', 'CD_SUBJECT_TYPE_PRV'),
      st('student-actions', 'Student Actions', 'CD_STUDENT_ACTIONS_SETUP_PRV'), lk('ACTION_REASON', 'Action Reasons', 'CD_ACTION_REASON_PRV'),
      st('student-statuses', 'Student Statuses', 'CD_STUDENT_STATUS_PRV'), st('student-person-types', 'Student Person Types', 'CD_STUDENT_PERSON_TYPE_PRV'),
    ],
  },
  {
    label: 'Staff',
    items: [
      { label: 'Staff Directory', href: '/staff', priv: 'CD_STAFF_DIRECTORY_PRV' },
      { label: 'Hire Staff', href: '/staff/new', priv: 'CD_STAFF_HIRE_PRV' },
      { label: 'Class Incharges', href: '/staff/incharges', priv: 'CD_CLASS_INCHARGE_PRV' },
    ],
  },
  {
    label: 'Workforce Structure',
    items: [
      st('jobs', 'Jobs', 'CD_JOB_PRV'), st('staff-grades', 'Grades', 'CD_STAFF_GRADE_PRV'), st('departments', 'Departments', 'CD_DEPARTMENT_PRV'),
      st('positions', 'Positions', 'CD_POSITION_PRV'), lk('EMPLOYMENT_TYPE', 'Employment Types', 'CD_EMPLOYMENT_TYPE_PRV'),
      lk('EMPLOYMENT_CATEGORY', 'Employment Categories', 'CD_EMPLOYMENT_CATEGORY_PRV'), st('staff-person-types', 'Person Types', 'CD_STAFF_PERSON_TYPE_PRV'),
      st('staff-statuses', 'Assignment Statuses', 'CD_STAFF_STATUS_PRV'), lk('PAYROLL_STATUS', 'Payroll Statuses', 'CD_PAYROLL_STATUS_PRV'),
      st('staff-actions', 'Assignment Actions', 'CD_STAFF_ACTIONS_SETUP_PRV'),
    ],
  },
  {
    label: 'Attendance',
    items: [
      { label: 'Student Attendance', href: '/attendance/students', priv: 'CD_STUDENT_ATTENDANCE_PRV' },
      { label: 'QR Scan', href: '/attendance/scan', priv: 'CD_QR_SCAN_PRV' },
      { label: 'Staff Attendance', href: '/attendance/staff', priv: 'CD_STAFF_ATTENDANCE_PRV' },
      { label: 'Attendance Report', href: '/attendance/report', priv: 'CD_ATTENDANCE_REPORT_PRV' },
      { label: 'Attendance Settings', href: '/attendance/settings', priv: 'CD_ATTENDANCE_SETTINGS_PRV' },
    ],
  },
  {
    label: 'Fees',
    items: [
      { label: 'Collect Fees', href: '/fees', priv: 'CD_FEE_COLLECT_PRV' },
      { label: 'Fee Structures', href: '/fees/structures', priv: 'CD_FEE_STRUCTURE_PRV' },
      { label: 'Generate Fees', href: '/fees/generate', priv: 'CD_FEE_GENERATE_PRV' },
      { label: 'Fee Summary', href: '/fees/summary', priv: 'CD_FEE_SUMMARY_PRV' },
      { label: 'Payment QR Codes', href: '/fees/payment-qr', priv: 'CD_PAYMENT_QR_PRV' },
    ],
  },
  {
    label: 'Approvals',
    items: [
      { label: 'My Approvals', href: '/approvals', priv: 'CD_MY_APPROVALS_PRV' },
      { label: 'My Requests', href: '/approvals/requests', priv: 'CD_MY_APPROVALS_PRV' },
      { label: 'Transaction Console', href: '/approvals/console', priv: 'CD_TRANSACTION_CONSOLE_PRV' },
    ],
  },
  {
    label: 'Exams',
    items: [
      { label: 'Exams', href: '/exams', priv: 'CD_EXAM_SETUP_PRV|CD_EXAM_CANDIDATE_PRV' },
      { label: 'Exam Fees', href: '/exams/fees', priv: 'CD_EXAM_FEE_PRV' },
    ],
  },
  { label: 'Events', items: [{ label: 'Events', href: '/events', priv: 'CD_EVENT_SETUP_PRV|CD_EVENT_PARTICIPANT_PRV' }] },
  {
    label: 'Inventory',
    items: [
      { label: 'Items & Stock', href: '/inventory', priv: 'CD_INVENTORY_ITEM_PRV' },
      { label: 'Sell Items', href: '/inventory/sale', priv: 'CD_INVENTORY_SALE_PRV' },
      { label: 'Stock Entry', href: '/inventory/stock', priv: 'CD_STOCK_ENTRY_PRV' },
    ],
  },
  {
    label: 'Finance',
    items: [
      { label: 'Income & Expenses', href: '/finance', priv: 'CD_FINANCE_TXN_PRV' },
      { label: 'Reports', href: '/finance/reports', priv: 'CD_FINANCE_REPORT_PRV' },
    ],
  },
  {
    label: 'Configuration',
    items: [
      { label: 'Enterprise', href: '/config/enterprise', priv: 'CD_ENTERPRISE_PRV' }, st('locations', 'Locations', 'CD_LOCATION_PRV'),
      st('divisions', 'Divisions', 'CD_DIVISION_PRV'), st('legal-employers', 'Legal Employers', 'CD_LEGAL_EMPLOYER_PRV'),
      st('business-units', 'Business Units', 'CD_BUSINESS_UNIT_PRV'), st('branches', 'Branches', 'CD_BRANCH_PRV'), st('classes', 'Classes', 'CD_CLASS_PRV'), st('sections', 'Sections', 'CD_SECTION_PRV'),
      { label: 'Lookups', href: '/config/lookups', priv: 'CD_LOOKUP_PRV' },
      { label: 'Additional Fields', href: '/config/fields', priv: 'CD_ADDITIONAL_FIELD_PRV' },
      { label: 'Number Generation', href: '/config/numbering', priv: 'CD_NUMBERING_PRV' },
      { label: 'UI Theme', href: '/config/theme', priv: 'CD_THEME_PRV' },
      { label: 'User Name Rules', href: '/config/user-names', priv: 'CD_USER_NAME_RULE_PRV' },
      { label: 'User Groups', href: '/config/user-groups', priv: 'CD_USER_GROUP_PRV' },
      { label: 'Approval Rules', href: '/config/approval-rules', priv: 'CD_APPROVAL_RULE_PRV' },
      { label: 'Users', href: '/config/users', priv: 'CD_USER_PRV' },
      { label: 'Roles & Privileges', href: '/config/roles', priv: 'CD_ROLE_PRV' },
    ],
  },
];

/** Privileges that may open a lookup's values page (all-lookups + the task's own). */
const LOOKUP_TASK: Record<string, string> = Object.fromEntries(
  MENU.flatMap((g) => g.items).filter((i) => i.href.startsWith('/config/lookups/')).map((i) => [i.href.split('/').pop()!, i.priv]),
);
export function lookupPrivs(type: string): string[] {
  return LOOKUP_TASK[type] ? ['CD_LOOKUP_PRV', LOOKUP_TASK[type]] : ['CD_LOOKUP_PRV'];
}

export function menuFor(privs: Record<string, number>): MenuGroup[] {
  const has = (p: string) => p.split('|').some((c) => (privs[c] ?? 0) >= 1);
  return MENU.map((g) => ({ ...g, items: g.items.filter((i) => has(i.priv) && !(i.hideWith && (privs[i.hideWith] ?? 0) >= 3)) })).filter((g) => g.items.length);
}
