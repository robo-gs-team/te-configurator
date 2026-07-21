-- Merchant-controllable count of strings shown on mobile before "Show more" (desktop stays 20).
ALTER TABLE "ThemeSetting" ADD COLUMN "mobileStringCount" INTEGER NOT NULL DEFAULT 6;
