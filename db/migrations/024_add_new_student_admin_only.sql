-- "Add New Student" (direct admission, no approval) is for administrators;
-- staff use the Admission Form, which goes for approval.
delete from role_privilege where privilege_code = 'CD_STUDENT_ADMISSION_PRV' and role_code in ('INCHARGE', 'STAFF');
