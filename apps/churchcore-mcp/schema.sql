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

-- Household profile (household-level notes/preferences that are not per-person)
CREATE TABLE IF NOT EXISTS household_profiles (
  household_id TEXT PRIMARY KEY,
  church_id TEXT NOT NULL,
  allergy_notes TEXT, -- household-level notes (in addition to per-child allergies)
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (household_id) REFERENCES households(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_household_profiles ON household_profiles(church_id, household_id);

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
  metadata_json TEXT, -- template_id, tool_ids, etc.
  status TEXT NOT NULL DEFAULT 'active', -- active|archived
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_chat_threads ON chat_threads(church_id, user_id, status, updated_at);

-- Thread templates (for "New topic" chooser)
CREATE TABLE IF NOT EXISTS topic_templates (
  id TEXT PRIMARY KEY,
  church_id TEXT NOT NULL,
  slug TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  tool_ids_json TEXT NOT NULL, -- JSON array of tool ids for quick actions
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (church_id, slug)
);
CREATE INDEX IF NOT EXISTS idx_topic_templates ON topic_templates(church_id, is_active, sort_order, updated_at);

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

-- Map chat thread ids (TEXT) -> LangGraph thread ids (UUID required by /threads/<id>/runs/stream)
CREATE TABLE IF NOT EXISTS chat_thread_langgraph_map (
  church_id TEXT NOT NULL,
  thread_id TEXT NOT NULL,
  langgraph_thread_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (church_id, thread_id),
  FOREIGN KEY (thread_id) REFERENCES chat_threads(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_chat_thread_langgraph_map ON chat_thread_langgraph_map(church_id, langgraph_thread_id);

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
  is_outdoor INTEGER NOT NULL DEFAULT 0,
  lat REAL,
  lon REAL,
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

-- Community catalog + per-person participation
-- This is broader than groups/opportunities/events and is meant to unify:
-- - groups/classes/ministry programs
-- - local outreach partners/opportunities
-- - global outreach + missions trips
CREATE TABLE IF NOT EXISTS community_catalog (
  id TEXT PRIMARY KEY,
  church_id TEXT NOT NULL,
  campus_id TEXT,
  kind TEXT NOT NULL, -- lifegroup|class|ministry|outreach_local|outreach_global|trip|serving_team|bible_study|other
  title TEXT NOT NULL,
  description TEXT,
  source_url TEXT,
  signup_url TEXT,
  start_at TEXT,
  end_at TEXT,
  tags_json TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_community_catalog ON community_catalog(church_id, campus_id, kind, is_active);

CREATE TABLE IF NOT EXISTS person_community (
  church_id TEXT NOT NULL,
  person_id TEXT NOT NULL,
  community_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active', -- pending|active|inactive|attended|completed
  role TEXT NOT NULL DEFAULT 'participant', -- participant|leader
  joined_at TEXT,
  left_at TEXT,
  notes_json TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (church_id, person_id, community_id),
  FOREIGN KEY (person_id) REFERENCES people(id) ON DELETE CASCADE,
  FOREIGN KEY (community_id) REFERENCES community_catalog(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_person_community ON person_community(church_id, person_id, status, updated_at);

-- Weekly Podcast (The Weekly) – episodes + cached analysis (summary/topics/verses)
CREATE TABLE IF NOT EXISTS weekly_podcasts (
  id TEXT PRIMARY KEY,
  church_id TEXT NOT NULL,
  episode_number INTEGER,
  title TEXT NOT NULL,
  speaker TEXT,
  published_at TEXT, -- ISO date/time
  passage TEXT, -- e.g. John 6:1-21
  source_url TEXT, -- canonical page/permalink
  watch_url TEXT,
  listen_url TEXT,
  image_url TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_weekly_podcasts ON weekly_podcasts(church_id, published_at, is_active);

CREATE TABLE IF NOT EXISTS weekly_podcast_analysis (
  podcast_id TEXT PRIMARY KEY,
  church_id TEXT NOT NULL,
  summary_markdown TEXT,
  topics_json TEXT, -- JSON array of strings/topics
  verses_json TEXT, -- JSON array of scripture references (strings)
  model TEXT,
  source TEXT, -- e.g. youtube_captions|manual|unknown
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (podcast_id) REFERENCES weekly_podcasts(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_weekly_podcast_analysis ON weekly_podcast_analysis(church_id, updated_at);

-- Campus messages (sermons) + weekly guides (discussion PDFs).
CREATE TABLE IF NOT EXISTS weekly_guides (
  id TEXT PRIMARY KEY,
  church_id TEXT NOT NULL,
  series_slug TEXT NOT NULL, -- e.g. john
  week_number INTEGER,
  passage TEXT,
  passage_key TEXT,
  discussion_url TEXT,
  leader_url TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (church_id, series_slug, week_number)
);
CREATE INDEX IF NOT EXISTS idx_weekly_guides ON weekly_guides(church_id, series_slug, week_number);
CREATE INDEX IF NOT EXISTS idx_weekly_guides_passage ON weekly_guides(church_id, passage_key);

CREATE TABLE IF NOT EXISTS campus_messages (
  id TEXT PRIMARY KEY, -- e.g. msg_2479
  church_id TEXT NOT NULL,
  campus_id TEXT,
  title TEXT NOT NULL,
  speaker TEXT,
  preached_at TEXT, -- ISO date/time
  preached_date TEXT, -- YYYY-MM-DD (derived from preached_at)
  week_start_date TEXT, -- YYYY-MM-DD (Mon after preached_date)
  week_end_date TEXT, -- YYYY-MM-DD (Sun after week_start_date)
  passage TEXT,
  passage_key TEXT,
  series_title TEXT,
  series_id TEXT, -- enmse_sid
  campus_feed_id TEXT, -- enmse_tid
  source_url TEXT NOT NULL,
  watch_url TEXT,
  listen_url TEXT,
  download_url TEXT,
  guide_series_slug TEXT,
  guide_week_number INTEGER,
  guide_discussion_url TEXT,
  guide_leader_url TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_campus_messages ON campus_messages(church_id, campus_id, preached_at);
CREATE INDEX IF NOT EXISTS idx_campus_messages_series ON campus_messages(church_id, series_title, preached_at);
CREATE INDEX IF NOT EXISTS idx_campus_messages_week ON campus_messages(church_id, campus_id, week_start_date, preached_date);

CREATE TABLE IF NOT EXISTS campus_message_analysis (
  message_id TEXT PRIMARY KEY,
  church_id TEXT NOT NULL,
  summary_markdown TEXT,
  topics_json TEXT,
  verses_json TEXT,
  key_points_json TEXT,
  model TEXT,
  source TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (message_id) REFERENCES campus_messages(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_campus_message_analysis ON campus_message_analysis(church_id, updated_at);

CREATE TABLE IF NOT EXISTS campus_message_transcripts (
  message_id TEXT PRIMARY KEY,
  church_id TEXT NOT NULL,
  transcript_text TEXT NOT NULL,
  source_url TEXT,
  model TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (message_id) REFERENCES campus_messages(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_campus_message_transcripts ON campus_message_transcripts(church_id, updated_at);

-- Sermon-anchored Bible reading plan (week + daily items) + guide check-ins.
CREATE TABLE IF NOT EXISTS bible_reading_weeks (
  id TEXT PRIMARY KEY,
  church_id TEXT NOT NULL,
  campus_id TEXT NOT NULL,
  anchor_message_id TEXT NOT NULL,
  preached_date TEXT NOT NULL,   -- YYYY-MM-DD
  week_start_date TEXT NOT NULL, -- YYYY-MM-DD
  week_end_date TEXT NOT NULL,   -- YYYY-MM-DD
  title TEXT,
  passage TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (church_id, campus_id, week_start_date),
  FOREIGN KEY (anchor_message_id) REFERENCES campus_messages(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_bible_reading_weeks ON bible_reading_weeks(church_id, campus_id, week_start_date);
CREATE INDEX IF NOT EXISTS idx_bible_reading_weeks_anchor ON bible_reading_weeks(church_id, anchor_message_id);

CREATE TABLE IF NOT EXISTS bible_reading_items (
  id TEXT PRIMARY KEY,
  church_id TEXT NOT NULL,
  week_id TEXT NOT NULL,
  day_date TEXT NOT NULL, -- YYYY-MM-DD
  kind TEXT NOT NULL, -- reading|daily_verse|reflection
  ref TEXT, -- scripture reference string
  label TEXT,
  notes_markdown TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (church_id, week_id, day_date, kind, ref),
  FOREIGN KEY (week_id) REFERENCES bible_reading_weeks(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_bible_reading_items_week ON bible_reading_items(church_id, week_id, day_date);
CREATE INDEX IF NOT EXISTS idx_bible_reading_items_ref ON bible_reading_items(church_id, ref);

CREATE TABLE IF NOT EXISTS bible_reading_progress (
  church_id TEXT NOT NULL,
  person_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  status TEXT NOT NULL, -- started|completed
  completed_at TEXT,
  notes_markdown TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (church_id, person_id, item_id),
  FOREIGN KEY (person_id) REFERENCES people(id) ON DELETE CASCADE,
  FOREIGN KEY (item_id) REFERENCES bible_reading_items(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_bible_reading_progress_person ON bible_reading_progress(church_id, person_id, updated_at);

CREATE TABLE IF NOT EXISTS bible_reading_checkins (
  id TEXT PRIMARY KEY,
  church_id TEXT NOT NULL,
  week_id TEXT NOT NULL,
  person_id TEXT NOT NULL,
  guide_user_id TEXT NOT NULL,
  day_date TEXT, -- YYYY-MM-DD, nullable for week-level
  message TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (week_id) REFERENCES bible_reading_weeks(id) ON DELETE CASCADE,
  FOREIGN KEY (person_id) REFERENCES people(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_bible_reading_checkins_week ON bible_reading_checkins(church_id, person_id, week_id, day_date, created_at);

CREATE TABLE IF NOT EXISTS transcription_jobs (
  id TEXT PRIMARY KEY,
  church_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  provider TEXT NOT NULL, -- assemblyai|openai|other
  audio_url TEXT NOT NULL,
  provider_job_id TEXT,
  status TEXT NOT NULL DEFAULT 'queued', -- queued|processing|completed|failed
  error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_transcription_jobs ON transcription_jobs(church_id, status, updated_at);
CREATE INDEX IF NOT EXISTS idx_transcription_jobs_message ON transcription_jobs(church_id, message_id, provider);

-- Website crawl metadata (change detection for scheduled scraping)
CREATE TABLE IF NOT EXISTS web_crawl_pages (
  url TEXT PRIMARY KEY,
  church_id TEXT NOT NULL,
  etag TEXT,
  last_modified TEXT,
  content_hash TEXT,
  title TEXT,
  status_code INTEGER,
  last_fetched_at TEXT,
  last_changed_at TEXT,
  error TEXT,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_web_crawl_pages ON web_crawl_pages(church_id, updated_at);

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

-- Group collaboration: invites, schedule, and Bible study (separate from broad community_catalog)
CREATE TABLE IF NOT EXISTS group_invites (
  id TEXT PRIMARY KEY,
  church_id TEXT NOT NULL,
  group_id TEXT NOT NULL,
  invited_by_person_id TEXT NOT NULL,
  invitee_person_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', -- pending|accepted|declined|cancelled
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (church_id, group_id, invitee_person_id),
  FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE,
  FOREIGN KEY (invited_by_person_id) REFERENCES people(id) ON DELETE CASCADE,
  FOREIGN KEY (invitee_person_id) REFERENCES people(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_group_invites_lookup ON group_invites(church_id, group_id, status, updated_at);
CREATE INDEX IF NOT EXISTS idx_group_invites_invitee ON group_invites(church_id, invitee_person_id, status, updated_at);

CREATE TABLE IF NOT EXISTS group_events (
  id TEXT PRIMARY KEY,
  church_id TEXT NOT NULL,
  group_id TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  location TEXT,
  start_at TEXT NOT NULL,
  end_at TEXT,
  created_by_person_id TEXT,
  visibility TEXT NOT NULL DEFAULT 'members', -- members|leaders
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by_person_id) REFERENCES people(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_group_events ON group_events(church_id, group_id, start_at);

CREATE TABLE IF NOT EXISTS group_bible_studies (
  id TEXT PRIMARY KEY,
  church_id TEXT NOT NULL,
  group_id TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'active', -- active|archived
  created_by_person_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by_person_id) REFERENCES people(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_group_bible_studies ON group_bible_studies(church_id, group_id, status, updated_at);

CREATE TABLE IF NOT EXISTS group_bible_study_sessions (
  id TEXT PRIMARY KEY,
  church_id TEXT NOT NULL,
  bible_study_id TEXT NOT NULL,
  session_at TEXT NOT NULL,
  title TEXT,
  agenda TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (bible_study_id) REFERENCES group_bible_studies(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_group_bible_study_sessions ON group_bible_study_sessions(church_id, bible_study_id, session_at);

CREATE TABLE IF NOT EXISTS group_bible_study_readings (
  id TEXT PRIMARY KEY,
  church_id TEXT NOT NULL,
  bible_study_id TEXT NOT NULL,
  ref TEXT NOT NULL, -- scripture reference only
  order_index INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (bible_study_id) REFERENCES group_bible_studies(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_group_bible_study_readings ON group_bible_study_readings(church_id, bible_study_id, order_index);

CREATE TABLE IF NOT EXISTS group_bible_study_notes (
  id TEXT PRIMARY KEY,
  church_id TEXT NOT NULL,
  bible_study_id TEXT NOT NULL,
  author_person_id TEXT,
  content_markdown TEXT NOT NULL,
  visibility TEXT NOT NULL DEFAULT 'members', -- members|leaders
  created_at TEXT NOT NULL,
  FOREIGN KEY (bible_study_id) REFERENCES group_bible_studies(id) ON DELETE CASCADE,
  FOREIGN KEY (author_person_id) REFERENCES people(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_group_bible_study_notes ON group_bible_study_notes(church_id, bible_study_id, created_at);

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

