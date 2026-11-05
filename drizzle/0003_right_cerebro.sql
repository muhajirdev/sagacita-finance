CREATE TABLE `approvals` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`entity` text NOT NULL,
	`entity_id` integer NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`summary` text NOT NULL,
	`amount` integer DEFAULT 0 NOT NULL,
	`requested_by` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`decided_by` text,
	`decided_at` text,
	`note` text,
	`notified_at` text
);
--> statement-breakpoint
CREATE INDEX `approvals_status` ON `approvals` (`status`);--> statement-breakpoint
CREATE INDEX `approvals_entity` ON `approvals` (`entity`,`entity_id`);