CREATE TABLE `tournament_operations` (
	`id` text PRIMARY KEY NOT NULL,
	`payload` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_by` text
);
--> statement-breakpoint
ALTER TABLE `tournament_state` ADD `version` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `tournament_state` ADD `updated_by` text;
