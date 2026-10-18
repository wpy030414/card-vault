CREATE TABLE `crop_presets` (
	`id` text PRIMARY KEY,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`quad` text NOT NULL,
	`created_at` integer NOT NULL,
	CONSTRAINT `fk_crop_presets_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX `crop_presets_user_idx` ON `crop_presets` (`user_id`,`created_at`);