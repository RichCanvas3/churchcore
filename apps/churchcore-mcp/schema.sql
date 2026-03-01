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

-- Branding / overview (kept separate for non-breaking schema evolution)
CREATE TABLE IF NOT EXISTS church_branding (
  church_id TEXT PRIMARY KEY,
  logo_url TEXT,
  overview_markdown TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (church_id) REFERENCES churches(id) ON DELETE CASCADE
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

-- Strategic intent (purpose/vision/mission/values/etc.) – ChurchCore ontology-aligned
CREATE TABLE IF NOT EXISTS strategic_intents (
  id TEXT PRIMARY KEY,
  church_id TEXT NOT NULL,
  intent_type TEXT NOT NULL, -- purpose|vision|mission|strategy|aim|goal|objective|value|belief
  title TEXT NOT NULL,
  body_markdown TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  source_url TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (church_id) REFERENCES churches(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_strategic_intents ON strategic_intents(church_id, intent_type, sort_order);

CREATE TABLE IF NOT EXISTS strategic_intent_links (
  church_id TEXT NOT NULL,
  from_intent_id TEXT NOT NULL,
  to_intent_id TEXT NOT NULL,
  link_type TEXT NOT NULL, -- supports|drives|implements|measures
  weight REAL DEFAULT 1.0,
  metadata_json TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (church_id, from_intent_id, to_intent_id, link_type),
  FOREIGN KEY (from_intent_id) REFERENCES strategic_intents(id) ON DELETE CASCADE,
  FOREIGN KEY (to_intent_id) REFERENCES strategic_intents(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_strategic_intent_links ON strategic_intent_links(church_id, from_intent_id, link_type);

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

-- Household contact points (fast lookup by phone/email)
CREATE TABLE IF NOT EXISTS household_contacts (
  id TEXT PRIMARY KEY,
  church_id TEXT NOT NULL,
  household_id TEXT NOT NULL,
  contact_type TEXT NOT NULL, -- phone|email
  contact_value TEXT NOT NULL, -- normalized (e.g. +1555..., lowercased email)
  is_primary INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (household_id) REFERENCES households(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_household_contacts_lookup ON household_contacts(church_id, contact_type, contact_value);
CREATE INDEX IF NOT EXISTS idx_household_contacts_household ON household_contacts(church_id, household_id, is_primary);

CREATE TABLE IF NOT EXISTS household_members (
  household_id TEXT NOT NULL,
  person_id TEXT NOT NULL,
  role TEXT,
  PRIMARY KEY (household_id, person_id),
  FOREIGN KEY (household_id) REFERENCES households(id) ON DELETE CASCADE,
  FOREIGN KEY (person_id) REFERENCES people(id) ON DELETE CASCADE
);

-- Person relationships (guardian, spouse, emergency contact, etc.)
CREATE TABLE IF NOT EXISTS person_relationships (
  id TEXT PRIMARY KEY,
  church_id TEXT NOT NULL,
  from_person_id TEXT NOT NULL,
  to_person_id TEXT NOT NULL,
  relationship_type TEXT NOT NULL, -- guardian|spouse|emergency_contact|authorized_pickup
  status TEXT NOT NULL DEFAULT 'active', -- active|inactive
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (from_person_id) REFERENCES people(id) ON DELETE CASCADE,
  FOREIGN KEY (to_person_id) REFERENCES people(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_person_relationships_from ON person_relationships(church_id, from_person_id, relationship_type, status);
CREATE INDEX IF NOT EXISTS idx_person_relationships_to ON person_relationships(church_id, to_person_id, relationship_type, status);

-- Child profile (kids ministry) – check-in relevant data
CREATE TABLE IF NOT EXISTS child_profiles (
  person_id TEXT PRIMARY KEY,
  church_id TEXT NOT NULL,
  grade TEXT, -- e.g. K, 1, 2, ...
  allergies TEXT, -- short freeform or comma-separated; later normalize
  medical_notes TEXT,
  special_needs INTEGER NOT NULL DEFAULT 0,
  custody_notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (person_id) REFERENCES people(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_child_profiles_church ON child_profiles(church_id, person_id);

-- Check-in configuration
CREATE TABLE IF NOT EXISTS checkin_areas (
  id TEXT PRIMARY KEY,
  church_id TEXT NOT NULL,
  campus_id TEXT,
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'kids', -- kids|general
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_checkin_areas ON checkin_areas(church_id, campus_id);

CREATE TABLE IF NOT EXISTS checkin_rooms (
  id TEXT PRIMARY KEY,
  church_id TEXT NOT NULL,
  campus_id TEXT,
  area_id TEXT NOT NULL,
  name TEXT NOT NULL,
  min_age_months INTEGER, -- inclusive
  max_age_months INTEGER, -- inclusive
  min_grade TEXT,
  max_grade TEXT,
  capacity INTEGER,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (area_id) REFERENCES checkin_areas(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_checkin_rooms_area ON checkin_rooms(church_id, area_id);

-- Which check-in areas are open for a given service plan/time
CREATE TABLE IF NOT EXISTS checkin_schedules (
  id TEXT PRIMARY KEY,
  church_id TEXT NOT NULL,
  campus_id TEXT,
  service_plan_id TEXT, -- ties to a specific service time instance
  area_id TEXT NOT NULL,
  opens_at TEXT NOT NULL, -- ISO
  closes_at TEXT NOT NULL, -- ISO
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (service_plan_id) REFERENCES service_plans(id) ON DELETE SET NULL,
  FOREIGN KEY (area_id) REFERENCES checkin_areas(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_checkin_schedules ON checkin_schedules(church_id, campus_id, opens_at, closes_at);

-- OTP verification (demo-safe; real SMS provider later)
CREATE TABLE IF NOT EXISTS phone_verifications (
  id TEXT PRIMARY KEY,
  church_id TEXT NOT NULL,
  phone TEXT NOT NULL, -- normalized
  otp_code TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', -- pending|verified|expired
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_phone_verifications_lookup ON phone_verifications(church_id, phone, status, expires_at);

-- Check-in transactions
CREATE TABLE IF NOT EXISTS checkins (
  id TEXT PRIMARY KEY,
  church_id TEXT NOT NULL,
  campus_id TEXT,
  service_plan_id TEXT,
  area_id TEXT NOT NULL,
  household_id TEXT,
  created_by_user_id TEXT, -- assistant station user id or app user id
  created_by_role TEXT, -- seeker|guide
  mode TEXT NOT NULL DEFAULT 'self', -- self|assisted
  security_code TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open', -- open|complete|cancelled
  created_at TEXT NOT NULL,
  completed_at TEXT,
  FOREIGN KEY (service_plan_id) REFERENCES service_plans(id) ON DELETE SET NULL,
  FOREIGN KEY (area_id) REFERENCES checkin_areas(id) ON DELETE CASCADE,
  FOREIGN KEY (household_id) REFERENCES households(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_checkins_by_household ON checkins(church_id, household_id, created_at);
CREATE INDEX IF NOT EXISTS idx_checkins_by_service ON checkins(church_id, service_plan_id, created_at);

CREATE TABLE IF NOT EXISTS checkin_items (
  id TEXT PRIMARY KEY,
  church_id TEXT NOT NULL,
  checkin_id TEXT NOT NULL,
  person_id TEXT NOT NULL,
  room_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'checked_in', -- checked_in|checked_out
  checked_in_at TEXT NOT NULL,
  checked_out_at TEXT,
  FOREIGN KEY (checkin_id) REFERENCES checkins(id) ON DELETE CASCADE,
  FOREIGN KEY (person_id) REFERENCES people(id) ON DELETE CASCADE,
  FOREIGN KEY (room_id) REFERENCES checkin_rooms(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_checkin_items_checkin ON checkin_items(church_id, checkin_id);
CREATE INDEX IF NOT EXISTS idx_checkin_items_person ON checkin_items(church_id, person_id, status, checked_in_at);

-- Mobile pass / QR token (rotatable)
CREATE TABLE IF NOT EXISTS checkin_pass_tokens (
  id TEXT PRIMARY KEY,
  church_id TEXT NOT NULL,
  household_id TEXT NOT NULL,
  token TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active', -- active|revoked|expired
  expires_at TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (household_id) REFERENCES households(id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_checkin_pass_token_unique ON checkin_pass_tokens(church_id, token);
CREATE INDEX IF NOT EXISTS idx_checkin_pass_household ON checkin_pass_tokens(church_id, household_id, status);

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

-- Map app user identity -> person record (Planning Center People-ish)
CREATE TABLE IF NOT EXISTS user_person_bindings (
  church_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  person_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (church_id, user_id),
  FOREIGN KEY (person_id) REFERENCES people(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_user_person ON user_person_bindings(church_id, person_id);

-- Chat persistence (topics + messages) stored in D1
CREATE TABLE IF NOT EXISTS chat_threads (
  id TEXT PRIMARY KEY,
  church_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active', -- active|archived
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_chat_threads ON chat_threads(church_id, user_id, status, updated_at);

CREATE TABLE IF NOT EXISTS chat_messages (
  id TEXT PRIMARY KEY,
  church_id TEXT NOT NULL,
  thread_id TEXT NOT NULL,
  sender_type TEXT NOT NULL, -- user|assistant|system
  content TEXT NOT NULL,
  envelope_json TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (thread_id) REFERENCES chat_threads(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_chat_messages ON chat_messages(church_id, thread_id, created_at);

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

-- Person-level memory (canonical, shared across threads)
-- Stores a durable profile/journey/intent snapshot for (church_id, person_id).
CREATE TABLE IF NOT EXISTS person_memory (
  church_id TEXT NOT NULL,
  person_id TEXT NOT NULL,
  memory_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (church_id, person_id),
  FOREIGN KEY (person_id) REFERENCES people(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_person_memory ON person_memory(church_id, person_id, updated_at);

-- Audit trail for proposed/applied memory ops (for safety + debugging)
CREATE TABLE IF NOT EXISTS person_memory_audit (
  id TEXT PRIMARY KEY,
  church_id TEXT NOT NULL,
  person_id TEXT NOT NULL,
  thread_id TEXT,
  turn_id TEXT,
  actor_user_id TEXT,
  actor_role TEXT,
  ops_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (person_id) REFERENCES people(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_person_memory_audit ON person_memory_audit(church_id, person_id, created_at);

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

-- Evangelical faith journey graph (canonical) + per-person journey instance
CREATE TABLE IF NOT EXISTS journey_node (
  node_id TEXT PRIMARY KEY,
  church_id TEXT NOT NULL,
  node_type TEXT NOT NULL, -- Stage|Milestone|Practice|DoctrineTopic|Barrier|Resource|Community|Assessment|ActionStep
  title TEXT NOT NULL,
  summary TEXT,
  metadata_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_journey_node_church_type ON journey_node(church_id, node_type);

CREATE TABLE IF NOT EXISTS journey_edge (
  edge_id TEXT PRIMARY KEY,
  church_id TEXT NOT NULL,
  from_node_id TEXT NOT NULL,
  to_node_id TEXT NOT NULL,
  edge_type TEXT NOT NULL, -- NEXT_STAGE|REQUIRES|RECOMMENDS|UNLOCKS|BLOCKED_BY|RESOLVED_BY|SUPPORTED_BY|MEASURED_BY
  weight REAL DEFAULT 1.0,
  metadata_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(from_node_id) REFERENCES journey_node(node_id),
  FOREIGN KEY(to_node_id) REFERENCES journey_node(node_id)
);
CREATE INDEX IF NOT EXISTS idx_journey_edge_church_from ON journey_edge(church_id, from_node_id);
CREATE INDEX IF NOT EXISTS idx_journey_edge_church_type ON journey_edge(church_id, edge_type);

CREATE TABLE IF NOT EXISTS person_journey_state (
  church_id TEXT NOT NULL,
  person_id TEXT NOT NULL,
  current_stage_id TEXT,
  confidence REAL DEFAULT 0.5,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(church_id, person_id),
  FOREIGN KEY (person_id) REFERENCES people(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_person_journey_state ON person_journey_state(church_id, person_id, updated_at);

CREATE TABLE IF NOT EXISTS person_journey_event (
  event_id TEXT PRIMARY KEY,
  church_id TEXT NOT NULL,
  person_id TEXT NOT NULL,
  node_id TEXT NOT NULL,          -- milestone/practice/topic etc.
  event_type TEXT NOT NULL,       -- COMPLETED|STARTED|STREAK|NOTE|ASSESSMENT
  value_json TEXT,                -- flexible payload
  source TEXT,                    -- user|staff|system|agent
  access_level TEXT DEFAULT 'self', -- self|staff|pastoral|restricted
  created_at TEXT NOT NULL,
  FOREIGN KEY (person_id) REFERENCES people(id) ON DELETE CASCADE,
  FOREIGN KEY(node_id) REFERENCES journey_node(node_id)
);
CREATE INDEX IF NOT EXISTS idx_person_journey_event_person ON person_journey_event(church_id, person_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_person_journey_event_node ON person_journey_event(church_id, node_id, created_at DESC);

-- Link canonical journey nodes to KB content_docs (for retrieval)
CREATE TABLE IF NOT EXISTS journey_resource_link (
  link_id TEXT PRIMARY KEY,
  church_id TEXT NOT NULL,
  node_id TEXT NOT NULL,
  resource_id TEXT NOT NULL, -- content_docs.id
  relevance REAL DEFAULT 1.0,
  created_at TEXT NOT NULL,
  FOREIGN KEY(node_id) REFERENCES journey_node(node_id)
);
CREATE INDEX IF NOT EXISTS idx_journey_resource_link_node ON journey_resource_link(church_id, node_id);

-- Link journey nodes to ChurchCore entities (groups/events/opportunities/resources/content_docs/etc.)
CREATE TABLE IF NOT EXISTS journey_entity_link (
  link_id TEXT PRIMARY KEY,
  church_id TEXT NOT NULL,
  node_id TEXT NOT NULL,
  entity_type TEXT NOT NULL, -- group|event|opportunity|resource|content_doc|person|class|custom
  entity_id TEXT NOT NULL,
  relevance REAL DEFAULT 1.0,
  metadata_json TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY(node_id) REFERENCES journey_node(node_id)
);
CREATE INDEX IF NOT EXISTS idx_journey_entity_link_node ON journey_entity_link(church_id, node_id, entity_type);

