-- Enable geospatial support
CREATE EXTENSION IF NOT EXISTS postgis;

-- 1. Wards with geospatial boundaries
CREATE TABLE IF NOT EXISTS wards (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  deficit_index FLOAT DEFAULT 1.0,
  boundary GEOMETRY(POLYGON, 4326)
);

-- 2. Unified Users Table (Merges your two versions into one)
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT CHECK (role IN ('citizen', 'responder', 'administrator')) DEFAULT 'citizen',
  ward_id INT REFERENCES wards(id),
  refresh_token TEXT,
  reset_token TEXT,
  reset_token_expires TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Reports/Incidents (Updated to use UUID to match users.id)
CREATE TABLE IF NOT EXISTS reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title VARCHAR(100) NOT NULL,
  description TEXT NOT NULL,
  category VARCHAR(50) NOT NULL,
  status VARCHAR(20) DEFAULT 'pending',
  location VARCHAR(255),
  latitude FLOAT,
  longitude FLOAT,
  image_url TEXT,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  assigned_to UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- 4. Polls/Issues submitted by citizens
CREATE TABLE IF NOT EXISTS polls (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category TEXT CHECK (category IN ('healthcare','education','water','roads','security')),
  description TEXT,
  options TEXT[],
  ward_id INT REFERENCES wards(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  status TEXT DEFAULT 'open'
);

-- 5. Anonymous votes (SHA-256 hash prevents double voting)
CREATE TABLE IF NOT EXISTS votes (
  id SERIAL PRIMARY KEY,
  poll_id UUID REFERENCES polls(id) ON DELETE CASCADE,
  vote_hash TEXT UNIQUE NOT NULL,
  option_index INT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 6. Ranked Priorities View
CREATE OR REPLACE VIEW ranked_priorities AS
SELECT
  p.category,
  p.ward_id,
  w.name AS ward_name,
  COUNT(v.id) AS frequency,
  w.deficit_index,
  COUNT(v.id) * w.deficit_index AS priority_score
FROM polls p
JOIN votes v ON v.poll_id = p.id
JOIN wards w ON w.id = p.ward_id
GROUP BY p.category, p.ward_id, w.name, w.deficit_index
ORDER BY priority_score DESC;

-- 7. Official responses with 72-hour trigger tracking
CREATE TABLE IF NOT EXISTS responses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  poll_id UUID REFERENCES polls(id) ON DELETE CASCADE,
  responder_id UUID REFERENCES users(id) ON DELETE SET NULL,
  content TEXT,
  responded_at TIMESTAMPTZ DEFAULT NOW()
);

-- 8. Immutable audit log
CREATE TABLE IF NOT EXISTS audit_log (
  id BIGSERIAL PRIMARY KEY,
  actor_id UUID REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  target_table TEXT,
  target_id TEXT,
  timestamp TIMESTAMPTZ DEFAULT NOW()
);