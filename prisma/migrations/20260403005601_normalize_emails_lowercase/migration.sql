-- Normalize all existing emails to lowercase
UPDATE "users" SET "email" = LOWER("email") WHERE "email" != LOWER("email");

-- Add a unique index on LOWER(email) as a database-level safety net
CREATE UNIQUE INDEX "users_email_lower_idx" ON "users" (LOWER("email"));
