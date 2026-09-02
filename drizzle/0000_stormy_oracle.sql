CREATE TABLE `tournament_state` (
	`id` text PRIMARY KEY NOT NULL,
	`division` text NOT NULL,
	`level` text NOT NULL,
	`payload` text NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
