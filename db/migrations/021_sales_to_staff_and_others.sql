-- Inventory sales to staff and to other buyers (paid at once, recorded as income)
alter table stock_txn add column if not exists buyer_type text;                -- SALE_BUYER_TYPE lookup: STUDENT / STAFF / OTHER
alter table stock_txn add column if not exists buyer_name text;
alter table stock_txn add column if not exists buyer_phone text;
alter table stock_txn add column if not exists finance_txn_id bigint references finance_txn(id) on delete set null;
update stock_txn set buyer_type = 'STUDENT' where txn_type_code = 'SALE' and buyer_type is null;

insert into lookup_type (lookup_type, meaning, description, module_code, access_level, created_by)
select 'SALE_BUYER_TYPE', 'Sale Buyer Type', 'Who items are sold to (Inventory › Sell Items).', 'INVENTORY', 'SYSTEM', 'MIGRATION'
where not exists (select 1 from lookup_type where lookup_type = 'SALE_BUYER_TYPE');
insert into lookup_value (lookup_type, lookup_code, meaning, display_seq, system_flag, created_by)
select 'SALE_BUYER_TYPE', v.c, v.m, v.s, 'Y', 'MIGRATION'
from (values ('STUDENT', 'Student', 10), ('STAFF', 'Staff', 20), ('OTHER', 'Other', 30)) v(c, m, s)
where exists (select 1 from lookup_type where lookup_type = 'SALE_BUYER_TYPE')
  and not exists (select 1 from lookup_value x where x.lookup_type = 'SALE_BUYER_TYPE' and x.lookup_code = v.c);
insert into lookup_value (lookup_type, lookup_code, meaning, display_seq, system_flag, created_by)
select 'INCOME_CATEGORY', 'INVENTORY_SALE', 'Equipment / Uniform Sales', 25, 'Y', 'MIGRATION'
where exists (select 1 from lookup_type where lookup_type = 'INCOME_CATEGORY')
  and not exists (select 1 from lookup_value x where x.lookup_type = 'INCOME_CATEGORY' and x.lookup_code = 'INVENTORY_SALE');
-- sales are no longer only to students
update lookup_value set meaning = 'Sale' where lookup_type = 'STOCK_TXN_TYPE' and lookup_code = 'SALE' and meaning = 'Sale to Student';
