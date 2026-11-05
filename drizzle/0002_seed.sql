-- Starting data. Rename the company to the real PT name; add the second PT when needed.
INSERT INTO companies (name) VALUES ('PT Sagacita');--> statement-breakpoint
INSERT INTO divisions (company_id, name) SELECT id, 'Sagacita PR' FROM companies WHERE name = 'PT Sagacita';--> statement-breakpoint
INSERT INTO divisions (company_id, name) SELECT id, 'SagaDigital' FROM companies WHERE name = 'PT Sagacita';--> statement-breakpoint
INSERT INTO divisions (company_id, name) SELECT id, 'Arra Comms' FROM companies WHERE name = 'PT Sagacita';--> statement-breakpoint
INSERT INTO parties (kind, name) VALUES
  ('client','Honda'),('client','Aletra'),('client','MG Motor'),('client','Omoda Jaecoo'),('client','Honest'),
  ('client','Tempo'),('client','VinFast'),('client','P&G Pantene'),('client','Intel'),
  ('client','Merz Aesthetics'),('client','RS Royal Progress');--> statement-breakpoint
INSERT INTO opex_budgets (category, fiscal_year, is_fixed, sort_order) VALUES
  ('Office Rental', 2026, 1, 1),
  ('Computer & Equipment Rental', 2026, 0, 2),
  ('Electricity, Internet & Communication', 2026, 0, 3),
  ('Transport & Travel', 2026, 0, 4),
  ('Office Supplies', 2026, 0, 5),
  ('Medical (Outpatient)', 2026, 0, 6),
  ('Maintenance & Building', 2026, 0, 7),
  ('Consultant & Professional Fees', 2026, 0, 8),
  ('General Office Operations', 2026, 0, 9),
  ('Subscriptions', 2026, 0, 10),
  ('Depreciation', 2026, 0, 11),
  ('Tax - PP 55', 2026, 0, 12),
  ('Other', 2026, 0, 13);
