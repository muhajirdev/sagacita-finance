ALTER TABLE `transactions` ADD `advance_id` integer;--> statement-breakpoint
DROP VIEW IF EXISTS v_transactions;--> statement-breakpoint
-- paid is signed: a payment in the other direction (a refund) counts against it.
-- lpj_due: a fully paid cash advance owes its LPJ (settlement report) 5 working days after it was paid.
CREATE VIEW v_transactions AS
  select
    t.id, t.kind, t.direction, t.status, t.number,
    t.issue_date, t.due_date,
    t.dpp, t.ppn, t.pph_type, t.pph, t.total,
    coalesce(p.paid, 0) as paid,
    t.total - coalesce(p.paid, 0) as outstanding,
    case when t.status != 'void' and t.due_date is not null
              and t.due_date < date('now') and t.total - coalesce(p.paid, 0) > 0
         then 1 else 0 end as overdue,
    t.advance_id,
    case when t.kind = 'cash_advance' and t.status = 'approved' and coalesce(p.paid, 0) >= t.total and t.total > 0
         then date(p.last_paid, '+' || (case strftime('%w', p.last_paid) when '6' then 6 when '0' then 5 else 7 end) || ' days')
    end as lpj_due,
    t.category, t.description, t.requested_by, t.source, t.attachment_url,
    t.company_id, c.name as company,
    coalesce(pr.division_id, t.division_id) as division_id, d.name as division,
    t.project_id, pr.code as project_code, pr.name as project_name,
    pr.client_id, cl.name as client,
    t.budget_line_id, bl.name as budget_line,
    t.party_id, pa.name as party, pa.kind as party_kind,
    t.created_at, t.updated_at
  from transactions t
  join companies c on c.id = t.company_id
  left join (
    select y.transaction_id,
           sum(case when y.direction = x.direction then y.amount else -y.amount end) as paid,
           max(y.date) as last_paid
    from payments y join transactions x on x.id = y.transaction_id
    group by y.transaction_id
  ) p on p.transaction_id = t.id
  left join projects pr on pr.id = t.project_id
  left join divisions d on d.id = coalesce(pr.division_id, t.division_id)
  left join parties cl on cl.id = pr.client_id
  left join budget_lines bl on bl.id = t.budget_line_id
  left join parties pa on pa.id = t.party_id;
