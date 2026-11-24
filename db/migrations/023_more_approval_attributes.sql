-- Approval rule conditions can test (almost) every field of the transaction's page.
-- Tag = the processes an attribute applies to.
with v(c, m, tag, s) as (values
  ('FEE_TYPE', 'Fee Type', 'FEE_EXCEPTION,STUDENT_ADMISSION', 10),
  ('AMOUNT', 'Exception Amount', 'FEE_EXCEPTION', 20),
  ('FEE_LINE_AMOUNT', 'Fee Line Amount', 'FEE_EXCEPTION', 21),
  ('EXCEPTION_PERCENT', 'Exception % of the Fee Line', 'FEE_EXCEPTION', 22),
  ('EXCEPTION_REASON', 'Exception Reason', 'FEE_EXCEPTION', 23),
  ('ACADEMIC_YEAR', 'Academic Year', 'FEE_EXCEPTION,STUDENT_ADMISSION', 24),
  ('LEGAL_EMPLOYER', 'Legal Employer', 'STUDENT_ADMISSION,STAFF_HIRE', 25),
  ('BUSINESS_UNIT', 'Business Unit', 'FEE_EXCEPTION,STUDENT_ADMISSION,STAFF_HIRE', 30),
  ('BRANCH', 'Branch', 'FEE_EXCEPTION,STUDENT_ADMISSION,STAFF_HIRE', 40),
  ('CLASS', 'Class', 'FEE_EXCEPTION,STUDENT_ADMISSION', 50),
  ('SECTION', 'Section', 'FEE_EXCEPTION,STUDENT_ADMISSION', 51),
  ('STUDENT_GRADE', 'Student Grade / Level', 'FEE_EXCEPTION,STUDENT_ADMISSION', 52),
  ('HOUSE', 'House', 'FEE_EXCEPTION,STUDENT_ADMISSION', 53),
  ('CLUB', 'Club', 'FEE_EXCEPTION,STUDENT_ADMISSION', 54),
  ('COMMUNITY', 'Community', 'FEE_EXCEPTION,STUDENT_ADMISSION', 55),
  ('FEE_FREQUENCY', 'Fee Frequency', 'FEE_EXCEPTION,STUDENT_ADMISSION', 56),
  ('FEE_AMOUNT', 'Fee Amount (on the assignment)', 'STUDENT_ADMISSION', 57),
  ('LOCATION', 'Location', 'STAFF_HIRE', 58),
  ('DEPARTMENT', 'Department', 'STAFF_HIRE', 60),
  ('JOB', 'Job', 'STAFF_HIRE', 70),
  ('POSITION', 'Position', 'STAFF_HIRE', 71),
  ('STAFF_GRADE', 'Staff Grade', 'STAFF_HIRE', 72),
  ('EMPLOYMENT_TYPE', 'Employment Type', 'STAFF_HIRE', 73),
  ('EMPLOYMENT_CATEGORY', 'Employment Category', 'STAFF_HIRE', 74),
  ('PAYROLL_STATUS', 'Payroll Status', 'STAFF_HIRE', 75),
  ('PERSON_TYPE', 'Person Type', 'STUDENT_ADMISSION,STAFF_HIRE', 76),
  ('ACTION_REASON', 'Action Reason', 'STUDENT_ADMISSION,STAFF_HIRE', 77),
  ('GENDER', 'Gender', 'FEE_EXCEPTION,STUDENT_ADMISSION,STAFF_HIRE', 80),
  ('NATIONALITY', 'Nationality', 'STUDENT_ADMISSION,STAFF_HIRE', 81),
  ('RELIGION', 'Religion', 'STUDENT_ADMISSION,STAFF_HIRE', 82),
  ('MOTHER_TONGUE', 'Mother Tongue', 'STUDENT_ADMISSION,STAFF_HIRE', 83),
  ('AGE', 'Age (years, on the date)', 'STUDENT_ADMISSION,STAFF_HIRE', 84)
), upd as (
  update lookup_value x set meaning = v.m, tag = v.tag, display_seq = v.s from v
  where x.lookup_type = 'APPROVAL_ATTRIBUTE' and x.lookup_code = v.c returning x.lookup_code
)
insert into lookup_value (lookup_type, lookup_code, meaning, tag, display_seq, system_flag, created_by)
select 'APPROVAL_ATTRIBUTE', v.c, v.m, v.tag, v.s, 'Y', 'MIGRATION' from v
where exists (select 1 from lookup_type where lookup_type = 'APPROVAL_ATTRIBUTE')
  and not exists (select 1 from lookup_value x where x.lookup_type = 'APPROVAL_ATTRIBUTE' and x.lookup_code = v.c);
