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
  left join (select transaction_id, sum(amount) as paid from payments group by transaction_id) p
    on p.transaction_id = t.id
  left join projects pr on pr.id = t.project_id
  left join divisions d on d.id = coalesce(pr.division_id, t.division_id)
  left join parties cl on cl.id = pr.client_id
  left join budget_lines bl on bl.id = t.budget_line_id
  left join parties pa on pa.id = t.party_id;
