-- Performance: per-demand totals computed with indexed lookups, so filtering the
-- view by student (fee pages, lists, eligibility checks) no longer re-aggregates
-- every payment in the system.
create index if not exists fee_allocation_demand_idx on fee_allocation(demand_id);
create index if not exists fee_exemption_demand_idx on fee_exemption(demand_id, status_code);
create index if not exists fee_payment_person_idx on fee_payment(person_id);
create index if not exists fee_payment_date_idx on fee_payment(enterprise_id, payment_date);
create index if not exists fee_demand_ay_idx on fee_demand(academic_year_id, business_unit_id);
create index if not exists student_attendance_bu_date_idx on student_attendance(business_unit_id, attendance_date);
create index if not exists exam_candidate_person_idx on exam_candidate(person_id);
create index if not exists event_participant_person_idx on event_participant(person_id);
create index if not exists class_incharge_person_idx on class_incharge(person_id);
create index if not exists class_incharge_class_idx on class_incharge(class_id);
create index if not exists stock_txn_item_bu_idx on stock_txn(item_id, business_unit_id);
create index if not exists finance_txn_date_idx on finance_txn(enterprise_id, txn_date);

create or replace view fee_demand_v as
select d.*,
  coalesce(p.paid, 0)      as paid_amount,
  coalesce(x.exempted, 0)  as exempted_amount,
  greatest(d.amount - coalesce(p.paid,0) - coalesce(x.exempted,0), 0) as balance_amount,
  case
    when d.cancelled_flag = 'Y' then 'CANCELLED'
    when coalesce(x.exempted,0) >= d.amount and d.amount > 0 then 'FULL_EXEMPT'
    when coalesce(x.exempted,0) > 0 then 'PARTIAL_EXEMPT'
    when coalesce(p.paid,0) >= d.amount then 'PAID'
    when coalesce(p.paid,0) > 0 then 'PARTIAL'
    else 'UNPAID'
  end as payment_status
from fee_demand d
left join lateral (
  select sum(a.amount) paid from fee_allocation a
  join fee_payment fp on fp.id = a.payment_id and fp.status_code = 'ACTIVE'
  where a.demand_id = d.id) p on true
left join lateral (
  select sum(e.amount) exempted from fee_exemption e
  where e.demand_id = d.id and e.status_code = 'APPROVED') x on true;

analyze;
