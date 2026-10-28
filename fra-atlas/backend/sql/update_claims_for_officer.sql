-- No longer needs to be run by hand: the backend adds these columns on
-- startup if they're missing (CLAIMS_EXTRA_COLUMNS / OFFICERS_EXTRA_COLUMNS
-- in backend/db.py). Kept for reference; it matches that schema.

-- Claims table updates
ALTER TABLE claims ADD COLUMN assigned_officer_id INTEGER;
ALTER TABLE claims ADD COLUMN assigned_date TEXT;
ALTER TABLE claims ADD COLUMN closed_date TEXT;
ALTER TABLE claims ADD COLUMN last_status_update TEXT;
ALTER TABLE claims ADD COLUMN reopen_count INTEGER DEFAULT 0;

-- Officers table extensions
ALTER TABLE officers ADD COLUMN age INTEGER;
ALTER TABLE officers ADD COLUMN gender TEXT;
ALTER TABLE officers ADD COLUMN district TEXT;
ALTER TABLE officers ADD COLUMN is_active INTEGER DEFAULT 1;
