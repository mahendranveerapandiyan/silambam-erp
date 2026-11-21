// Registry of configurable, date-tracked structures. One generic set of
// screens (/setup/[entity]) drives create / view / update / correct /
// end-date / history for every entry below.

export type FieldType = 'text' | 'textarea' | 'number' | 'time' | 'color' | 'lookup' | 'multilookup' | 'ref' | 'yesno';
export type Field = {
  name: string;
  label: string;
  type: FieldType;
  lookup?: string; // lookup type for 'lookup' / 'multilookup' (stored as comma-separated codes)
  ref?: string; // entity key for 'ref'
  parentField?: string; // dependent lookup (e.g. state depends on country)
  required?: boolean;
  list?: boolean; // show on list page
  default?: string;
  help?: string;
  showWhen?: { field: string; values: string[] }; // only shown (and required) when another field has one of these values
};
export type Entity = {
  key: string;
  table: string;
  label: string;
  plural: string;
  group: 'Enterprise Structure' | 'Academic Structure' | 'Workforce Structure';
  description: string;
  fields: Field[];
  fixed?: Record<string, string>; // fixed column values (e.g. person_category)
  parentRef?: { field: string; entity: string }; // used to label options "Parent › Name"
  priv: string; // privilege controlling this setup task
};

const active: Field = { name: 'active_flag', label: 'Active', type: 'yesno', default: 'Y', list: true };

const E: Entity[] = [
  // ---------------- Enterprise structure ----------------
  {
    key: 'locations', table: 'location', priv: 'CD_LOCATION_PRV', label: 'Location', plural: 'Locations', group: 'Enterprise Structure',
    description: 'Physical places: training centers, grounds, offices. Country and State come from lookups.',
    fields: [
      { name: 'location_type_code', label: 'Location Type', type: 'lookup', lookup: 'LOCATION_TYPE', list: true },
      { name: 'address_line1', label: 'Address Line 1', type: 'text' },
      { name: 'address_line2', label: 'Address Line 2', type: 'text' },
      { name: 'city', label: 'City', type: 'text', list: true },
      { name: 'country_code', label: 'Country', type: 'lookup', lookup: 'COUNTRY', list: true, default: 'IN' },
      { name: 'state_code', label: 'State', type: 'lookup', lookup: 'STATE', parentField: 'country_code', list: true },
      { name: 'postal_code', label: 'Postal Code', type: 'text' },
      { name: 'phone', label: 'Phone', type: 'text' },
      active,
    ],
  },
  {
    key: 'divisions', table: 'division', priv: 'CD_DIVISION_PRV', label: 'Division', plural: 'Divisions', group: 'Enterprise Structure',
    description: 'Optional grouping of legal employers (e.g. regions).', fields: [active],
  },
  {
    key: 'legal-employers', table: 'legal_employer', priv: 'CD_LEGAL_EMPLOYER_PRV', label: 'Legal Employer', plural: 'Legal Employers', group: 'Enterprise Structure',
    description: 'Registered legal entities (trust, society, company) that employ staff and admit students.',
    fields: [
      { name: 'division_id', label: 'Division', type: 'ref', ref: 'divisions', list: true },
      { name: 'registration_number', label: 'Registration Number', type: 'text', list: true },
      { name: 'tax_number', label: 'Tax / GST Number', type: 'text' },
      { name: 'location_id', label: 'Registered Location', type: 'ref', ref: 'locations' },
      { name: 'currency_code', label: 'Currency', type: 'lookup', lookup: 'CURRENCY', default: 'INR', list: true },
      active,
    ],
  },
  {
    key: 'business-units', table: 'business_unit', priv: 'CD_BUSINESS_UNIT_PRV', label: 'Business Unit', plural: 'Business Units (Branches)', group: 'Enterprise Structure',
    description: 'Branches. Each belongs to a legal employer.',
    fields: [
      { name: 'legal_employer_id', label: 'Legal Employer', type: 'ref', ref: 'legal-employers', required: true, list: true },
      { name: 'location_id', label: 'Location', type: 'ref', ref: 'locations', list: true },
      { name: 'phone', label: 'Phone', type: 'text' },
      { name: 'email', label: 'Email', type: 'text' },
      active,
    ],
  },
  {
    key: 'classes', table: 'class', priv: 'CD_CLASS_PRV', label: 'Class', plural: 'Classes / Batches', group: 'Enterprise Structure',
    description: 'Training batches within a business unit.', parentRef: { field: 'business_unit_id', entity: 'business-units' },
    fields: [
      { name: 'business_unit_id', label: 'Business Unit', type: 'ref', ref: 'business-units', required: true, list: true },
      { name: 'duration_type_code', label: 'Class Duration', type: 'lookup', lookup: 'CLASS_DURATION_TYPE', required: true, list: true, help: 'Fixed: in & out time · Flexible: min & max duration · Hybrid: training days only' },
      { name: 'start_time', label: 'In Time', type: 'time', required: true, list: true, showWhen: { field: 'duration_type_code', values: ['FIXED'] } },
      { name: 'end_time', label: 'Out Time', type: 'time', required: true, list: true, showWhen: { field: 'duration_type_code', values: ['FIXED'] } },
      { name: 'min_duration_mins', label: 'Minimum Duration (minutes)', type: 'number', required: true, list: true, showWhen: { field: 'duration_type_code', values: ['FLEXIBLE'] } },
      { name: 'max_duration_mins', label: 'Maximum Duration (minutes)', type: 'number', required: true, list: true, showWhen: { field: 'duration_type_code', values: ['FLEXIBLE'] } },
      { name: 'training_days', label: 'Training Days', type: 'multilookup', lookup: 'DAY_OF_WEEK', required: true, list: true },
      { name: 'capacity', label: 'Capacity', type: 'number' },
      active,
    ],
  },
  {
    key: 'sections', table: 'section', priv: 'CD_SECTION_PRV', label: 'Section', plural: 'Sections', group: 'Enterprise Structure',
    description: 'Sub-groups of a class.', parentRef: { field: 'class_id', entity: 'classes' },
    fields: [
      { name: 'class_id', label: 'Class', type: 'ref', ref: 'classes', required: true, list: true },
      { name: 'capacity', label: 'Capacity', type: 'number', list: true },
      active,
    ],
  },
  // ---------------- Academic structure ----------------
  {
    key: 'student-grades', table: 'student_grade', priv: 'CD_STUDENT_GRADE_PRV', label: 'Student Grade', plural: 'Student Grades / Levels', group: 'Academic Structure',
    description: 'Silambam levels/belts in order. Grade exams promote students to the next grade.',
    fields: [
      { name: 'sequence_no', label: 'Sequence', type: 'number', required: true, list: true },
      { name: 'belt_color', label: 'Belt / Sash Colour', type: 'text', list: true },
      { name: 'min_months_in_grade', label: 'Minimum Months in Grade', type: 'number', list: true },
      { name: 'next_grade_id', label: 'Next Grade', type: 'ref', ref: 'student-grades', list: true },
      active,
    ],
  },
  { key: 'houses', table: 'house', priv: 'CD_HOUSE_PRV', label: 'House', plural: 'Houses', group: 'Academic Structure', description: 'Student houses.', fields: [{ name: 'color', label: 'Colour', type: 'color', list: true }, active] },
  { key: 'clubs', table: 'club', priv: 'CD_CLUB_PRV', label: 'Club', plural: 'Clubs', group: 'Academic Structure', description: 'Student clubs / teams.', fields: [active] },
  { key: 'communities', table: 'community', priv: 'CD_COMMUNITY_PRV', label: 'Community', plural: 'Communities', group: 'Academic Structure', description: 'Student community classification.', fields: [active] },
  {
    key: 'subjects', table: 'subject', priv: 'CD_SUBJECT_PRV', label: 'Subject', plural: 'Subjects', group: 'Academic Structure',
    description: 'Exam subjects. Subject Type (Theory, Practical, Viva) is a lookup.',
    fields: [
      { name: 'subject_type_code', label: 'Subject Type', type: 'lookup', lookup: 'SUBJECT_TYPE', required: true, list: true },
      { name: 'default_max_marks', label: 'Default Max Marks', type: 'number', list: true },
      { name: 'default_pass_marks', label: 'Default Pass Marks', type: 'number', list: true },
      active,
    ],
  },
  {
    key: 'student-actions', table: 'action', priv: 'CD_STUDENT_ACTIONS_SETUP_PRV', label: 'Student Action', plural: 'Student Actions', group: 'Academic Structure',
    description: 'Actions that change a student assignment (Admission, Promotion, Transfer, Withdrawal...).', fixed: { person_category: 'STUDENT' },
    fields: [
      { name: 'action_type_code', label: 'Action Type', type: 'lookup', lookup: 'ACTION_TYPE', required: true, list: true },
      { name: 'assignment_status_id', label: 'Resulting Status', type: 'ref', ref: 'student-statuses', list: true, help: 'Leave empty to keep the current status' },
      active,
    ],
  },
  {
    key: 'student-statuses', table: 'assignment_status', priv: 'CD_STUDENT_STATUS_PRV', label: 'Student Status', plural: 'Student Statuses', group: 'Academic Structure',
    description: 'User-defined statuses mapped to a system status.', fixed: { person_category: 'STUDENT' },
    fields: [{ name: 'system_status_code', label: 'System Status', type: 'lookup', lookup: 'SYSTEM_ASSIGNMENT_STATUS', required: true, list: true }, active],
  },
  {
    key: 'student-person-types', table: 'person_type', priv: 'CD_STUDENT_PERSON_TYPE_PRV', label: 'Student Person Type', plural: 'Student Person Types', group: 'Academic Structure',
    description: 'Person types for students.', fixed: { person_category: 'STUDENT' }, fields: [active],
  },
  // ---------------- Workforce structure ----------------
  { key: 'jobs', table: 'job', priv: 'CD_JOB_PRV', label: 'Job', plural: 'Jobs', group: 'Workforce Structure', description: 'Jobs such as Master, Instructor, Administrator.', fields: [{ name: 'job_family_code', label: 'Job Family', type: 'lookup', lookup: 'JOB_FAMILY', list: true }, active] },
  {
    key: 'staff-grades', table: 'staff_grade', priv: 'CD_STAFF_GRADE_PRV', label: 'Staff Grade', plural: 'Staff Grades', group: 'Workforce Structure', description: 'Staff grades with salary ranges.',
    fields: [
      { name: 'min_salary', label: 'Minimum Salary', type: 'number', list: true },
      { name: 'max_salary', label: 'Maximum Salary', type: 'number', list: true },
      { name: 'currency_code', label: 'Currency', type: 'lookup', lookup: 'CURRENCY', default: 'INR', list: true },
      active,
    ],
  },
  {
    key: 'departments', table: 'department', priv: 'CD_DEPARTMENT_PRV', label: 'Department', plural: 'Departments', group: 'Workforce Structure', description: 'Departments.',
    fields: [
      { name: 'business_unit_id', label: 'Business Unit', type: 'ref', ref: 'business-units', list: true },
      { name: 'location_id', label: 'Location', type: 'ref', ref: 'locations', list: true },
      active,
    ],
  },
  {
    key: 'positions', table: 'position', priv: 'CD_POSITION_PRV', label: 'Position', plural: 'Positions', group: 'Workforce Structure', description: 'Positions combine job, department and business unit with a headcount.',
    fields: [
      { name: 'business_unit_id', label: 'Business Unit', type: 'ref', ref: 'business-units', list: true },
      { name: 'department_id', label: 'Department', type: 'ref', ref: 'departments', required: true, list: true },
      { name: 'parent_position_id', label: 'Parent Position (reports to)', type: 'ref', ref: 'positions', list: true, help: 'Builds the position hierarchy' },
      { name: 'job_id', label: 'Job', type: 'ref', ref: 'jobs', list: true },
      { name: 'staff_grade_id', label: 'Grade', type: 'ref', ref: 'staff-grades' },
      { name: 'headcount', label: 'Headcount', type: 'number', default: '1', list: true },
      { name: 'full_time_flag', label: 'Full Time', type: 'yesno', default: 'Y' },
      active,
    ],
  },
  {
    key: 'staff-actions', table: 'action', priv: 'CD_STAFF_ACTIONS_SETUP_PRV', label: 'Staff Assignment Action', plural: 'Staff Assignment Actions', group: 'Workforce Structure',
    description: 'Actions that change a staff assignment (Hire, Promotion, Transfer, Termination...).', fixed: { person_category: 'STAFF' },
    fields: [
      { name: 'action_type_code', label: 'Action Type', type: 'lookup', lookup: 'ACTION_TYPE', required: true, list: true },
      { name: 'assignment_status_id', label: 'Resulting Status', type: 'ref', ref: 'staff-statuses', list: true, help: 'Leave empty to keep the current status' },
      active,
    ],
  },
  {
    key: 'staff-statuses', table: 'assignment_status', priv: 'CD_STAFF_STATUS_PRV', label: 'Assignment Status', plural: 'Assignment Statuses', group: 'Workforce Structure',
    description: 'Staff assignment statuses mapped to a system status.', fixed: { person_category: 'STAFF' },
    fields: [
      { name: 'system_status_code', label: 'System Status', type: 'lookup', lookup: 'SYSTEM_ASSIGNMENT_STATUS', required: true, list: true },
      { name: 'payroll_eligible_flag', label: 'Payroll Eligible', type: 'yesno', default: 'N', list: true },
      active,
    ],
  },
  { key: 'staff-person-types', table: 'person_type', priv: 'CD_STAFF_PERSON_TYPE_PRV', label: 'Staff Person Type', plural: 'Person Types', group: 'Workforce Structure', description: 'Person types for staff (Staff, Instructor...).', fixed: { person_category: 'STAFF' }, fields: [active] },
];

export const ENTITIES: Record<string, Entity> = Object.fromEntries(E.map((e) => [e.key, e]));
export function getEntity(key: string): Entity | undefined {
  return ENTITIES[key];
}
