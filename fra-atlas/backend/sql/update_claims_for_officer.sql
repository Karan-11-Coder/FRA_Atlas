-- Claims table updates
ALTER TABLE claims ADD COLUMN assigned_officer_id INTEGER;
ALTER TABLE claims ADD COLUMN assigned_date TEXT;
ALTER TABLE claims ADD COLUMN closed_date TEXT;
ALTER TABLE claims ADD COLUMN last_status_update TEXT;
ALTER TABLE claims ADD COLUMN reopen_count INTEGER DEFAULT 0;

-- Officers table extensions
ALTER TABLE officers ADD COLUMN level TEXT;
ALTER TABLE officers ADD COLUMN district TEXT;
ALTER TABLE officers ADD COLUMN supervisor_id INTEGER;
ALTER TABLE officers ADD COLUMN active INTEGER DEFAULT 1;
