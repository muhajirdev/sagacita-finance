-- Starting data. Rename the company to the real PT name; add the second PT when needed.
INSERT INTO companies (name) VALUES ('PT Sagacita');--> statement-breakpoint
INSERT INTO divisions (company_id, name) SELECT id, 'Sagacita PR' FROM companies WHERE name = 'PT Sagacita';--> statement-breakpoint
INSERT INTO divisions (company_id, name) SELECT id, 'SagaDigital' FROM companies WHERE name = 'PT Sagacita';--> statement-breakpoint
INSERT INTO divisions (company_id, name) SELECT id, 'Arra Comms' FROM companies WHERE name = 'PT Sagacita';--> statement-breakpoint
INSERT INTO parties (kind, name) VALUES
  ('client','Honda'),('client','Aletra'),('client','MG Motor'),('client','Omoda Jaecoo'),('client','Honest'),
  ('client','Tempo'),('client','VinFast'),('client','P&G Pantene'),('client','Intel'),
  ('client','Merz Aesthetics'),('client','RS Royal Progress');
