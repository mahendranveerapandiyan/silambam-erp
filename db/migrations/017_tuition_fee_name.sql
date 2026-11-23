-- The seeded Fee Type TUITION is called "Tuition Fee".
update lookup_value set meaning = 'Tuition Fee', last_update_date = now()
where lookup_type = 'FEE_TYPE' and lookup_code = 'TUITION' and meaning = 'Tuition / Training Fee';
