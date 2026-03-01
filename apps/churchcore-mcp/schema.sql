PRAGMA foreign_keys = ON;

-- Churches / campuses / locations (Planning Center-ish anchors)
CREATE TABLE IF NOT EXISTS churches (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  legal_name TEXT,
  timezone TEXT NOT NULL DEFAULT 'UTC',
  website TEXT,
  address_line1 TEXT,
  address_line2 TEXT,
  city TEXT,
  region TEXT,
  postal_code TEXT,
  country TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS campuses (
  id TEXT PRIMARY KEY,
  church_id TEXT NOT NULL,
  name TEXT NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'UTC',
  address_line1 TEXT,
  address_line2 TEXT,
  city TEXT,
  region TEXT,
  postal_code TEXT,
  country TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (church_id) REFERENCES churches(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_campuses_church ON campuses(church_id);

CREATE TABLE IF NOT EXISTS locations (
  id TEXT PRIMARY KEY,
  church_id TEXT NOT NULL,
  campus_id TEXT,
  name TEXT NOT NULL,
  address_line1 TEXT,
  address_line2 TEXT,
  city TEXT,
  region TEXT,
  postal_code TEXT,
  country TEXT,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (church_id) REFERENCES churches(id) ON DELETE CASCADE,
  FOREIGN KEY (campus_id) REFERENCES campuses(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_locations_church ON locations(church_id, campus_id);

-- People / roles (Planning Center-ish: people + households)
CREATE TABLE IF NOT EXISTS people (
  id TEXT PRIMARY KEY,
  church_id TEXT NOT NULL,
  campus_id TEXT,
  first_name TEXT,
  last_name TEXT,
  email TEXT,
  phone TEXT,
  birthdate TEXT,
  gender TEXT,
  address_line1 TEXT,
  address_line2 TEXT,
  city TEXT,
  region TEXT,
  postal_code TEXT,
  country TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_people_church ON people(church_id);
CREATE INDEX IF NOT EXISTS idx_people_email ON people(email);

CREATE TABLE IF NOT EXISTS households (
  id TEXT PRIMARY KEY,
  church_id TEXT NOT NULL,
  name TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS household_members (
  household_id TEXT NOT NULL,
  person_id TEXT NOT NULL,
  role TEXT,
  PRIMARY KEY (household_id, person_id),
  FOREIGN KEY (household_id) REFERENCES households(id) ON DELETE CASCADE,
  FOREIGN KEY (person_id) REFERENCES people(id) ON DELETE CASCADE
);

-- Roles bound to a client userId (session.userId)
CREATE TABLE IF NOT EXISTS roles (
  id TEXT PRIMARY KEY,
  church_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_roles_user ON roles(church_id, user_id);

CREATE TABLE IF NOT EXISTS memberships (
  id TEXT PRIMARY KEY,
  church_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  status TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_memberships_user ON memberships(church_id, user_id);

-- Public-facing discoverables
CREATE TABLE IF NOT EXISTS services (
  id TEXT PRIMARY KEY,
  church_id TEXT NOT NULL,
  campus_id TEXT,
  name TEXT NOT NULL,
  day_of_week INTEGER NOT NULL, -- 0=Sun..6=Sat
  start_time_local TEXT NOT NULL, -- HH:MM
  duration_minutes INTEGER NOT NULL DEFAULT 75,
  timezone TEXT NOT NULL DEFAULT 'UTC',
  location_name TEXT,
  location_address TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_services_church ON services(church_id, campus_id);

-- Planning Center Services-like: service plans (run-of-show)
CREATE TABLE IF NOT EXISTS service_plans (
  id TEXT PRIMARY KEY,
  church_id TEXT NOT NULL,
  campus_id TEXT,
  service_id TEXT,
  title TEXT NOT NULL,
  starts_at TEXT NOT NULL, -- ISO
  ends_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (service_id) REFERENCES services(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_service_plans ON service_plans(church_id, campus_id, starts_at);

CREATE TABLE IF NOT EXISTS service_plan_items (
  id TEXT PRIMARY KEY,
  church_id TEXT NOT NULL,
  plan_id TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  item_type TEXT NOT NULL, -- song|welcome|announcement|sermon|prayer|other
  title TEXT NOT NULL,
  notes TEXT,
  duration_minutes INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (plan_id) REFERENCES service_plans(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_service_plan_items ON service_plan_items(church_id, plan_id, sort_order);

CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  church_id TEXT NOT NULL,
  campus_id TEXT,
  title TEXT NOT NULL,
  description TEXT,
  start_at TEXT NOT NULL, -- ISO
  end_at TEXT,
  location_name TEXT,
  location_address TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_church ON events(church_id, campus_id, start_at);

-- Outreach / registrations (Calendars + Registrations-ish)
CREATE TABLE IF NOT EXISTS outreach_campaigns (
  id TEXT PRIMARY KEY,
  church_id TEXT NOT NULL,
  campus_id TEXT,
  title TEXT NOT NULL,
  description TEXT,
  start_at TEXT,
  end_at TEXT,
  status TEXT NOT NULL DEFAULT 'active', -- active|paused|completed
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_outreach_church ON outreach_campaigns(church_id, campus_id, status);

CREATE TABLE IF NOT EXISTS registrations (
  id TEXT PRIMARY KEY,
  church_id TEXT NOT NULL,
  event_id TEXT,
  user_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'registered', -- registered|cancelled|attended
  payload_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_registrations ON registrations(church_id, event_id, status, created_at);

CREATE TABLE IF NOT EXISTS groups (
  id TEXT PRIMARY KEY,
  church_id TEXT NOT NULL,
  campus_id TEXT,
  name TEXT NOT NULL,
  description TEXT,
  leader_person_id TEXT,
  meeting_details TEXT,
  is_open INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (leader_person_id) REFERENCES people(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_groups_church ON groups(church_id, campus_id);

CREATE TABLE IF NOT EXISTS group_memberships (
  church_id TEXT NOT NULL,
  group_id TEXT NOT NULL,
  person_id TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member', -- member|leader|host
  status TEXT NOT NULL DEFAULT 'active', -- active|inactive|pending
  joined_at TEXT,
  PRIMARY KEY (group_id, person_id),
  FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE,
  FOREIGN KEY (person_id) REFERENCES people(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_group_memberships ON group_memberships(church_id, group_id, status);

CREATE TABLE IF NOT EXISTS opportunities (
  id TEXT PRIMARY KEY,
  church_id TEXT NOT NULL,
  campus_id TEXT,
  title TEXT NOT NULL,
  description TEXT,
  contact_email TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_opps_church ON opportunities(church_id, campus_id);

-- Resources / publishing-ish (internal docs, policies, next steps)
CREATE TABLE IF NOT EXISTS resources (
  id TEXT PRIMARY KEY,
  church_id TEXT NOT NULL,
  campus_id TEXT,
  title TEXT NOT NULL,
  body_markdown TEXT NOT NULL,
  visibility TEXT NOT NULL DEFAULT 'public', -- public|members|leaders
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_resources ON resources(church_id, campus_id, visibility);

-- Forms (intake) + submissions (connect/serve/prayer/care can also be forms)
CREATE TABLE IF NOT EXISTS forms (
  id TEXT PRIMARY KEY,
  church_id TEXT NOT NULL,
  slug TEXT NOT NULL,
  title TEXT NOT NULL,
  schema_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (church_id, slug)
);

CREATE TABLE IF NOT EXISTS form_submissions (
  id TEXT PRIMARY KEY,
  church_id TEXT NOT NULL,
  form_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (form_id) REFERENCES forms(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_form_submissions ON form_submissions(church_id, form_id, created_at);

-- Requests (prayer/contact/visit/serve_interest/pastoral_care)
CREATE TABLE IF NOT EXISTS requests (
  id TEXT PRIMARY KEY,
  church_id TEXT NOT NULL,
  campus_id TEXT,
  user_id TEXT NOT NULL,
  type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open', -- open|assigned|escalated|closed
  payload_json TEXT NOT NULL,
  assigned_to_user_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_requests_queue ON requests(church_id, status, type, created_at);

-- Guide assignments + journey
CREATE TABLE IF NOT EXISTS assignments (
  id TEXT PRIMARY KEY,
  church_id TEXT NOT NULL,
  seeker_id TEXT NOT NULL, -- people.id
  guide_user_id TEXT NOT NULL, -- session.userId
  assigned_at TEXT NOT NULL,
  UNIQUE (church_id, seeker_id, guide_user_id),
  FOREIGN KEY (seeker_id) REFERENCES people(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_assignments_guide ON assignments(church_id, guide_user_id);

CREATE TABLE IF NOT EXISTS journey_state (
  id TEXT PRIMARY KEY,
  church_id TEXT NOT NULL,
  seeker_id TEXT NOT NULL,
  state_json TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (church_id, seeker_id),
  FOREIGN KEY (seeker_id) REFERENCES people(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS journey_notes (
  id TEXT PRIMARY KEY,
  church_id TEXT NOT NULL,
  seeker_id TEXT NOT NULL,
  author_user_id TEXT NOT NULL,
  note TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (seeker_id) REFERENCES people(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_journey_notes ON journey_notes(church_id, seeker_id, created_at);

CREATE TABLE IF NOT EXISTS followups (
  id TEXT PRIMARY KEY,
  church_id TEXT NOT NULL,
  seeker_id TEXT NOT NULL,
  assigned_to_user_id TEXT NOT NULL,
  title TEXT NOT NULL,
  due_at TEXT,
  status TEXT NOT NULL DEFAULT 'open', -- open|done|cancelled
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (seeker_id) REFERENCES people(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_followups_due ON followups(church_id, assigned_to_user_id, status, due_at);

CREATE TABLE IF NOT EXISTS audit_log (
  id TEXT PRIMARY KEY,
  church_id TEXT NOT NULL,
  actor_user_id TEXT,
  action TEXT NOT NULL,
  entity_type TEXT,
  entity_id TEXT,
  payload_json TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_church ON audit_log(church_id, created_at);

-- Knowledge base chunks (persisted embeddings; built by hosted agent)
CREATE TABLE IF NOT EXISTS kb_chunks (
  id TEXT PRIMARY KEY, -- chunkId
  church_id TEXT NOT NULL,
  source_id TEXT NOT NULL,
  text TEXT NOT NULL,
  embedding_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_kb_chunks_church ON kb_chunks(church_id, source_id);

-- Rich content docs stored in D1 (replaces local markdown files for KB)
CREATE TABLE IF NOT EXISTS content_docs (
  id TEXT PRIMARY KEY, -- docId
  church_id TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  locale TEXT NOT NULL DEFAULT 'en',
  title TEXT,
  body_markdown TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_content_docs ON content_docs(church_id, entity_type, entity_id, locale);

