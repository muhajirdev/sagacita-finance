CREATE TABLE `employees` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`position` text,
	`division_id` integer,
	`ktp` text,
	`npwp` text,
	`ptkp` text,
	`bpjs_tk_no` text,
	`bpjs_kes_no` text,
	`address` text,
	`phone` text,
	`bank_account` text,
	`base_salary` integer,
	`start_date` text,
	`end_date` text,
	`notes` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`division_id`) REFERENCES `divisions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `employees_division` ON `employees` (`division_id`);