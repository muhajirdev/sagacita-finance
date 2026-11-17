CREATE TABLE `opening_balances` (
	`company_id` integer PRIMARY KEY NOT NULL,
	`as_of` text NOT NULL,
	`cash` integer DEFAULT 0 NOT NULL,
	`receivables` integer DEFAULT 0 NOT NULL,
	`other_assets` integer DEFAULT 0 NOT NULL,
	`payables` integer DEFAULT 0 NOT NULL,
	`tax_payable` integer DEFAULT 0 NOT NULL,
	`other_liabilities` integer DEFAULT 0 NOT NULL,
	`share_capital` integer DEFAULT 0 NOT NULL,
	`retained_earnings` integer DEFAULT 0 NOT NULL,
	`updated_by` text,
	`updated_at` text,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE no action
);
