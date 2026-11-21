-- Access levels are now: None / View only / Read & Write.
-- "View only" includes opening records (read-only), so view implies read.
update role_privilege set can_read = 'Y' where can_view = 'Y';
