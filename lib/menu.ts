import type { Role } from './auth';

export type MenuItem = { label: string; href: string };
export type MenuGroup = { label: string; roles: Role[]; items: MenuItem[] };

const lk = (t: string, label: string) => ({ label, href: `/config/lookups/${t}` });
const st = (k: string, label: string) => ({ label, href: `/setup/${k}` });

export const MENU: MenuGroup[] = [
  { label: 'Home', roles: ['INCHARGE', 'ACCOUNTANT'], items: [{ label: 'Dashboard', href: '/' }, { label: 'My Profile & QR', href: '/me' }] },
  {
    label: 'Students', roles: ['INCHARGE', 'ACCOUNTANT'],
    items: [{ label: 'Student Directory', href: '/students' }, { label: 'New Admission', href: '/students/new' }, { label: 'QR ID Cards', href: '/students/cards' }],
  },
  {
    label: 'Academic Structure', roles: [],
    items: [
      { label: 'Academic Years', href: '/academic/years' }, st('student-grades', 'Grades / Levels'), st('houses', 'Houses'), st('clubs', 'Clubs'),
      st('communities', 'Communities'), st('subjects', 'Subjects'), lk('SUBJECT_TYPE', 'Subject Types'), st('student-actions', 'Student Actions'),
      lk('ACTION_REASON', 'Action Reasons'), st('student-statuses', 'Student Statuses'), st('student-person-types', 'Student Person Types'),
    ],
  },
  {
    label: 'Staff', roles: [],
    items: [{ label: 'Staff Directory', href: '/staff' }, { label: 'Hire Staff', href: '/staff/new' }, { label: 'Class Incharges', href: '/staff/incharges' }],
  },
  {
    label: 'Workforce Structure', roles: [],
    items: [
      st('jobs', 'Jobs'), st('staff-grades', 'Grades'), st('departments', 'Departments'), st('positions', 'Positions'),
      lk('EMPLOYMENT_TYPE', 'Employment Types'), lk('EMPLOYMENT_CATEGORY', 'Employment Categories'), st('staff-person-types', 'Person Types'),
      st('staff-statuses', 'Assignment Statuses'), lk('PAYROLL_STATUS', 'Payroll Statuses'), st('staff-actions', 'Assignment Actions'),
    ],
  },
  {
    label: 'Attendance', roles: ['INCHARGE'],
    items: [
      { label: 'Student Attendance', href: '/attendance/students' }, { label: 'QR Scan', href: '/attendance/scan' },
      { label: 'Staff Attendance', href: '/attendance/staff' }, { label: 'Attendance Report', href: '/attendance/report' },
    ],
  },
  {
    label: 'Fees', roles: ['INCHARGE', 'ACCOUNTANT'],
    items: [
      { label: 'Collect Fees', href: '/fees' }, { label: 'Fee Structures', href: '/fees/structures' }, { label: 'Generate Fees', href: '/fees/generate' },
      { label: 'Exception Approvals', href: '/fees/exemptions' }, { label: 'Fee Summary', href: '/fees/summary' }, { label: 'Payment QR Codes', href: '/fees/payment-qr' },
    ],
  },
  { label: 'Exams', roles: ['INCHARGE'], items: [{ label: 'Exams', href: '/exams' }, { label: 'Exam Fees', href: '/exams/fees' }] },
  { label: 'Events', roles: ['INCHARGE'], items: [{ label: 'Events', href: '/events' }] },
  {
    label: 'Inventory', roles: ['INCHARGE', 'ACCOUNTANT'],
    items: [{ label: 'Items & Stock', href: '/inventory' }, { label: 'Sell to Student', href: '/inventory/sale' }, { label: 'Stock Entry', href: '/inventory/stock' }],
  },
  { label: 'Finance', roles: ['ACCOUNTANT'], items: [{ label: 'Income & Expenses', href: '/finance' }, { label: 'Reports', href: '/finance/reports' }] },
  {
    label: 'Configuration', roles: [],
    items: [
      { label: 'Enterprise', href: '/config/enterprise' }, st('locations', 'Locations'), st('divisions', 'Divisions'), st('legal-employers', 'Legal Employers'),
      st('business-units', 'Business Units'), st('classes', 'Classes'), st('sections', 'Sections'), { label: 'Lookups', href: '/config/lookups' },
      { label: 'Number Generation', href: '/config/numbering' }, { label: 'UI Theme', href: '/config/theme' }, { label: 'Users & Roles', href: '/config/users' },
    ],
  },
];

/** Restrict items inside a visible group for non-admin roles. */
const HIDE_FOR_NON_ADMIN = new Set(['/fees/structures', '/fees/generate', '/fees/exemptions', '/attendance/staff', '/exams/fees', '/inventory/stock']);

export function menuFor(roles: Role[]): MenuGroup[] {
  const admin = roles.includes('ADMIN');
  return MENU.filter((g) => admin || g.roles.some((r) => roles.includes(r))).map((g) => ({
    ...g,
    items: admin ? g.items.filter((i) => i.href !== '/me') : g.items.filter((i) => !HIDE_FOR_NON_ADMIN.has(i.href) || (i.href === '/fees/structures' && roles.includes('ACCOUNTANT'))),
  }));
}
