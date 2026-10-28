-- backend/sql/create_officers.sql
-- Mirrors OFFICERS_TABLE_SQL in backend/db.py (created automatically on startup).
CREATE TABLE IF NOT EXISTS officers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  hashed_password TEXT NOT NULL,
  full_name TEXT,
  role TEXT,
  age INTEGER,
  gender TEXT,
  district TEXT,
  is_active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
