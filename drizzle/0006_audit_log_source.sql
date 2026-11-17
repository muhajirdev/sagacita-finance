ALTER TABLE `activity_log` ADD `source` text DEFAULT 'web' NOT NULL;--> statement-breakpoint
ALTER TABLE `activity_log` ADD `batch_id` text;--> statement-breakpoint
CREATE INDEX `activity_at` ON `activity_log` (`created_at`);--> statement-breakpoint
-- Older rows: the web app logs the user's email; anything else came through the MCP (e.g. "whatsapp:Rina").
UPDATE `activity_log` SET `source` = 'mcp' WHERE `actor` NOT LIKE '%@%';
