-- Removes the dummy data made by scripts/sample-data.py.
DELETE FROM payments WHERE transaction_id IN (SELECT id FROM transactions WHERE source = 'import');
DELETE FROM transactions WHERE source = 'import';
DELETE FROM budget_lines WHERE project_id IN (SELECT id FROM projects WHERE code LIKE 'DEMO-%');
DELETE FROM projects WHERE code LIKE 'DEMO-%';
DELETE FROM parties WHERE notes = 'sample';
DELETE FROM payroll_months WHERE notes = 'sample';
UPDATE opex_budgets SET annual_budget = 0 WHERE fiscal_year = 2026;
