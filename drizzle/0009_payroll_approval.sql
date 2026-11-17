ALTER TABLE `payroll_months` ADD `status` text DEFAULT 'draft' NOT NULL;--> statement-breakpoint
ALTER TABLE `payroll_months` ADD `approved_by` text;--> statement-breakpoint
ALTER TABLE `payroll_months` ADD `approved_at` text;--> statement-breakpoint
UPDATE `payroll_months` SET `status` = 'approved', `approved_by` = 'import (2025 history)', `approved_at` = '2026-11-17T08:15:00Z';
