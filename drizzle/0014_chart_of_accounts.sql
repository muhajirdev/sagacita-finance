CREATE TABLE `accounts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`group` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `accounts_code_unique` ON `accounts` (`code`);--> statement-breakpoint
ALTER TABLE `transactions` ADD `account_id` integer REFERENCES accounts(id);--> statement-breakpoint
-- PT SRI chart of accounts, from TRIAL BALANCE PT SRI (Dec 31, 2025) in the client's Statement of Financial file.
INSERT INTO `accounts` (`code`, `name`, `group`, `sort_order`) VALUES
  ('10.02.01.13', 'Bank BCA a/n 2372578000', 'balance', 0),
  ('10.02.01.14', 'Bank OCBC a.n 755800000100', 'balance', 1),
  ('10.04.01.02', 'Account Receivable (Client)', 'balance', 2),
  ('10.05.06.12', 'Shareholder Receivable', 'balance', 3),
  ('10.05.06.03', 'Other Receivables - PT Sinergi Reputasi Anak Bangsa', 'balance', 4),
  ('10.05.06.04', 'Other Receivables - Div Sagacita Digital', 'balance', 5),
  ('10.09.01.01', 'Advance', 'balance', 6),
  ('11.01.01.05', 'Computer', 'balance', 7),
  ('11.02.02.05', 'Computer', 'balance', 8),
  ('10.11.01.03', 'Prepaid Tax Article 23', 'balance', 9),
  ('10.11.02.01', 'Prepaid Vat', 'balance', 10),
  ('10.11.03.01', 'Prepaid Tax - PPh Final 0,5%', 'balance', 11),
  ('20.01.01.02', 'Account Payable (Vendor)', 'balance', 12),
  ('20.02.06.99', 'Other Payables', 'balance', 13),
  ('20.02.07.00', 'Other Payable PT Fabrikasi Anak Bangsa', 'balance', 14),
  ('20.05.01.00', 'Payroll Liabilities', 'balance', 15),
  ('20.06.01.01', 'PPh 21 (Vendor)', 'balance', 16),
  ('20.06.01.08', 'PP 23', 'balance', 17),
  ('20.06.01.04', 'PPh 23 Keluaran', 'balance', 18),
  ('20.06.02.02', 'PPh 4 (2) Sewa', 'balance', 19),
  ('20.06.01.02', 'PPh 21 (Employee)', 'balance', 20),
  ('30.01.01.01', 'Shareholder Paid-in Capital', 'balance', 21),
  ('30.01.03.02', 'Retainer Earning', 'balance', 22),
  ('40.01.01.01', 'Billing (Invoice Client/Customer)', 'revenue', 23),
  ('5000.01.12', 'General Operational Project', 'cost_of_service', 24),
  ('5000.01.06', 'POSM', 'cost_of_service', 25),
  ('5000.02.04', 'Activation', 'cost_of_service', 26),
  ('5000.02.01', 'Artist & Talent (MC/Host/Dancer/Model)', 'cost_of_service', 27),
  ('5000.02.03', 'Photographer & Videographer/Video Editing', 'cost_of_service', 28),
  ('5000.02.05', 'Monitoring', 'cost_of_service', 29),
  ('5000.02.02', 'Creative & Design', 'cost_of_service', 30),
  ('5000.03.07', 'Allowance Project', 'cost_of_service', 31),
  ('5000.01.09', 'Official Travel & Transport', 'cost_of_service', 32),
  ('5000.01.11', 'Event Organizer / EO', 'cost_of_service', 33),
  ('5000.03.04', 'Entertainment', 'cost_of_service', 34),
  ('60.01.01.01', 'Salary', 'operating_expense', 35),
  ('60.01.01.08', 'BPJS Ketenagakerjaan', 'operating_expense', 36),
  ('60.01.01.06', 'Medical (out patient)', 'operating_expense', 37),
  ('60.01.01.13', 'PPh 21 (Employee)', 'operating_expense', 38),
  ('60.02.01.11', 'Electricity, Internet & Communication', 'operating_expense', 39),
  ('60.02.01.02', 'Transport (Travel Expense, GAS, Tol, Parking, Other) - HO', 'operating_expense', 40),
  ('60.02.01.10', 'Office Supplies', 'operating_expense', 41),
  ('60.02.01.18', 'Other Cost Expenses', 'operating_expense', 42),
  ('60.05.01.03', 'Maintenance - Building', 'operating_expense', 43),
  ('60.02.01.13', 'Consultant (Legal, Audit, Expert)', 'operating_expense', 44),
  ('60.05.01.08', 'Rent Computer - HO', 'operating_expense', 45),
  ('60.05.01.01', 'Rent Building/Office - HO', 'operating_expense', 46),
  ('60.02.01.16', 'General Operational Office', 'operating_expense', 47),
  ('60.02.01.05', 'Subscription - HO', 'operating_expense', 48),
  ('60.04.01.05', 'Depreciation - Computer', 'operating_expense', 49),
  ('80.01.00.01', 'Tax Income Expenses PP 55', 'income_tax', 50),
  ('70.01.01.02', 'Bank Charge', 'other_expense', 51),
  ('70.01.01.04', 'Tax Income Interest', 'other_expense', 52),
  ('71.01.01.02', 'Interest Income', 'other_income', 53);

--> statement-breakpoint
DROP VIEW IF EXISTS v_transactions;--> statement-breakpoint
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
    t.advance_id, t.tax_period,
    t.account_id, ac.code as account_code, ac.name as account,
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
  left join parties pa on pa.id = t.party_id
  left join accounts ac on ac.id = t.account_id;
