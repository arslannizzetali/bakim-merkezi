-- Users whose password was set by someone else must choose their own on next login.
ALTER TABLE "users" ADD COLUMN "must_change_password" BOOLEAN NOT NULL DEFAULT false;
