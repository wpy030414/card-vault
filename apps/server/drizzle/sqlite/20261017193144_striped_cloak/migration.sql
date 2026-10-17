CREATE TABLE `cards` (
	`id` text PRIMARY KEY,
	`user_id` text NOT NULL,
	`title` text NOT NULL,
	`card_date` text NOT NULL,
	`holo` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`front_mime` text NOT NULL,
	`front_width` integer NOT NULL,
	`front_height` integer NOT NULL,
	`front_data` blob NOT NULL,
	`back_mime` text,
	`back_width` integer,
	`back_height` integer,
	`back_data` blob,
	CONSTRAINT `fk_cards_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `login_attempts` (
	`token` text PRIMARY KEY,
	`mode` text NOT NULL,
	`status` text NOT NULL,
	`user_id` text,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`seen_at` integer,
	`claimed_at` integer,
	`qrsig` text,
	`ptqrtoken` text,
	`qq_uin` text,
	CONSTRAINT `fk_login_attempts_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY,
	`user_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	CONSTRAINT `fk_sessions_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY,
	`qq_open_id` text NOT NULL UNIQUE,
	`nickname` text NOT NULL,
	`avatar_url` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `cards_user_created_idx` ON `cards` (`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `login_attempts_expiry_idx` ON `login_attempts` (`expires_at`);--> statement-breakpoint
CREATE INDEX `sessions_user_idx` ON `sessions` (`user_id`);