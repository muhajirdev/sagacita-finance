CREATE TABLE `lpj_links` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`advance_id` integer NOT NULL,
	`token` text NOT NULL,
	`items` text,
	`note` text,
	`submitted_at` text,
	`created_by` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`advance_id`) REFERENCES `transactions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `lpj_links_advance_id_unique` ON `lpj_links` (`advance_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `lpj_links_token_unique` ON `lpj_links` (`token`);