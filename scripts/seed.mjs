// Seeds base configuration (lookups, roles, actions, statuses, number rules,
// theme, admin login). `--demo` also loads a sample branch structure,
// academic year, grades, fees, staff and students.
import postgres from 'postgres';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';

const url = process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/silambam';
const sql = postgres(url, { onnotice: () => {} });
const DEMO = process.argv.includes('--demo');
const BY = 'SEED';
const SOT = '2000-01-01';

// type: [meaning, module, access, parentType, values[[code, meaning, tag?, parentCode?]]]
const LOOKUPS = {
  YES_NO: ['Yes / No', 'COMMON', 'SYSTEM', null, [['Y', 'Yes'], ['N', 'No']]],
  GENDER: ['Gender', 'COMMON', 'EXTENSIBLE', null, [['M', 'Male'], ['F', 'Female'], ['O', 'Other']]],
  TITLE: ['Title', 'COMMON', 'USER', null, [['MR', 'Mr.'], ['MS', 'Ms.'], ['MRS', 'Mrs.'], ['MASTER', 'Master'], ['MISS', 'Miss'], ['DR', 'Dr.']]],
  BLOOD_GROUP: ['Blood Group', 'COMMON', 'USER', null, [['A_POS', 'A+'], ['A_NEG', 'A-'], ['B_POS', 'B+'], ['B_NEG', 'B-'], ['AB_POS', 'AB+'], ['AB_NEG', 'AB-'], ['O_POS', 'O+'], ['O_NEG', 'O-']]],
  MARITAL_STATUS: ['Marital Status', 'COMMON', 'USER', null, [['S', 'Single'], ['M', 'Married'], ['D', 'Divorced'], ['W', 'Widowed']]],
  RELIGION: ['Religion', 'COMMON', 'USER', null, [['HINDU', 'Hindu'], ['MUSLIM', 'Muslim'], ['CHRISTIAN', 'Christian'], ['SIKH', 'Sikh'], ['JAIN', 'Jain'], ['BUDDHIST', 'Buddhist'], ['OTHER', 'Other']]],
  MOTHER_TONGUE: ['Mother Tongue', 'COMMON', 'USER', null, [['TA', 'Tamil'], ['TE', 'Telugu'], ['ML', 'Malayalam'], ['KN', 'Kannada'], ['HI', 'Hindi'], ['EN', 'English'], ['OTHER', 'Other']]],
  NATIONALITY: ['Nationality', 'COMMON', 'USER', null, [['IN', 'Indian'], ['LK', 'Sri Lankan'], ['MY', 'Malaysian'], ['SG', 'Singaporean'], ['OTHER', 'Other']]],
  RELATIONSHIP: ['Contact Relationship', 'COMMON', 'USER', null, [['FATHER', 'Father'], ['MOTHER', 'Mother'], ['GUARDIAN', 'Guardian'], ['SIBLING', 'Sibling'], ['SPOUSE', 'Spouse'], ['OTHER', 'Other']]],
  CURRENCY: ['Currency', 'COMMON', 'USER', null, [['INR', 'Indian Rupee', '₹'], ['LKR', 'Sri Lankan Rupee', 'Rs'], ['MYR', 'Malaysian Ringgit', 'RM'], ['SGD', 'Singapore Dollar', 'S$'], ['USD', 'US Dollar', '$'], ['AED', 'UAE Dirham', 'AED']]],
  COUNTRY: ['Country', 'GEOGRAPHY', 'USER', null, [['IN', 'India'], ['LK', 'Sri Lanka'], ['MY', 'Malaysia'], ['SG', 'Singapore'], ['AE', 'United Arab Emirates'], ['GB', 'United Kingdom'], ['US', 'United States']]],
  STATE: ['State / Province', 'GEOGRAPHY', 'USER', 'COUNTRY', [
    ['IN-TN', 'Tamil Nadu', null, 'IN'], ['IN-PY', 'Puducherry', null, 'IN'], ['IN-KL', 'Kerala', null, 'IN'], ['IN-KA', 'Karnataka', null, 'IN'],
    ['IN-AP', 'Andhra Pradesh', null, 'IN'], ['IN-TG', 'Telangana', null, 'IN'], ['IN-MH', 'Maharashtra', null, 'IN'], ['IN-DL', 'Delhi', null, 'IN'],
    ['LK-WP', 'Western Province', null, 'LK'], ['LK-NP', 'Northern Province', null, 'LK'], ['LK-EP', 'Eastern Province', null, 'LK'],
    ['MY-SGR', 'Selangor', null, 'MY'], ['MY-KUL', 'Kuala Lumpur', null, 'MY'], ['MY-JHR', 'Johor', null, 'MY'], ['MY-PNG', 'Penang', null, 'MY'],
    ['SG-SG', 'Singapore', null, 'SG'], ['AE-DU', 'Dubai', null, 'AE'], ['AE-AZ', 'Abu Dhabi', null, 'AE']]],
  LOCATION_TYPE: ['Location Type', 'GEOGRAPHY', 'USER', null, [['TRAINING_CENTER', 'Training Center'], ['OFFICE', 'Office'], ['GROUND', 'Ground / Open Field'], ['SCHOOL', 'Partner School'], ['WAREHOUSE', 'Store / Warehouse']]],
  PERSON_CATEGORY: ['Person Category', 'SYSTEM', 'SYSTEM', null, [['STUDENT', 'Student'], ['STAFF', 'Staff']]],
  ACTION_TYPE: ['Action Type', 'SYSTEM', 'SYSTEM', null, [['HIRE', 'Hire / Admission'], ['PROMOTION', 'Promotion'], ['TRANSFER', 'Transfer'], ['ASSIGNMENT_CHANGE', 'Assignment Change'], ['SUSPENSION', 'Suspension'], ['REINSTATE', 'Reinstate'], ['TERMINATION', 'Termination / Withdrawal'], ['REHIRE', 'Rehire / Re-admission']]],
  ACTION_REASON: ['Action Reason', 'COMMON', 'USER', 'ACTION_TYPE', [
    // [code, meaning, tag (STUDENT/STAFF/empty = both), parent action type]
    ['NEW_ADMISSION', 'New Admission', 'STUDENT', 'HIRE'], ['HIRE', 'Hire', 'STAFF', 'HIRE'], ['NEW_JOINER', 'New Joiner', 'STUDENT', 'HIRE'],
    ['GRADE_EXAM_PASSED', 'Grade Exam Passed', 'STUDENT', 'PROMOTION'], ['PERFORMANCE', 'Performance', null, 'PROMOTION'], ['GRADE_CHANGE', 'Grade / Pay Change', 'STAFF', 'PROMOTION'],
    ['RELOCATION', 'Relocation', null, 'TRANSFER'], ['BATCH_CHANGE', 'Batch Change', 'STUDENT', 'TRANSFER'], ['PERSONAL', 'Personal Reasons', null, 'TERMINATION'],
    ['RESIGNATION', 'Resignation', 'STAFF', 'TERMINATION'], ['FEES_DUE', 'Fees Due', 'STUDENT', 'SUSPENSION'], ['DISCIPLINARY', 'Disciplinary', null, 'SUSPENSION'],
    ['REJOINED', 'Rejoined', null, 'REHIRE'], ['RETURN', 'Returned', null, 'REINSTATE'], ['OTHER', 'Other']]],
  SYSTEM_ASSIGNMENT_STATUS: ['System Assignment Status', 'SYSTEM', 'SYSTEM', null, [['ACTIVE', 'Active'], ['SUSPENDED', 'Suspended'], ['INACTIVE', 'Inactive']]],
  EMPLOYMENT_TYPE: ['Employment Type', 'WORKFORCE', 'EXTENSIBLE', null, [['FULL_TIME', 'Full Time'], ['PART_TIME', 'Part Time'], ['CONTRACT', 'Contract'], ['VOLUNTEER', 'Volunteer']]],
  EMPLOYMENT_CATEGORY: ['Employment Category', 'WORKFORCE', 'EXTENSIBLE', null, [['PERMANENT', 'Permanent'], ['PROBATION', 'Probation'], ['TEMPORARY', 'Temporary'], ['VISITING', 'Visiting Master']]],
  PAYROLL_STATUS: ['Payroll Status', 'WORKFORCE', 'EXTENSIBLE', null, [['PROCESS', 'Process'], ['DONT_PROCESS', 'Do Not Process'], ['ON_HOLD', 'On Hold']]],
  JOB_FAMILY: ['Job Family', 'WORKFORCE', 'USER', null, [['TRAINING', 'Training'], ['ADMINISTRATION', 'Administration'], ['SUPPORT', 'Support']]],
  SUBJECT_TYPE: ['Subject Type', 'ACADEMIC', 'EXTENSIBLE', null, [['THEORY', 'Theory'], ['PRACTICAL', 'Practical'], ['VIVA', 'Viva']]],
  ACADEMIC_YEAR_STATUS: ['Academic Year Status', 'ACADEMIC', 'SYSTEM', null, [['FUTURE', 'Future'], ['OPEN', 'Open'], ['CLOSED', 'Closed']]],
  ATTENDANCE_STATUS: ['Attendance Status', 'ATTENDANCE', 'EXTENSIBLE', null, [['P', 'Present', 'PRESENT'], ['L', 'Late', 'PRESENT'], ['A', 'Absent', 'ABSENT'], ['LV', 'Leave', 'ABSENT'], ['HD', 'Half Day', 'HALF'], ['H', 'Holiday', 'EXCLUDE']]],
  ATTENDANCE_SOURCE: ['Attendance Source', 'ATTENDANCE', 'SYSTEM', null, [['MANUAL', 'Manual'], ['QR', 'QR Scan']]],
  FEE_TYPE: ['Fee Type', 'FEES', 'EXTENSIBLE', null, [['TUITION', 'Tuition / Training Fee'], ['ADMISSION', 'Admission Fee'], ['GRADE_EXAM', 'Grade Exam Fee'], ['ASSESSMENT', 'Assessment Fee'], ['TERM_EXAM', 'Term Exam Fee'], ['EVENT', 'Event Fee'], ['INVENTORY', 'Equipment / Uniform'], ['OTHER', 'Other']]],
  FEE_FREQUENCY: ['Fee Frequency', 'FEES', 'SYSTEM', null, [['MONTHLY', 'Monthly', '1'], ['BIMONTHLY', 'Bi-monthly', '2'], ['QUARTERLY', 'Quarterly', '3'], ['HALF_YEARLY', 'Half-yearly', '6'], ['ANNUAL', 'Annual', '12'], ['ONE_TIME', 'One Time', '0']]],
  FEE_PAYMENT_STATUS: ['Fee Payment Status', 'FEES', 'SYSTEM', null, [['PAID', 'Paid'], ['UNPAID', 'Unpaid'], ['PARTIAL', 'Partially Paid'], ['FULL_EXEMPT', 'Exception - Full'], ['PARTIAL_EXEMPT', 'Exception - Partial'], ['CANCELLED', 'Cancelled']]],
  PAYMENT_MODE: ['Payment Mode', 'FEES', 'USER', null, [['CASH', 'Cash'], ['UPI', 'UPI'], ['BANK_TRANSFER', 'Bank Transfer'], ['CARD', 'Card'], ['CHEQUE', 'Cheque']]],
  EXEMPTION_REASON: ['Exception Reason', 'FEES', 'USER', null, [['SCHOLARSHIP', 'Scholarship'], ['SIBLING', 'Sibling Concession'], ['HARDSHIP', 'Financial Hardship'], ['STAFF_CHILD', 'Staff Child'], ['MERIT', 'Merit'], ['MANAGEMENT', 'Management Decision']]],
  APPROVAL_STATUS: ['Approval Status', 'SYSTEM', 'SYSTEM', null, [['PENDING', 'Pending Approval'], ['APPROVED', 'Approved'], ['REJECTED', 'Rejected']]],
  EXAM_TYPE: ['Exam Type', 'EXAMS', 'SYSTEM', null, [['GRADE_EXAM', 'Grade Exam'], ['ASSESSMENT', 'Assessment'], ['TERM_EXAM', 'Term Exam']]],
  EXAM_STATUS: ['Exam Status', 'EXAMS', 'SYSTEM', null, [['SCHEDULED', 'Scheduled'], ['COMPLETED', 'Completed'], ['PUBLISHED', 'Results Published'], ['CANCELLED', 'Cancelled']]],
  EXAM_RESULT: ['Exam Result', 'EXAMS', 'SYSTEM', null, [['PENDING', 'Pending'], ['PASS', 'Pass'], ['FAIL', 'Fail'], ['ABSENT', 'Absent']]],
  EVENT_TYPE: ['Event Type', 'EVENTS', 'USER', null, [['TOURNAMENT', 'Tournament'], ['DEMONSTRATION', 'Demonstration'], ['WORKSHOP', 'Workshop / Seminar'], ['ARANGETRAM', 'Arangetram'], ['CULTURAL', 'Cultural Program'], ['CAMP', 'Training Camp']]],
  EVENT_STATUS: ['Event Status', 'EVENTS', 'SYSTEM', null, [['PLANNED', 'Planned'], ['OPEN', 'Registration Open'], ['COMPLETED', 'Completed'], ['CANCELLED', 'Cancelled']]],
  PARTICIPATION: ['Participation Role', 'EVENTS', 'USER', null, [['PARTICIPANT', 'Participant'], ['PERFORMER', 'Performer'], ['CAPTAIN', 'Team Captain'], ['VOLUNTEER', 'Volunteer']]],
  ITEM_CATEGORY: ['Item Category', 'INVENTORY', 'USER', null, [['STICK', 'Silambam Stick'], ['UNIFORM', 'Uniform'], ['PROTECTIVE_GEAR', 'Protective Gear'], ['ACCESSORY', 'Accessory'], ['BOOK', 'Book / Material']]],
  UOM: ['Unit of Measure', 'INVENTORY', 'USER', null, [['EA', 'Each'], ['PAIR', 'Pair'], ['SET', 'Set']]],
  STOCK_TXN_TYPE: ['Stock Transaction Type', 'INVENTORY', 'SYSTEM', null, [['RECEIPT', 'Stock Receipt'], ['SALE', 'Sale to Student'], ['RETURN', 'Return'], ['ADJUSTMENT', 'Adjustment']]],
  INCOME_CATEGORY: ['Income Category', 'FINANCE', 'USER', null, [['DONATION', 'Donation'], ['SPONSORSHIP', 'Sponsorship'], ['EVENT_INCOME', 'Event Income'], ['OTHER', 'Other Income']]],
  EXPENSE_CATEGORY: ['Expense Category', 'FINANCE', 'USER', null, [['RENT', 'Rent'], ['SALARY', 'Salary / Honorarium'], ['UTILITIES', 'Electricity & Utilities'], ['EQUIPMENT', 'Equipment Purchase'], ['EVENT', 'Event Expense'], ['TRAVEL', 'Travel'], ['MAINTENANCE', 'Maintenance'], ['MARKETING', 'Marketing'], ['OTHER', 'Other']]],
  ROLE: ['Application Role', 'SYSTEM', 'SYSTEM', null, [['ADMIN', 'Administrator'], ['INCHARGE', 'Class Incharge'], ['STAFF', 'Staff'], ['ACCOUNTANT', 'Accountant'], ['PARENT', 'Parent / Guardian'], ['STUDENT', 'Student']]],
  NUMBER_OBJECT: ['Number Generation Object', 'SYSTEM', 'SYSTEM', null, [['PERSON', 'Person Number'], ['STUDENT', 'Student Number'], ['STAFF', 'Staff Number'], ['RECEIPT', 'Fee Receipt Number']]],
  NUMBER_METHOD: ['Number Generation Method', 'SYSTEM', 'SYSTEM', null, [['AUTO', 'Automatic'], ['MANUAL', 'Manual']]],
  USER_NAME_METHOD: ['User Name Method', 'SYSTEM', 'SYSTEM', null, [['STAFF_NUMBER', 'Staff Number', 'STAFF'], ['FIRST_LAST', 'First and Last Name', 'STAFF'], ['EMAIL', 'Email ID', 'STAFF'], ['STUDENT_NUMBER', 'Student Number', 'STUDENT'], ['MANUAL', 'Entered Manually', 'PARENT']]],
  NUMBER_SCOPE: ['Number Generation Level', 'SYSTEM', 'SYSTEM', null, [['ENTERPRISE', 'Enterprise'], ['LE', 'Legal Employer'], ['BU', 'Business Unit'], ['BRANCH', 'Branch']]],
};

async function dt(tx, table, ent, code, name, attrs = {}, start = SOT) {
  const [b] = await tx`insert into ${tx(table)} (enterprise_id, code, created_by) values (${ent}, ${code}, ${BY}) returning id`;
  await tx`insert into ${tx(table + '_f')} ${tx({ id: b.id, effective_start_date: start, name, created_by: BY, ...attrs })}`;
  return b.id;
}

try {
  await sql.begin(async (tx) => {
    const [{ count }] = await tx`select count(*)::int as count from enterprise`;
    if (count > 0) throw new Error('Database already seeded. Use `npm run db:reset` to start over.');

    for (const [type, [meaning, module, access, parent, values]] of Object.entries(LOOKUPS)) {
      await tx`insert into lookup_type (lookup_type, meaning, module_code, access_level, parent_lookup_type, created_by)
               values (${type}, ${meaning}, ${module}, ${access}, ${parent}, ${BY})
               on conflict (lookup_type) do nothing`; // some types are created by migrations
      let seq = 10;
      for (const [code, m, tag, pcode] of values) {
        await tx`insert into lookup_value (lookup_type, lookup_code, meaning, tag, parent_code, display_seq, system_flag, created_by)
                 values (${type}, ${code}, ${m}, ${tag ?? null}, ${pcode ?? null}, ${seq}, ${access === 'SYSTEM' ? 'Y' : 'N'}, ${BY})
                 on conflict do nothing`;
        seq += 10;
      }
    }
    // codes the application logic relies on are locked even in extensible lookups
    await tx`update lookup_value set system_flag = 'Y' where (lookup_type, lookup_code) in
      (('FEE_TYPE','TUITION'),('FEE_TYPE','ADMISSION'),('FEE_TYPE','GRADE_EXAM'),('FEE_TYPE','ASSESSMENT'),('FEE_TYPE','TERM_EXAM'),('FEE_TYPE','EVENT'),('FEE_TYPE','INVENTORY'),
       ('ATTENDANCE_STATUS','P'),('ATTENDANCE_STATUS','A'),('ACTION_REASON','HIRE'),('ACTION_REASON','NEW_ADMISSION'))`;

    const [ent] = await tx`insert into enterprise (code, name, short_name, country_code, currency_code, created_by)
      values ('SA', 'Silambam Academy', 'Silambam Academy', 'IN', 'INR', ${BY}) returning id`;
    const E = ent.id;

    // Person types, statuses and actions (configurable, but needed by the app)
    const ptStudent = await dt(tx, 'person_type', E, 'STUDENT', 'Student', { person_category: 'STUDENT' });
    await dt(tx, 'person_type', E, 'STAFF', 'Staff', { person_category: 'STAFF' });
    await dt(tx, 'person_type', E, 'INSTRUCTOR', 'Instructor / Master', { person_category: 'STAFF' });
    const st = {};
    for (const [code, name, cat, sys, pay] of [
      ['STU_ACTIVE', 'Active', 'STUDENT', 'ACTIVE', 'N'], ['STU_SUSPENDED', 'Suspended', 'STUDENT', 'SUSPENDED', 'N'], ['STU_WITHDRAWN', 'Withdrawn', 'STUDENT', 'INACTIVE', 'N'],
      ['STF_ACTIVE', 'Active - Payroll Eligible', 'STAFF', 'ACTIVE', 'Y'], ['STF_ACTIVE_NP', 'Active - No Payroll', 'STAFF', 'ACTIVE', 'N'], ['STF_SUSPENDED', 'Suspended', 'STAFF', 'SUSPENDED', 'N'], ['STF_TERMINATED', 'Terminated', 'STAFF', 'INACTIVE', 'N'],
    ]) st[code] = await dt(tx, 'assignment_status', E, code, name, { person_category: cat, system_status_code: sys, payroll_eligible_flag: pay });
    for (const [code, name, cat, type, status] of [
      ['STU_ADMISSION', 'Admission', 'STUDENT', 'HIRE', 'STU_ACTIVE'], ['STU_PROMOTION', 'Grade Promotion', 'STUDENT', 'PROMOTION', 'STU_ACTIVE'],
      ['STU_TRANSFER', 'Branch / Class Transfer', 'STUDENT', 'TRANSFER', 'STU_ACTIVE'], ['STU_CHANGE', 'Change Details', 'STUDENT', 'ASSIGNMENT_CHANGE', null],
      ['STU_SUSPEND', 'Suspension', 'STUDENT', 'SUSPENSION', 'STU_SUSPENDED'], ['STU_REINSTATE', 'Reinstate', 'STUDENT', 'REINSTATE', 'STU_ACTIVE'],
      ['STU_WITHDRAW', 'Withdrawal', 'STUDENT', 'TERMINATION', 'STU_WITHDRAWN'], ['STU_READMIT', 'Re-admission', 'STUDENT', 'REHIRE', 'STU_ACTIVE'],
      ['STF_HIRE', 'Hire', 'STAFF', 'HIRE', 'STF_ACTIVE'], ['STF_PROMOTION', 'Promotion', 'STAFF', 'PROMOTION', 'STF_ACTIVE'],
      ['STF_TRANSFER', 'Transfer', 'STAFF', 'TRANSFER', 'STF_ACTIVE'], ['STF_CHANGE', 'Assignment Change', 'STAFF', 'ASSIGNMENT_CHANGE', null],
      ['STF_SUSPEND', 'Suspension', 'STAFF', 'SUSPENSION', 'STF_SUSPENDED'], ['STF_REINSTATE', 'Reinstate', 'STAFF', 'REINSTATE', 'STF_ACTIVE'],
      ['STF_TERMINATE', 'Termination', 'STAFF', 'TERMINATION', 'STF_TERMINATED'], ['STF_REHIRE', 'Rehire', 'STAFF', 'REHIRE', 'STF_ACTIVE'],
    ]) await dt(tx, 'action', E, code, name, { person_category: cat, action_type_code: type, assignment_status_id: status ? st[status] : null });

    // Number generation rules
    for (const r of [
      { object_code: 'PERSON', prefix: 'P', padding: 6, scope_code: 'ENTERPRISE' },
      { object_code: 'STUDENT', prefix: 'STU', separator: '-', padding: 4, scope_code: 'BU', include_scope_code_flag: 'Y', include_year_flag: 'Y' },
      { object_code: 'STAFF', prefix: 'EMP', separator: '-', padding: 4, scope_code: 'ENTERPRISE' },
      { object_code: 'RECEIPT', prefix: 'RC', separator: '/', padding: 5, scope_code: 'BU', include_scope_code_flag: 'Y', include_year_flag: 'Y', reset_yearly_flag: 'Y' },
    ]) await tx`insert into number_rule ${tx({ enterprise_id: E, created_by: BY, ...r })}`;
    for (const [cat, method] of [['STAFF', 'STAFF_NUMBER'], ['STUDENT', 'STUDENT_NUMBER'], ['PARENT', 'MANUAL']])
      await tx`insert into user_name_rule (enterprise_id, person_category, method_code, last_updated_by) values (${E}, ${cat}, ${method}, ${BY}) on conflict do nothing`;

    // Theme defaults
    for (const [k, v] of Object.entries({
      header_bg: '#ffffff', header_text: '#0f172a', sidebar_bg: '#0b0f19', sidebar_text: '#e2e8f0', body_bg: '#eef2f7', card_bg: '#ffffff',
      text_color: '#0f172a', primary_color: '#0284c7', accent_color: '#0ea5e9', font_size: '14', font_family: 'Inter, system-ui, sans-serif',
    })) await tx`insert into ui_setting (enterprise_id, setting_key, setting_value) values (${E}, ${k}, ${v})`;

    const [admin] = await tx`insert into user_account (enterprise_id, username, password_hash, display_name, must_change_password, created_by)
      values (${E}, 'admin', ${bcrypt.hashSync('admin123', 10)}, 'Administrator', 'Y', ${BY}) returning id`;
    await tx`insert into user_role values (${admin.id}, 'ADMIN')`;

    if (!DEMO) return;

    // ------------------------------- DEMO DATA ------------------------------
    const loc = await dt(tx, 'location', E, 'HQ', 'Head Office', { location_type_code: 'OFFICE', city: 'Madurai', state_code: 'IN-TN', country_code: 'IN' });
    const div = await dt(tx, 'division', E, 'SOUTH', 'South Region');
    const le = await dt(tx, 'legal_employer', E, 'SAT', 'Silambam Academy Trust', { country_code: 'IN', division_id: div, location_id: loc, currency_code: 'INR' });
    const bus = [];
    const branches = {};
    for (const [i, city] of ['Madurai', 'Chennai', 'Coimbatore', 'Trichy', 'Tirunelveli'].entries()) {
      const l = await dt(tx, 'location', E, `LOC${i + 1}`, `${city} Training Center`, { location_type_code: 'TRAINING_CENTER', city, state_code: 'IN-TN', country_code: 'IN' });
      const bu = await dt(tx, 'business_unit', E, `BR${i + 1}`, `${city} Branch`, { legal_employer_id: le, location_id: l });
      bus.push(bu);
      branches[bu] = await dt(tx, 'branch', E, `BR${i + 1}`, `${city} Branch`, { business_unit_id: bu, location_id: l });
    }
    const classes = [];
    for (const [bi, bu] of bus.entries()) {
      for (const [ci, [cn, tIn, tOut]] of [['Kids Batch', '06:00', '07:00'], ['Adults Batch', '18:00', '19:30']].entries()) {
        const c = await dt(tx, 'class', E, `BR${bi + 1}-C${ci + 1}`, cn, { business_unit_id: bu, branch_id: branches[bu], duration_type_code: 'FIXED', start_time: tIn, end_time: tOut, training_days: 'MON,WED,FRI', capacity: 40 });
        const s = await dt(tx, 'section', E, `BR${bi + 1}-C${ci + 1}-A`, 'Section A', { class_id: c, capacity: 20 });
        classes.push({ bu, c, s });
      }
    }
    const grades = [];
    for (const [i, [n, belt]] of [['Level 1 - Arambam', 'White'], ['Level 2 - Adi Murai', 'Yellow'], ['Level 3 - Kuthu Varisai', 'Orange'], ['Level 4 - Thani Kambu', 'Green'], ['Level 5 - Irattai Kambu', 'Blue'], ['Level 6 - Asan', 'Black']].entries())
      grades.push(await dt(tx, 'student_grade', E, `L${i + 1}`, n, { sequence_no: i + 1, belt_color: belt, min_months_in_grade: 6 }));
    for (let i = 0; i < grades.length - 1; i++) await tx`update student_grade_f set next_grade_id = ${grades[i + 1]} where id = ${grades[i]}`;
    for (const [c, n, col] of [['RED', 'Cheran House', '#dc2626'], ['BLUE', 'Cholan House', '#2563eb'], ['GREEN', 'Pandiyan House', '#16a34a']]) await dt(tx, 'house', E, c, n, { color: col });
    for (const [c, n] of [['DEMO', 'Demonstration Team'], ['COMP', 'Competition Team']]) await dt(tx, 'club', E, c, n);
    for (const [c, n] of [['GEN', 'General'], ['OBC', 'OBC'], ['SC', 'SC'], ['ST', 'ST']]) await dt(tx, 'community', E, c, n);
    for (const [c, n, t] of [['HIST', 'History & Tradition of Silambam', 'THEORY'], ['FOOT', 'Footwork (Kaaladi)', 'PRACTICAL'], ['SINGLE', 'Single Stick Techniques', 'PRACTICAL'], ['VIVA', 'Oral Examination', 'VIVA']])
      await dt(tx, 'subject', E, c, n, { subject_type_code: t, default_max_marks: 100, default_pass_marks: 40 });
    const jobs = {};
    for (const [c, n, f] of [['MASTER', 'Silambam Master', 'TRAINING'], ['INSTRUCTOR', 'Instructor', 'TRAINING'], ['ASST_INSTR', 'Assistant Instructor', 'TRAINING'], ['ADMIN', 'Branch Administrator', 'ADMINISTRATION'], ['ACCOUNTS', 'Accountant', 'ADMINISTRATION']])
      jobs[c] = await dt(tx, 'job', E, c, n, { job_family_code: f });
    const sg = await dt(tx, 'staff_grade', E, 'G1', 'Grade 1', { min_salary: 10000, max_salary: 25000, currency_code: 'INR' });
    const dept = await dt(tx, 'department', E, 'TRAINING', 'Training Department', {});

    const today = new Date();
    const ayStartYear = today.getMonth() >= 5 ? today.getFullYear() : today.getFullYear() - 1;
    const [ay] = await tx`insert into academic_year (enterprise_id, code, name, start_date, end_date, status_code, created_by)
      values (${E}, ${`AY${ayStartYear}`}, ${`Academic Year ${ayStartYear}-${String(ayStartYear + 1).slice(2)}`}, ${`${ayStartYear}-06-01`}, ${`${ayStartYear + 1}-05-31`}, 'OPEN', ${BY}) returning id`;

    const [fs] = await tx`insert into fee_structure (enterprise_id, academic_year_id, fee_type_code, name, created_by)
      values (${E}, ${ay.id}, 'TUITION', 'Training Fee (All Branches)', ${BY}) returning id`;
    for (const [f, a] of [['MONTHLY', 800], ['BIMONTHLY', 1550], ['QUARTERLY', 2300], ['HALF_YEARLY', 4500], ['ANNUAL', 8500]])
      await tx`insert into fee_structure_amount values (${fs.id}, ${f}, ${a})`;
    const [adm] = await tx`insert into fee_structure (enterprise_id, academic_year_id, fee_type_code, name, created_by)
      values (${E}, ${ay.id}, 'ADMISSION', 'Admission Fee', ${BY}) returning id`;
    await tx`insert into fee_structure_amount values (${adm.id}, 'ONE_TIME', 1000)`;
    for (const [i, g] of grades.entries()) await tx`insert into exam_fee (academic_year_id, exam_type_code, student_grade_id, amount) values (${ay.id}, 'GRADE_EXAM', ${g}, ${500 + i * 250})`;

    // number counters for demo people
    let pn = 0;
    const pnum = () => `P${String(++pn).padStart(6, '0')}`;
    await tx`insert into number_sequence (rule_id, scope_id, period, last_value) select id, 0, 'ALL', 0 from number_rule where object_code = 'PERSON'`;
    const staffAction = (await tx`select id from action where code = 'STF_HIRE'`)[0].id;
    const stuAction = (await tx`select id from action where code = 'STU_ADMISSION'`)[0].id;
    const ptInstr = (await tx`select id from person_type where code = 'INSTRUCTOR'`)[0].id;
    const ayStart = `${ayStartYear}-06-01`;

    const first = ['Arun', 'Karthik', 'Priya', 'Divya', 'Surya', 'Meena', 'Vignesh', 'Lakshmi', 'Ravi', 'Kavya', 'Senthil', 'Anitha', 'Bala', 'Deepa', 'Gokul', 'Harini', 'Mani', 'Nithya', 'Prakash', 'Revathi'];
    const last = ['Kumar', 'Raja', 'Selvam', 'Murugan', 'Pandian', 'Devi', 'Rani', 'Natarajan'];
    const mkPerson = async (fn, ln, gender, dob) => {
      const [p] = await tx`insert into person (enterprise_id, person_number, date_of_birth, qr_token, created_by)
        values (${E}, ${pnum()}, ${dob}, ${crypto.randomBytes(12).toString('hex')}, ${BY}) returning id`;
      await tx`insert into person_identifier (enterprise_id, person_id, id_type_code, id_number, issuing_country_code, primary_flag, created_by)
        values (${E}, ${p.id}, 'AADHAAR', ${String(400000000000 + Number(p.id))}, 'IN', 'Y', ${BY})`;
      await tx`insert into person_f (id, effective_start_date, first_name, last_name, gender_code, phone, city, state_code, country_code, created_by)
        values (${p.id}, ${ayStart}, ${fn}, ${ln}, ${gender}, ${'98' + String(10000000 + p.id).slice(-8)}, 'Madurai', 'IN-TN', 'IN', ${BY})`;
      return p.id;
    };
    // staff: one incharge per class + admins
    let sn = 0;
    for (const [i, cl] of classes.entries()) {
      const pid = await mkPerson(first[(i * 3) % 20], last[i % 8], i % 3 ? 'M' : 'F', '1990-04-15');
      const [a] = await tx`insert into assignment (enterprise_id, person_id, assignment_type, assignment_number, original_start_date, created_by)
        values (${E}, ${pid}, 'STAFF', ${`EMP-${String(++sn).padStart(4, '0')}`}, ${ayStart}, ${BY}) returning id`;
      await tx`insert into assignment_f ${tx({ id: a.id, effective_start_date: ayStart, action_id: staffAction, assignment_status_id: st.STF_ACTIVE, person_type_id: ptInstr,
        legal_employer_id: le, business_unit_id: cl.bu, branch_id: branches[cl.bu], job_id: i % 2 ? jobs.INSTRUCTOR : jobs.MASTER, staff_grade_id: sg, department_id: dept,
        employment_type_code: 'FULL_TIME', employment_category_code: 'PERMANENT', payroll_status_code: 'PROCESS', created_by: BY })}`;
      await tx`insert into class_incharge (person_id, class_id, section_id, academic_year_id, start_date, end_date, created_by) values (${pid}, ${cl.c}, ${null}, ${ay.id}, ${ayStart}, ${`${ayStartYear + 1}-05-31`}, ${BY})`;
      const uname = `incharge${i + 1}`;
      const [u] = await tx`insert into user_account (enterprise_id, username, password_hash, display_name, person_id, created_by)
        values (${E}, ${uname}, ${bcrypt.hashSync('pass123', 10)}, ${first[(i * 3) % 20] + ' ' + last[i % 8]}, ${pid}, ${BY}) returning id`;
      await tx`insert into user_role values (${u.id}, 'INCHARGE'), (${u.id}, 'STAFF')`;
    }
    await tx`update number_rule set start_number = 1 where object_code = 'STAFF'`;
    await tx`insert into number_sequence (rule_id, scope_id, period, last_value) select id, 0, 'ALL', ${sn} from number_rule where object_code = 'STAFF'`;

    // students: 8 per class
    const freqs = ['MONTHLY', 'MONTHLY', 'QUARTERLY', 'HALF_YEARLY', 'ANNUAL', 'BIMONTHLY'];
    const counters = {};
    let k = 0;
    for (const cl of classes) {
      for (let j = 0; j < 8; j++, k++) {
        const pid = await mkPerson(first[(k * 7) % 20], last[(k * 3) % 8], k % 2 ? 'M' : 'F', `${2008 + (k % 10)}-0${1 + (k % 9)}-1${k % 9}`);
        const buIdx = bus.indexOf(cl.bu) + 1;
        counters[cl.bu] = (counters[cl.bu] || 0) + 1;
        const num = `STU-BR${buIdx}-${ayStartYear}-${String(counters[cl.bu]).padStart(4, '0')}`;
        const [a] = await tx`insert into assignment (enterprise_id, person_id, assignment_type, assignment_number, original_start_date, created_by)
          values (${E}, ${pid}, 'STUDENT', ${num}, ${ayStart}, ${BY}) returning id`;
        await tx`insert into assignment_f ${tx({ id: a.id, effective_start_date: ayStart, action_id: stuAction, assignment_status_id: st.STU_ACTIVE, person_type_id: ptStudent,
          legal_employer_id: le, business_unit_id: cl.bu, branch_id: branches[cl.bu], academic_year_id: ay.id, class_id: cl.c, section_id: cl.s, student_grade_id: grades[k % 3],
          fee_frequency_code: freqs[k % freqs.length], created_by: BY })}`;
        await tx`insert into person_contact (person_id, relationship_code, name, phone, primary_flag, created_by)
          values (${pid}, 'FATHER', ${'Mr. ' + last[(k * 3) % 8]}, ${'97' + String(10000000 + pid).slice(-8)}, 'Y', ${BY})`;
        if (k === 0) {
          const [u] = await tx`insert into user_account (enterprise_id, username, password_hash, display_name, person_id, created_by)
            values (${E}, 'parent1', ${bcrypt.hashSync('pass123', 10)}, 'Demo Parent', ${null}, ${BY}) returning id`;
          await tx`insert into user_role values (${u.id}, 'PARENT')`;
          await tx`insert into user_student_access values (${u.id}, ${pid})`;
        }
      }
    }
    for (const [bu, n] of Object.entries(counters))
      await tx`insert into number_sequence (rule_id, scope_id, period, last_value) select id, ${bu}, 'ALL', ${n} from number_rule where object_code = 'STUDENT'`;
    await tx`update number_sequence set last_value = ${pn} where rule_id = (select id from number_rule where object_code = 'PERSON')`;

    // inventory items
    for (const [c, n, cat, size, price] of [['STK-54', 'Bamboo Stick 54"', 'STICK', '54 inch', 350], ['STK-60', 'Bamboo Stick 60"', 'STICK', '60 inch', 400],
      ['UNI-S', 'Uniform', 'UNIFORM', 'S', 650], ['UNI-M', 'Uniform', 'UNIFORM', 'M', 700], ['UNI-L', 'Uniform', 'UNIFORM', 'L', 750], ['GRD-H', 'Hand Guard (pair)', 'PROTECTIVE_GEAR', 'Free', 300]]) {
      const [it] = await tx`insert into item (enterprise_id, code, name, category_code, size_label, unit_price, reorder_level, created_by)
        values (${E}, ${c}, ${n}, ${cat}, ${size}, ${price}, 5, ${BY}) returning id`;
      for (const bu of bus) await tx`insert into stock_txn (item_id, business_unit_id, txn_date, txn_type_code, quantity, unit_price, reference, created_by)
        values (${it.id}, ${bu}, ${ayStart}, 'RECEIPT', 20, ${price}, 'Opening stock', ${BY})`;
    }
  });
  console.log(DEMO ? 'Seeded base configuration + demo data.' : 'Seeded base configuration.');
  console.log('Login: admin / admin123' + (DEMO ? '   |   incharge1 / pass123   |   parent1 / pass123' : ''));
} catch (e) {
  console.error(e.message);
  process.exitCode = 1;
} finally {
  await sql.end();
}
