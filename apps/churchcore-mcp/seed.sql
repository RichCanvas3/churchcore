PRAGMA foreign_keys = ON;

-- Seed for Calvary Bible Church (calvarybible)

-- Church / campus / locations
INSERT OR REPLACE INTO churches (
  id, name, legal_name, timezone, website,
  address_line1, city, region, postal_code, country,
  created_at, updated_at
) VALUES
('calvarybible','Calvary Bible Church','Calvary Bible Church','America/Denver','https://calvarybible.com/','3245 Kalmia Ave.','Boulder','CO','80301','US',datetime('now'),datetime('now'));

INSERT OR REPLACE INTO church_branding (church_id, logo_url, overview_markdown, created_at, updated_at) VALUES
(
  'calvarybible',
  'https://calvarybible.com/wp-content/uploads/2020/07/calvarylogonew-dt.png',
  'Calvary Bible Church is one church in multiple communities (Boulder, Erie, Thornton).\\n\\n- Locations: https://calvarybible.com/locations/\\n- Watch online: https://calvarybible.com/\\n- Weekly messages: https://calvarybible.com/message-archive/\\n- Connect card: https://calvarybiblechurch.churchcenter.com/people/forms/292721',
  datetime('now'),
  datetime('now')
);

INSERT OR REPLACE INTO campuses (
  id, church_id, name, timezone,
  address_line1, city, region, postal_code, country,
  created_at, updated_at
) VALUES
('campus_boulder','calvarybible','Boulder Campus','America/Denver','3245 Kalmia Ave.','Boulder','CO','80301','US',datetime('now'),datetime('now')),
('campus_erie','calvarybible','Erie Campus','America/Denver','615 Evans St.','Erie','CO','80516','US',datetime('now'),datetime('now')),
('campus_thornton','calvarybible','Thornton Campus','America/Denver','11989 St Paul St.','Thornton','CO','80233','US',datetime('now'),datetime('now'));

INSERT OR REPLACE INTO locations (
  id, church_id, campus_id, name, address_line1, city, region, postal_code, country, notes,
  created_at, updated_at
) VALUES
('loc_boulder_worship','calvarybible','campus_boulder','Boulder Worship Space','3245 Kalmia Ave.','Boulder','CO','80301','US','Sunday gatherings + kids ministry',datetime('now'),datetime('now')),
('loc_erie_worship','calvarybible','campus_erie','Erie Worship Space','615 Evans St.','Erie','CO','80516','US','Sunday gatherings + kids ministry',datetime('now'),datetime('now')),
('loc_thornton_worship','calvarybible','campus_thornton','Thornton Worship Space','11989 St Paul St.','Thornton','CO','80233','US','Sunday gatherings + kids ministry',datetime('now'),datetime('now'));

-- People
INSERT OR REPLACE INTO people (
  id, church_id, campus_id, first_name, last_name, email, phone,
  created_at, updated_at
) VALUES
('p_seeker_1','calvarybible','campus_boulder','Ava','Seeker','ava.seeker@example.com','+15550000001',datetime('now'),datetime('now')),
('p_seeker_2','calvarybible','campus_boulder','Noah','Seeker','noah.seeker@example.com','+15550000002',datetime('now'),datetime('now')),
('p_leader_1','calvarybible','campus_boulder','Grace','Leader','grace.leader@example.com','+15550000003',datetime('now'),datetime('now'));

INSERT OR REPLACE INTO people (
  id, church_id, campus_id, first_name, last_name, birthdate,
  created_at, updated_at
) VALUES
('p_child_1','calvarybible','campus_boulder','Mia','Seeker','2021-06-01',datetime('now'),datetime('now'));

-- Household for Noah + child (kids check-in demo)
INSERT OR REPLACE INTO households (id, church_id, name, created_at, updated_at) VALUES
('hh_noah_1','calvarybible','Seeker Household',datetime('now'),datetime('now'));

INSERT OR REPLACE INTO household_contacts (id, church_id, household_id, contact_type, contact_value, is_primary, created_at, updated_at) VALUES
('hc_noah_phone','calvarybible','hh_noah_1','phone','+15550000002',1,datetime('now'),datetime('now')),
('hc_noah_email','calvarybible','hh_noah_1','email','noah.seeker@example.com',1,datetime('now'),datetime('now')),
('hc_ava_phone','calvarybible','hh_noah_1','phone','+15550000001',0,datetime('now'),datetime('now')),
('hc_ava_email','calvarybible','hh_noah_1','email','ava.seeker@example.com',0,datetime('now'),datetime('now'));

INSERT OR REPLACE INTO household_members (household_id, person_id, role) VALUES
('hh_noah_1','p_seeker_2','adult'),
('hh_noah_1','p_seeker_1','adult'),
('hh_noah_1','p_child_1','child');

INSERT OR REPLACE INTO person_relationships (id, church_id, from_person_id, to_person_id, relationship_type, status, notes, created_at, updated_at) VALUES
('rel_noah_guardian','calvarybible','p_seeker_2','p_child_1','guardian','active',NULL,datetime('now'),datetime('now')),
('rel_noah_pickup','calvarybible','p_seeker_2','p_child_1','authorized_pickup','active',NULL,datetime('now'),datetime('now')),
('rel_ava_guardian','calvarybible','p_seeker_1','p_child_1','guardian','active',NULL,datetime('now'),datetime('now')),
('rel_ava_pickup','calvarybible','p_seeker_1','p_child_1','authorized_pickup','active',NULL,datetime('now'),datetime('now'));

INSERT OR REPLACE INTO child_profiles (person_id, church_id, grade, allergies, medical_notes, special_needs, custody_notes, created_at, updated_at) VALUES
('p_child_1','calvarybible',NULL,'peanuts',NULL,0,NULL,datetime('now'),datetime('now'));

-- Roles for guide demo userId=local-guide
INSERT OR REPLACE INTO roles (id, church_id, user_id, role, created_at) VALUES
('r1','calvarybible','local-guide','guide',datetime('now')),
('r2','calvarybible','local-guide','staff',datetime('now'));

-- Volunteer role for Ava (kids classroom check-in assistant)
INSERT OR REPLACE INTO roles (id, church_id, user_id, role, created_at) VALUES
('r3','calvarybible','demo_user_ava','volunteer',datetime('now'));

INSERT OR REPLACE INTO memberships (id, church_id, user_id, status, updated_at) VALUES
('m1','calvarybible','local-user','guest',datetime('now')),
('m2','calvarybible','local-guide','member',datetime('now'));

-- Default app-user -> person binding (Noah Seeker)
INSERT OR REPLACE INTO user_person_bindings (church_id, user_id, person_id, created_at, updated_at) VALUES
('calvarybible','demo_user_noah','p_seeker_2',datetime('now'),datetime('now'));

-- Default app-user -> person binding (Ava Seeker)
INSERT OR REPLACE INTO user_person_bindings (church_id, user_id, person_id, created_at, updated_at) VALUES
('calvarybible','demo_user_ava','p_seeker_1',datetime('now'),datetime('now'));

-- Seed chat topics for Noah
INSERT OR REPLACE INTO chat_threads (id, church_id, user_id, title, status, created_at, updated_at) VALUES
('thread_noah_general','calvarybible','demo_user_noah','General','active',datetime('now'),datetime('now')),
('thread_noah_visiting','calvarybible','demo_user_noah','Planning a visit','active',datetime('now'),datetime('now'));

INSERT OR REPLACE INTO chat_messages (id, church_id, thread_id, sender_type, content, envelope_json, created_at) VALUES
('msg_noah_1','calvarybible','thread_noah_general','assistant','Hi Noah — how can I help today?',NULL,datetime('now'));

-- Services
INSERT OR REPLACE INTO services (
  id, church_id, campus_id, name, day_of_week, start_time_local, duration_minutes, timezone,
  location_name, location_address, created_at, updated_at
) VALUES
('svc_boulder_0900','calvarybible','campus_boulder','Sunday Gathering',0,'09:00',75,'America/Denver','Boulder Campus','3245 Kalmia Ave. Boulder, CO 80301',datetime('now'),datetime('now')),
('svc_boulder_1030','calvarybible','campus_boulder','Sunday Gathering',0,'10:30',75,'America/Denver','Boulder Campus','3245 Kalmia Ave. Boulder, CO 80301',datetime('now'),datetime('now')),
('svc_erie_0800','calvarybible','campus_erie','Sunday Gathering',0,'08:00',75,'America/Denver','Erie Campus','615 Evans St. Erie, CO 80516',datetime('now'),datetime('now')),
('svc_erie_0930','calvarybible','campus_erie','Sunday Gathering',0,'09:30',75,'America/Denver','Erie Campus','615 Evans St. Erie, CO 80516',datetime('now'),datetime('now')),
('svc_erie_1100','calvarybible','campus_erie','Sunday Gathering',0,'11:00',75,'America/Denver','Erie Campus','615 Evans St. Erie, CO 80516',datetime('now'),datetime('now')),
('svc_thornton_0900','calvarybible','campus_thornton','Sunday Gathering',0,'09:00',75,'America/Denver','Thornton Campus','11989 St Paul St. Thornton, CO 80233',datetime('now'),datetime('now')),
('svc_thornton_1030','calvarybible','campus_thornton','Sunday Gathering',0,'10:30',75,'America/Denver','Thornton Campus','11989 St Paul St. Thornton, CO 80233',datetime('now'),datetime('now'));

-- Service plan (example run-of-show)
INSERT OR REPLACE INTO service_plans (id, church_id, campus_id, service_id, title, starts_at, ends_at, created_at, updated_at) VALUES
('plan_boulder_0900','calvarybible','campus_boulder','svc_boulder_0900','Sunday Gathering Plan (Boulder 9:00)',datetime('now','+2 days'),datetime('now','+2 days','+90 minutes'),datetime('now'),datetime('now')),
('plan_boulder_1030','calvarybible','campus_boulder','svc_boulder_1030','Sunday Gathering Plan (Boulder 10:30)',datetime('now','+2 days'),datetime('now','+2 days','+90 minutes'),datetime('now'),datetime('now')),
('plan_erie_0800','calvarybible','campus_erie','svc_erie_0800','Sunday Gathering Plan (Erie 8:00)',datetime('now','+2 days'),datetime('now','+2 days','+90 minutes'),datetime('now'),datetime('now')),
('plan_erie_0930','calvarybible','campus_erie','svc_erie_0930','Sunday Gathering Plan (Erie 9:30)',datetime('now','+2 days'),datetime('now','+2 days','+90 minutes'),datetime('now'),datetime('now')),
('plan_erie_1100','calvarybible','campus_erie','svc_erie_1100','Sunday Gathering Plan (Erie 11:00)',datetime('now','+2 days'),datetime('now','+2 days','+90 minutes'),datetime('now'),datetime('now')),
('plan_thornton_0900','calvarybible','campus_thornton','svc_thornton_0900','Sunday Gathering Plan (Thornton 9:00)',datetime('now','+2 days'),datetime('now','+2 days','+90 minutes'),datetime('now'),datetime('now')),
('plan_thornton_1030','calvarybible','campus_thornton','svc_thornton_1030','Sunday Gathering Plan (Thornton 10:30)',datetime('now','+2 days'),datetime('now','+2 days','+90 minutes'),datetime('now'),datetime('now'));

-- Kids check-in config
INSERT OR REPLACE INTO checkin_areas (id, church_id, campus_id, name, kind, created_at, updated_at) VALUES
('area_kids_boulder','calvarybible','campus_boulder','Calvary Kids Check-in','kids',datetime('now'),datetime('now')),
('area_kids_boulder_early','calvarybible','campus_boulder','Calvary Kids Check-in (Birth–Age 3)','kids',datetime('now'),datetime('now')),
('area_kids_erie','calvarybible','campus_erie','Calvary Kids Check-in','kids',datetime('now'),datetime('now')),
('area_kids_thornton','calvarybible','campus_thornton','Calvary Kids Check-in','kids',datetime('now'),datetime('now'));

INSERT OR REPLACE INTO checkin_rooms (id, church_id, campus_id, area_id, name, min_age_months, max_age_months, min_grade, max_grade, capacity, notes, created_at, updated_at) VALUES
('room_boulder_nursery','calvarybible','campus_boulder','area_kids_boulder','Owls (Nursery 0–1) — Room 110',0,23,NULL,NULL,20,'Allergies must be shown on label',datetime('now'),datetime('now')),
('room_boulder_toddlers','calvarybible','campus_boulder','area_kids_boulder','Foxes (Toddlers 1–2) — Room 111',24,35,NULL,NULL,20,'Allergies must be shown on label',datetime('now'),datetime('now')),
('room_boulder_preschool','calvarybible','campus_boulder','area_kids_boulder','Bears (Preschool 3–5) — Room 112',36,71,NULL,NULL,24,'Allergies must be shown on label',datetime('now'),datetime('now')),
('room_boulder_elem_early','calvarybible','campus_boulder','area_kids_boulder','Lions (K–2) — Room 210',72,119,'K','2',30,NULL,datetime('now'),datetime('now')),
('room_boulder_elem_late','calvarybible','campus_boulder','area_kids_boulder','Eagles (3–5) — Room 211',72,119,'3','5',30,NULL,datetime('now'),datetime('now')),

('room_boulder_early_nursery','calvarybible','campus_boulder','area_kids_boulder_early','Owls (Nursery 0–1) — Room 101',0,23,NULL,NULL,20,'9am: Birth through Age Three',datetime('now'),datetime('now')),
('room_boulder_early_toddlers','calvarybible','campus_boulder','area_kids_boulder_early','Foxes (Toddlers 1–2) — Room 102',24,35,NULL,NULL,20,'9am: Birth through Age Three',datetime('now'),datetime('now')),
('room_boulder_early_preschool','calvarybible','campus_boulder','area_kids_boulder_early','Bears (Age 3) — Room 103',36,47,NULL,NULL,20,'9am: Birth through Age Three',datetime('now'),datetime('now')),

('room_erie_nursery','calvarybible','campus_erie','area_kids_erie','Owls (Nursery 0–1) — Room 120',0,23,NULL,NULL,20,'Allergies must be shown on label',datetime('now'),datetime('now')),
('room_erie_toddlers','calvarybible','campus_erie','area_kids_erie','Foxes (Toddlers 1–2) — Room 121',24,35,NULL,NULL,20,'Allergies must be shown on label',datetime('now'),datetime('now')),
('room_erie_preschool','calvarybible','campus_erie','area_kids_erie','Bears (Preschool 3–5) — Room 122',36,71,NULL,NULL,24,'Allergies must be shown on label',datetime('now'),datetime('now')),
('room_erie_elem_early','calvarybible','campus_erie','area_kids_erie','Lions (K–2) — Room 220',72,119,'K','2',30,NULL,datetime('now'),datetime('now')),
('room_erie_elem_late','calvarybible','campus_erie','area_kids_erie','Eagles (3–5) — Room 221',72,119,'3','5',30,NULL,datetime('now'),datetime('now')),

('room_thornton_nursery','calvarybible','campus_thornton','area_kids_thornton','Owls (Nursery 0–1) — Room 130',0,23,NULL,NULL,20,'Allergies must be shown on label',datetime('now'),datetime('now')),
('room_thornton_toddlers','calvarybible','campus_thornton','area_kids_thornton','Foxes (Toddlers 1–2) — Room 131',24,35,NULL,NULL,20,'Allergies must be shown on label',datetime('now'),datetime('now')),
('room_thornton_preschool','calvarybible','campus_thornton','area_kids_thornton','Bears (Preschool 3–5) — Room 132',36,71,NULL,NULL,24,'Allergies must be shown on label',datetime('now'),datetime('now')),
('room_thornton_elem_early','calvarybible','campus_thornton','area_kids_thornton','Lions (K–2) — Room 230',72,119,'K','2',30,NULL,datetime('now'),datetime('now')),
('room_thornton_elem_late','calvarybible','campus_thornton','area_kids_thornton','Eagles (3–5) — Room 231',72,119,'3','5',30,NULL,datetime('now'),datetime('now'));

INSERT OR REPLACE INTO checkin_schedules (id, church_id, campus_id, service_plan_id, area_id, opens_at, closes_at, created_at, updated_at) VALUES
('sched_boulder_0900_kids','calvarybible','campus_boulder','plan_boulder_0900','area_kids_boulder_early',datetime('now','+2 days','-30 minutes'),datetime('now','+2 days','+30 minutes'),datetime('now'),datetime('now')),
('sched_boulder_1030_kids','calvarybible','campus_boulder','plan_boulder_1030','area_kids_boulder',datetime('now','+2 days','-30 minutes'),datetime('now','+2 days','+30 minutes'),datetime('now'),datetime('now')),
('sched_erie_0800_kids','calvarybible','campus_erie','plan_erie_0800','area_kids_erie',datetime('now','+2 days','-30 minutes'),datetime('now','+2 days','+30 minutes'),datetime('now'),datetime('now')),
('sched_erie_0930_kids','calvarybible','campus_erie','plan_erie_0930','area_kids_erie',datetime('now','+2 days','-30 minutes'),datetime('now','+2 days','+30 minutes'),datetime('now'),datetime('now')),
('sched_erie_1100_kids','calvarybible','campus_erie','plan_erie_1100','area_kids_erie',datetime('now','+2 days','-30 minutes'),datetime('now','+2 days','+30 minutes'),datetime('now'),datetime('now')),
('sched_thornton_0900_kids','calvarybible','campus_thornton','plan_thornton_0900','area_kids_thornton',datetime('now','+2 days','-30 minutes'),datetime('now','+2 days','+30 minutes'),datetime('now'),datetime('now')),
('sched_thornton_1030_kids','calvarybible','campus_thornton','plan_thornton_1030','area_kids_thornton',datetime('now','+2 days','-30 minutes'),datetime('now','+2 days','+30 minutes'),datetime('now'),datetime('now'));

INSERT OR REPLACE INTO service_plan_items (id, church_id, plan_id, sort_order, item_type, title, notes, duration_minutes, created_at, updated_at) VALUES
('item_b1','calvarybible','plan_boulder_0900',10,'welcome','Welcome','',3,datetime('now'),datetime('now')),
('item_b2','calvarybible','plan_boulder_0900',20,'song','Worship','',18,datetime('now'),datetime('now')),
('item_b3','calvarybible','plan_boulder_0900',30,'prayer','Prayer','',3,datetime('now'),datetime('now')),
('item_b4','calvarybible','plan_boulder_0900',40,'sermon','Message','Weekly messages: https://calvarybible.com/message-archive/',35,datetime('now'),datetime('now')),

('item_b1030_1','calvarybible','plan_boulder_1030',10,'welcome','Welcome','',3,datetime('now'),datetime('now')),
('item_b1030_2','calvarybible','plan_boulder_1030',20,'song','Worship','',18,datetime('now'),datetime('now')),
('item_b1030_3','calvarybible','plan_boulder_1030',30,'prayer','Prayer','',3,datetime('now'),datetime('now')),
('item_b1030_4','calvarybible','plan_boulder_1030',40,'sermon','Message','Weekly messages: https://calvarybible.com/message-archive/',35,datetime('now'),datetime('now')),

('item_e0800_1','calvarybible','plan_erie_0800',10,'welcome','Welcome','',3,datetime('now'),datetime('now')),
('item_e0800_2','calvarybible','plan_erie_0800',20,'song','Worship','',18,datetime('now'),datetime('now')),
('item_e0800_3','calvarybible','plan_erie_0800',30,'prayer','Prayer','',3,datetime('now'),datetime('now')),
('item_e0800_4','calvarybible','plan_erie_0800',40,'sermon','Message','Weekly messages: https://calvarybible.com/message-archive/',35,datetime('now'),datetime('now')),

('item_e1','calvarybible','plan_erie_0930',10,'welcome','Welcome','',3,datetime('now'),datetime('now')),
('item_e2','calvarybible','plan_erie_0930',20,'song','Worship','',18,datetime('now'),datetime('now')),
('item_e3','calvarybible','plan_erie_0930',30,'prayer','Prayer','',3,datetime('now'),datetime('now')),
('item_e4','calvarybible','plan_erie_0930',40,'sermon','Message','Weekly messages: https://calvarybible.com/message-archive/',35,datetime('now'),datetime('now')),

('item_e1100_1','calvarybible','plan_erie_1100',10,'welcome','Welcome','',3,datetime('now'),datetime('now')),
('item_e1100_2','calvarybible','plan_erie_1100',20,'song','Worship','',18,datetime('now'),datetime('now')),
('item_e1100_3','calvarybible','plan_erie_1100',30,'prayer','Prayer','',3,datetime('now'),datetime('now')),
('item_e1100_4','calvarybible','plan_erie_1100',40,'sermon','Message','Weekly messages: https://calvarybible.com/message-archive/',35,datetime('now'),datetime('now')),

('item_t1','calvarybible','plan_thornton_0900',10,'welcome','Welcome','',3,datetime('now'),datetime('now')),
('item_t2','calvarybible','plan_thornton_0900',20,'song','Worship','',18,datetime('now'),datetime('now')),
('item_t3','calvarybible','plan_thornton_0900',30,'prayer','Prayer','',3,datetime('now'),datetime('now')),
('item_t4','calvarybible','plan_thornton_0900',40,'sermon','Message','Weekly messages: https://calvarybible.com/message-archive/',35,datetime('now'),datetime('now')),

('item_t1030_1','calvarybible','plan_thornton_1030',10,'welcome','Welcome','',3,datetime('now'),datetime('now')),
('item_t1030_2','calvarybible','plan_thornton_1030',20,'song','Worship','',18,datetime('now'),datetime('now')),
('item_t1030_3','calvarybible','plan_thornton_1030',30,'prayer','Prayer','',3,datetime('now'),datetime('now')),
('item_t1030_4','calvarybible','plan_thornton_1030',40,'sermon','Message','Weekly messages: https://calvarybible.com/message-archive/',35,datetime('now'),datetime('now'));

-- Events
INSERT OR REPLACE INTO events (
  id, church_id, campus_id, title, description, start_at, end_at,
  location_name, location_address, created_at, updated_at
) VALUES
('ev1','calvarybible','campus_boulder','Starting Point','New to Calvary? A simple next step to learn more.',datetime('now','+7 days'),datetime('now','+7 days','+90 minutes'),'Boulder Campus','3245 Kalmia Ave. Boulder, CO 80301',datetime('now'),datetime('now')),
('ev2','calvarybible','campus_boulder','Welcome Lunch','Meet pastors and new friends.',datetime('now','+14 days'),datetime('now','+14 days','+2 hours'),'Boulder Campus','3245 Kalmia Ave. Boulder, CO 80301',datetime('now'),datetime('now')),

-- Erie campus "Coming up" (from https://calvarybible.com/erie/)
('ev_erie_candy_needed','calvarybible','campus_erie','Candy Needed!',
 'Please help fill treasure chests for the Easter Egg Hunt. Bring individually wrapped, NUT-FREE candy through March 8. Learn more: https://calvarybible.com/egghunt/',
 datetime('now','start of day','+1 day'),datetime('now','start of day','+8 day','+23 hours','+59 minutes'),
 'Erie Campus','615 Evans St. Erie, CO 80516',datetime('now'),datetime('now')),
('ev_erie_easter_weekend','calvarybible','campus_erie','Easter Weekend',
 'Celebrate Easter with us! Good Friday (Apr 3), Egg Hunt (Apr 4), Easter Services (Apr 4-5). Learn more: https://calvarybible.com/easter',
 datetime('now','start of day','+30 day'),datetime('now','start of day','+32 day','+23 hours','+59 minutes'),
 'Erie Campus','615 Evans St. Erie, CO 80516',datetime('now'),datetime('now')),
('ev_erie_womens_away_retreat','calvarybible','campus_erie','Women''s Away Retreat',
 'Women of Calvary: “Called to Hope” retreat at YMCA of the Rockies (Estes Park). Learn more: https://calvarybible.com/women/retreat/',
 datetime('now','start of day','-1 day'),datetime('now','start of day','+1 day','+23 hours','+59 minutes'),
 'YMCA of the Rockies','Estes Park, CO',datetime('now'),datetime('now')),

-- Boulder campus "Coming up" (from https://calvarybible.com/boulder/)
('ev_boulder_candy_needed','calvarybible','campus_boulder','Candy Needed!',
 'Please help fill treasure chests for the Easter Egg Hunt. Bring individually wrapped candy through March 15.',
 '2026-03-01T00:00:00','2026-03-15T23:59:00',
 'Boulder Campus','3245 Kalmia Ave. Boulder, CO 80301',datetime('now'),datetime('now')),
('ev_boulder_ironman_hs_trip','calvarybible','campus_boulder','Ironman High School Trip',
 'High school spring break trip (community, worship, teaching). Learn more + register: https://calvarybiblechurch.churchcenter.com/registrations/events/3387389',
 '2026-03-13T00:00:00','2026-03-19T23:59:00',
 'Boulder Campus','3245 Kalmia Ave. Boulder, CO 80301',datetime('now'),datetime('now')),
('ev_boulder_easter_weekend','calvarybible','campus_boulder','Easter Weekend',
 'Celebrate Easter with us! Good Friday (Apr 3), Egg Hunt (Apr 4), Easter Sunday (Apr 5). Learn more: https://calvarybible.com/easter',
 '2026-04-03T00:00:00','2026-04-05T23:59:00',
 'Boulder Campus','3245 Kalmia Ave. Boulder, CO 80301',datetime('now'),datetime('now')),

-- Thornton campus "Coming up" (from https://calvarybible.com/thornton/)
('ev_thornton_candy_needed','calvarybible','campus_thornton','Candy Needed!',
 'Please help fill treasure chests for the Easter Egg Hunt. Bring individually wrapped candy through March 15.',
 '2026-03-01T00:00:00','2026-03-15T23:59:00',
 'Thornton Campus','11989 St Paul St. Thornton, CO 80233',datetime('now'),datetime('now')),
('ev_thornton_easter_weekend','calvarybible','campus_thornton','Easter Weekend',
 'Celebrate Easter with us! Good Friday (Apr 3), Egg Hunt (Apr 4), Easter Sunday (Apr 5). Learn more: https://calvarybible.com/easter',
 '2026-04-03T00:00:00','2026-04-05T23:59:00',
 'Thornton Campus','11989 St Paul St. Thornton, CO 80233',datetime('now'),datetime('now')),
('ev_thornton_family_worship_night','calvarybible','campus_thornton','Family Worship Night',
 'March 1, 6–7pm. Songs of worship + time to respond and reflect. Questions: dvaughan@calvarybible.com',
 '2026-03-01T18:00:00','2026-03-01T19:00:00',
 'Thornton Campus','11989 St Paul St. Thornton, CO 80233',datetime('now'),datetime('now')),

-- Thornton campus "Events" page (from https://calvarybible.com/thornton/events/)
('ev_thornton_mens_spring_study','calvarybible','campus_thornton','Men''s Spring Study (Habakkuk)',
 'Monday evenings, 6:30–8pm. A study through Habakkuk. Learn more: https://calvarybible.com/thornton/events/',
 datetime('now'),datetime('now','+90 days'),
 'Thornton Campus','11989 St Paul St. Thornton, CO 80233',datetime('now'),datetime('now')),
('ev_thornton_womens_spring_study','calvarybible','campus_thornton','Women''s Spring Study (Ephesians)',
 'Monday evenings 6:30–8pm and Thursday mornings 9:30–11:30am (8 sessions). Learn more: https://calvarybible.com/thornton/events/',
 datetime('now'),datetime('now','+90 days'),
 'Thornton Campus','11989 St Paul St. Thornton, CO 80233',datetime('now'),datetime('now')),
('ev_thornton_8th_grade_dessert_crawl','calvarybible','campus_thornton','8th Grade Dessert Crawl',
 'February 28, 6:50–9pm. Celebrate 8th graders and welcome them toward high school community. Learn more: https://calvarybible.com/thornton/events/',
 '2026-02-28T18:50:00','2026-02-28T21:00:00',
 'Thornton Campus','11989 St Paul St. Thornton, CO 80233',datetime('now'),datetime('now')),
('ev_thornton_young_adults','calvarybible','campus_thornton','Young Adults',
 'Monday evenings, 6:30–8pm weekly gathering. Learn more: https://calvarybible.com/thornton/events/',
 datetime('now'),datetime('now','+180 days'),
 'Thornton Campus','11989 St Paul St. Thornton, CO 80233',datetime('now'),datetime('now')),
('ev_thornton_meal_train','calvarybible','campus_thornton','Meal Train Ministry',
 'A ministry to love one another by easing the burden of providing meals for those in need. Learn more: https://calvarybible.com/thornton/events/',
 datetime('now'),datetime('now','+365 days'),
 'Thornton Campus','11989 St Paul St. Thornton, CO 80233',datetime('now'),datetime('now')),
('ev_thornton_momco_at_night','calvarybible','campus_thornton','MOMCo at NIGHT',
 '2nd & 4th Tuesdays, 6:30–8pm. A community of moms. Learn more: https://calvarybible.com/thornton/events/',
 datetime('now'),datetime('now','+180 days'),
 'Thornton Campus','11989 St Paul St. Thornton, CO 80233',datetime('now'),datetime('now')),
('ev_thornton_discipleship_course','calvarybible','campus_thornton','Discipleship: Following Jesus in All of Life',
 'Tuesdays, 6:30–8pm. Register on the Thornton events page. Learn more: https://calvarybible.com/thornton/events/',
 datetime('now'),datetime('now','+90 days'),
 'Thornton Campus','11989 St Paul St. Thornton, CO 80233',datetime('now'),datetime('now')),
('ev_thornton_membership_class','calvarybible','campus_thornton','Membership Class',
 'April 19, after 2nd service. Learn Calvary history, beliefs, and vision. Learn more: https://calvarybible.com/thornton/events/',
 '2026-04-19T11:45:00','2026-04-19T13:00:00',
 'Thornton Campus','11989 St Paul St. Thornton, CO 80233',datetime('now'),datetime('now')),
('ev_thornton_kids_week_2026','calvarybible','campus_thornton','Kids Week 2026 (Save the Date)',
 'July 13–17, 2026. More info on the Thornton events page. Learn more: https://calvarybible.com/thornton/events/',
 '2026-07-13T09:00:00','2026-07-17T12:00:00',
 'Thornton Campus','11989 St Paul St. Thornton, CO 80233',datetime('now'),datetime('now'));

-- Outreach campaign
INSERT OR REPLACE INTO outreach_campaigns (id, church_id, campus_id, title, description, start_at, end_at, status, created_at, updated_at) VALUES
('out1','calvarybible','campus_boulder','Community Outreach','Serve and love neighbors through outreach opportunities.',datetime('now','+21 days'),datetime('now','+21 days','+3 hours'),'active',datetime('now'),datetime('now'));

-- Groups
INSERT OR REPLACE INTO groups (
  id, church_id, campus_id, name, description, leader_person_id, meeting_details, is_open,
  created_at, updated_at
) VALUES
('g1','calvarybible','campus_boulder','Adults & Groups','Community groups for connection and growth.','p_leader_1','See groups: https://calvarybible.com/connect/adults-groups/',1,datetime('now'),datetime('now')),
('g2','calvarybible','campus_boulder','Parents & Families','Support for parents and families.','p_leader_1','See families: https://calvarybible.com/connect/parents-families/',1,datetime('now'),datetime('now'));

INSERT OR REPLACE INTO group_memberships (church_id, group_id, person_id, role, status, joined_at) VALUES
('calvarybible','g1','p_seeker_1','member','active',datetime('now')),
('calvarybible','g2','p_seeker_2','member','active',datetime('now'));

-- Opportunities
INSERT OR REPLACE INTO opportunities (
  id, church_id, campus_id, title, description, contact_email, created_at, updated_at
) VALUES
('opp1','calvarybible','campus_boulder','Serve on a Team','Join a serving team at Calvary.','serve@calvarybible.com',datetime('now'),datetime('now')),
('opp2','calvarybible','campus_boulder','Calvary Kids Volunteer','Support Calvary Kids (birth–5th).','serve@calvarybible.com',datetime('now'),datetime('now'));

-- Resources (KB-friendly)
INSERT OR REPLACE INTO resources (id, church_id, campus_id, title, body_markdown, visibility, created_at, updated_at) VALUES
('res1','calvarybible','campus_boulder','What to expect on Sunday', 'Calvary Bible Church has multiple campuses. Service times and campus info:\\n\\n- Locations: https://calvarybible.com/locations/\\n\\nDress is casual. You are welcome even if you are unsure what you believe.', 'public', datetime('now'), datetime('now')),
('res2','calvarybible','campus_boulder','Next steps', 'Common next steps:\\n\\n- Fill out a Connect Card: https://calvarybible.com/ (see Connect Card)\\n- Starting Point\\n- Join a group\\n- Serve on a team', 'public', datetime('now'), datetime('now')),
('res_message_archive','calvarybible','campus_boulder','Weekly Messages', 'Watch weekly messages here:\\n\\n- Message archive: https://calvarybible.com/message-archive/\\n- Watch online: https://calvarybible.com/', 'public', datetime('now'), datetime('now')),
('res_thornton_events','calvarybible','campus_thornton','Thornton campus events', 'Thornton events + signups:\\n\\n- Events: https://calvarybible.com/thornton/events/\\n- Campus page: https://calvarybible.com/thornton/', 'public', datetime('now'), datetime('now')),
('res_thornton_messages','calvarybible','campus_thornton','Thornton message archive', 'Thornton message archive (watch/listen):\\n\\n- https://calvarybible.com/messages/thornton/', 'public', datetime('now'), datetime('now')),
('res_classes','calvarybible',NULL,'Classes', 'Find classes and class-style resources (adult classes, foundations, and more):\\n\\n- Search: https://calvarybible.com/?s=classes', 'public', datetime('now'), datetime('now'));

-- Content docs stored in D1 (instead of local markdown files)
INSERT OR REPLACE INTO content_docs (id, church_id, entity_type, entity_id, locale, title, body_markdown, created_at, updated_at) VALUES
('doc_faq','calvarybible','faq','general','en','FAQ','## Is it okay to come if I''m not sure what I believe?\\n\\nYes. You are welcome to ask honest questions and take next steps at your own pace.\\n\\n## What are the service times and campuses?\\n\\nSee: https://calvarybible.com/locations/\\n\\n## How do I get connected?\\n\\n- Starting Point\\n- Adults & Groups\\n- Serve on a Team', datetime('now'), datetime('now')),
('doc_calvary_mission_vision','calvarybible','church','mission_vision','en','Mission & Vision',
 '## Mission\\n\\nBuilding Christ centered communities of people fully devoted to loving God and loving others.\\n\\n## Vision\\n\\n- Make disciples\\n- Empower leaders\\n- Multiply churches\\n\\n## Shaping values\\n\\n- Biblical Authority\\n- Prayer in Faith\\n- Loving Relationships\\n- Moral Excellence\\n- Confident Witness\\n- Faithful Stewardship\\n\\nSource: https://calvarybible.com/mission-vision/',
 datetime('now'), datetime('now')),

-- Sermons / message archive (Thornton campus examples, from https://calvarybible.com/messages/thornton/)
('doc_sermon_thornton_2026_03_01','calvarybible','sermon','thornton:2026-03-01','en','The Gospel of John: The Helper',
 'Speaker: Zack Thompson\\n\\nDate: 2026-03-01\\n\\nScripture: John 14:15-31\\n\\nWatch: https://calvarybible.com/messages/thornton/\\n\\nFrom series: The Gospel of John',
 datetime('now'),datetime('now')),
('doc_sermon_thornton_2026_02_22','calvarybible','sermon','thornton:2026-02-22','en','The Gospel of John: Let Not Your Heart Be Troubled',
 'Speaker: Tom Shirk\\n\\nDate: 2026-02-22\\n\\nScripture: John 14:1-14\\n\\nWatch/Listen: https://calvarybible.com/messages/thornton/\\n\\nFrom series: The Gospel of John',
 datetime('now'),datetime('now')),
('doc_sermon_thornton_2026_02_15','calvarybible','sermon','thornton:2026-02-15','en','The Gospel of John: Love One Another',
 'Speaker: Zack Thompson\\n\\nDate: 2026-02-15\\n\\nScripture: John 13:21-38\\n\\nWatch/Listen: https://calvarybible.com/messages/thornton/\\n\\nFrom series: The Gospel of John',
 datetime('now'),datetime('now'));

-- Strategic intent (ChurchCore ontology-aligned)
INSERT OR REPLACE INTO strategic_intents (id, church_id, intent_type, title, body_markdown, sort_order, source_url, created_at, updated_at) VALUES
('si_mission','calvarybible','mission','Mission (Calvary)','Building Christ centered communities of people fully devoted to loving God and loving others.',10,'https://calvarybible.com/mission-vision/',datetime('now'),datetime('now')),
('si_purpose','calvarybible','purpose','Purpose','Loving God and loving others.',5,'https://calvarybible.com/mission-vision/',datetime('now'),datetime('now')),
('si_strategy','calvarybible','strategy','Strategy (interpreted)','Interpreted from Calvary’s published vision headings:\\n\\n- Make disciples\\n- Empower leaders\\n- Multiply churches',15,'https://calvarybible.com/mission-vision/',datetime('now'),datetime('now')),
('si_vision','calvarybible','vision','Vision (Calvary)','- Make disciples\\n- Empower leaders\\n- Multiply churches',20,'https://calvarybible.com/mission-vision/',datetime('now'),datetime('now')),
('si_vision_make_disciples','calvarybible','vision','Make disciples','A disciple is a follower of Jesus who is growing in love for God and love for others.',21,'https://calvarybible.com/mission-vision/',datetime('now'),datetime('now')),
('si_vision_empower_leaders','calvarybible','vision','Empower leaders','We train and equip leaders in our church, community, and world to make disciples of Jesus.',22,'https://calvarybible.com/mission-vision/',datetime('now'),datetime('now')),
('si_vision_multiply_churches','calvarybible','vision','Multiply churches','The church is not a building, but people who love Jesus and love each other. We want to help the church grow around the world.',23,'https://calvarybible.com/mission-vision/',datetime('now'),datetime('now')),
('si_value_biblical_authority','calvarybible','value','Biblical Authority','We submit our lives to the teaching of God’s Word.',30,'https://calvarybible.com/mission-vision/',datetime('now'),datetime('now')),
('si_value_prayer_in_faith','calvarybible','value','Prayer in Faith','We believe that God accomplishes His will through our prayers.',31,'https://calvarybible.com/mission-vision/',datetime('now'),datetime('now')),
('si_value_loving_relationships','calvarybible','value','Loving Relationships','We commit ourselves to pursue authentic community.',32,'https://calvarybible.com/mission-vision/',datetime('now'),datetime('now')),
('si_value_moral_excellence','calvarybible','value','Moral Excellence','We pursue deeper holiness in everyday living.',33,'https://calvarybible.com/mission-vision/',datetime('now'),datetime('now')),
('si_value_confident_witness','calvarybible','value','Confident Witness','We communicate in word and deed that salvation is found in Christ alone.',34,'https://calvarybible.com/mission-vision/',datetime('now'),datetime('now')),
('si_value_faithful_stewardship','calvarybible','value','Faithful Stewardship','We give generously and faithfully of our financial resources.',35,'https://calvarybible.com/mission-vision/',datetime('now'),datetime('now'));

INSERT OR REPLACE INTO strategic_intent_links (church_id, from_intent_id, to_intent_id, link_type, weight, metadata_json, created_at) VALUES
('calvarybible','si_purpose','si_mission','drives',1.0,'{}',datetime('now')),
('calvarybible','si_mission','si_vision','drives',1.0,'{}',datetime('now')),
('calvarybible','si_strategy','si_vision','implements',1.0,'{}',datetime('now')),
('calvarybible','si_vision','si_vision_make_disciples','implements',1.0,'{}',datetime('now')),
('calvarybible','si_vision','si_vision_empower_leaders','implements',1.0,'{}',datetime('now')),
('calvarybible','si_vision','si_vision_multiply_churches','implements',1.0,'{}',datetime('now')),

('calvarybible','si_mission','si_value_biblical_authority','supports',1.0,'{}',datetime('now')),
('calvarybible','si_mission','si_value_prayer_in_faith','supports',1.0,'{}',datetime('now')),
('calvarybible','si_mission','si_value_loving_relationships','supports',1.0,'{}',datetime('now')),
('calvarybible','si_mission','si_value_moral_excellence','supports',1.0,'{}',datetime('now')),
('calvarybible','si_mission','si_value_confident_witness','supports',1.0,'{}',datetime('now')),
('calvarybible','si_mission','si_value_faithful_stewardship','supports',1.0,'{}',datetime('now')),

('calvarybible','si_vision_make_disciples','si_value_biblical_authority','supported_by',1.0,'{}',datetime('now')),
('calvarybible','si_vision_make_disciples','si_value_prayer_in_faith','supported_by',1.0,'{}',datetime('now')),
('calvarybible','si_vision_make_disciples','si_value_loving_relationships','supported_by',1.0,'{}',datetime('now')),
('calvarybible','si_vision_make_disciples','si_value_moral_excellence','supported_by',1.0,'{}',datetime('now')),
('calvarybible','si_vision_make_disciples','si_value_confident_witness','supported_by',1.0,'{}',datetime('now')),
('calvarybible','si_vision_make_disciples','si_value_faithful_stewardship','supported_by',1.0,'{}',datetime('now'));

-- Assignments (guide local-guide shepherds 2 seekers)
INSERT OR REPLACE INTO assignments (id, church_id, seeker_id, guide_user_id, assigned_at) VALUES
('a1','calvarybible','p_seeker_1','local-guide',datetime('now')),
('a2','calvarybible','p_seeker_2','local-guide',datetime('now'));

-- Journey state
INSERT OR REPLACE INTO journey_state (id, church_id, seeker_id, state_json, updated_at) VALUES
('js1','calvarybible','p_seeker_1','{\"stage\":\"new\",\"lastTouch\":\"seed\"}',datetime('now')),
('js2','calvarybible','p_seeker_2','{\"stage\":\"visit_planned\",\"lastTouch\":\"seed\"}',datetime('now'));

-- Evangelical faith journey graph (canonical)
INSERT OR REPLACE INTO journey_node (node_id, church_id, node_type, title, summary, metadata_json, created_at, updated_at) VALUES
('stage_seeker','calvarybible','Stage','Seeker','Exploring faith, asking questions.','{}',datetime('now'),datetime('now')),
('stage_gospel_clarity','calvarybible','Stage','Gospel Clarity','Understands the gospel and its implications.','{}',datetime('now'),datetime('now')),
('stage_conversion','calvarybible','Stage','Conversion','Responded to Christ with repentance and faith.','{}',datetime('now'),datetime('now')),
('stage_new_believer','calvarybible','Stage','New Believer','Early formation, assurance, basic practices.','{}',datetime('now'),datetime('now')),
('stage_connected','calvarybible','Stage','Connected','Belongs in community and participates regularly.','{}',datetime('now'),datetime('now')),
('stage_growing','calvarybible','Stage','Growing Disciple','Developing habits, doctrine, obedience.','{}',datetime('now'),datetime('now')),
('stage_serving','calvarybible','Stage','Serving','Using gifts to build up the church.','{}',datetime('now'),datetime('now')),
('stage_multiplying','calvarybible','Stage','Multiplying','Sharing faith and discipling others.','{}',datetime('now'),datetime('now')),
('stage_leader','calvarybible','Stage','Leader','Shepherding others with recognized responsibility.','{}',datetime('now'),datetime('now')),

('ms_understood_gospel','calvarybible','Milestone','Understood the Gospel','Can explain the gospel in their own words.','{}',datetime('now'),datetime('now')),
('ms_profession_faith','calvarybible','Milestone','Profession of Faith','Expressed repentance and faith in Christ.','{}',datetime('now'),datetime('now')),
('ms_baptism','calvarybible','Milestone','Baptism','Public identification with Christ.','{}',datetime('now'),datetime('now')),
('ms_joined_group','calvarybible','Milestone','Joined a Small Group','Connected into ongoing community.','{}',datetime('now'),datetime('now')),
('ms_foundations_class','calvarybible','Milestone','Completed Foundations','Completed core beliefs / discipleship class.','{}',datetime('now'),datetime('now')),
('ms_started_serving','calvarybible','Milestone','Started Serving','Serving on a team consistently.','{}',datetime('now'),datetime('now')),
('ms_shared_testimony','calvarybible','Milestone','Shared Testimony','Able to share story clearly.','{}',datetime('now'),datetime('now')),

('pr_bible','calvarybible','Practice','Bible Reading','Regular Scripture intake.','{}',datetime('now'),datetime('now')),
('pr_prayer','calvarybible','Practice','Prayer','Daily prayer rhythm.','{}',datetime('now'),datetime('now')),
('pr_worship_gathering','calvarybible','Practice','Worship Gathering','Regular Sunday gathering participation.','{}',datetime('now'),datetime('now')),
('pr_community','calvarybible','Practice','Community Participation','Meaningful relationships and mutual care.','{}',datetime('now'),datetime('now')),
('pr_generosity','calvarybible','Practice','Generosity','Regular generosity as worship and love of neighbor.','{}',datetime('now'),datetime('now')),
('pr_serving','calvarybible','Practice','Serving','Using gifts to build up the church.','{}',datetime('now'),datetime('now')),
('pr_evangelism','calvarybible','Practice','Evangelism','Prayerfully sharing faith and inviting others.','{}',datetime('now'),datetime('now')),
('pr_sabbath','calvarybible','Practice','Sabbath/Rest','Healthy rhythms of rest and trust.','{}',datetime('now'),datetime('now')),
('pr_scripture_memory','calvarybible','Practice','Scripture Memory','Hiding God’s word in your heart.','{}',datetime('now'),datetime('now')),
('pr_confession','calvarybible','Practice','Confession & Repentance','Regular honesty and turning back to God.','{}',datetime('now'),datetime('now')),

('topic_gospel','calvarybible','DoctrineTopic','The Gospel','Jesus, sin, grace, faith, new life.','{}',datetime('now'),datetime('now')),
('topic_assurance','calvarybible','DoctrineTopic','Assurance of Salvation','Confidence grounded in Christ.','{}',datetime('now'),datetime('now')),
('topic_scripture','calvarybible','DoctrineTopic','Scripture (Authority & Reading)','Why the Bible matters and how to read it.','{}',datetime('now'),datetime('now')),
('topic_trinity','calvarybible','DoctrineTopic','Trinity','Father, Son, and Holy Spirit.','{}',datetime('now'),datetime('now')),
('topic_jesus','calvarybible','DoctrineTopic','Jesus (Person & Work)','Incarnation, atonement, resurrection.','{}',datetime('now'),datetime('now')),
('topic_salvation','calvarybible','DoctrineTopic','Salvation (Grace/Faith)','Justification and sanctification.','{}',datetime('now'),datetime('now')),
('topic_holy_spirit','calvarybible','DoctrineTopic','Holy Spirit','New birth, empowerment, guidance.','{}',datetime('now'),datetime('now')),
('topic_church','calvarybible','DoctrineTopic','Church & Ordinances','Community, baptism, communion.','{}',datetime('now'),datetime('now')),
('topic_prayer','calvarybible','DoctrineTopic','Prayer','Talking with God, dependence, intercession.','{}',datetime('now'),datetime('now')),
('topic_suffering','calvarybible','DoctrineTopic','Suffering & Evil','God’s goodness amid pain.','{}',datetime('now'),datetime('now')),
('topic_ethics','calvarybible','DoctrineTopic','Christian Ethics','Holiness, love of neighbor, integrity.','{}',datetime('now'),datetime('now')),
('topic_mission','calvarybible','DoctrineTopic','Mission','Making disciples and blessing the world.','{}',datetime('now'),datetime('now')),

('barrier_doubt','calvarybible','Barrier','Doubt/Uncertainty','Questions about faith, truth, or salvation.','{}',datetime('now'),datetime('now')),
('barrier_shame','calvarybible','Barrier','Shame/Guilt','Feels unworthy or stuck in regret.','{}',datetime('now'),datetime('now')),
('barrier_church_hurt','calvarybible','Barrier','Church Hurt','Painful experiences with church/Christians.','{}',datetime('now'),datetime('now')),
('barrier_assurance_anxiety','calvarybible','Barrier','Assurance Anxiety','Fear about salvation / “am I really saved?”.','{}',datetime('now'),datetime('now')),
('barrier_addictions','calvarybible','Barrier','Addictions/Habits','Stuck patterns that feel stronger than willpower.','{}',datetime('now'),datetime('now')),
('barrier_loneliness','calvarybible','Barrier','Loneliness','Lack of meaningful community.','{}',datetime('now'),datetime('now')),
('barrier_relationship_conflict','calvarybible','Barrier','Relationship Conflict','Marriage/family/friend conflict and strain.','{}',datetime('now'),datetime('now')),
('barrier_anxiety_depression','calvarybible','Barrier','Anxiety/Depression','Persistent anxiety/depression symptoms (handle carefully).','{\"safety\":\"route_to_humans\"}',datetime('now'),datetime('now')),

('step_talk_to_guide','calvarybible','ActionStep','Talk with a Guide','Schedule a 15-minute conversation with a church guide.','{\"cta\":\"Talk with a guide\",\"tool\":\"guide\"}',datetime('now'),datetime('now')),
('step_attend_sunday','calvarybible','ActionStep','Attend a Sunday Gathering','Pick a campus + service time and attend in person.','{\"cta\":\"Plan a visit\",\"tool\":\"chat\"}',datetime('now'),datetime('now')),
('step_join_group','calvarybible','ActionStep','Join a Group','Explore groups and take one small step toward community.','{\"cta\":\"Find a group\",\"tool\":\"groups\"}',datetime('now'),datetime('now')),
('step_start_bible_plan','calvarybible','ActionStep','Start a Bible Reading Plan','Choose a simple plan and start this week.','{\"cta\":\"Start a plan\",\"tool\":\"faith_journey\"}',datetime('now'),datetime('now')),
('step_request_prayer','calvarybible','ActionStep','Request Prayer','Share a prayer request and we’ll pray with you.','{\"cta\":\"Request prayer\",\"tool\":\"care_pastoral\"}',datetime('now'),datetime('now')),
('step_foundations_class','calvarybible','ActionStep','Foundations','Take a next step in learning and formation.','{\"cta\":\"Find a class\",\"tool\":\"groups\"}',datetime('now'),datetime('now')),
('step_interest_serving','calvarybible','ActionStep','Serve on a Team','Tell us where you’d like to serve.','{\"cta\":\"Serve\",\"tool\":\"teams_skills\"}',datetime('now'),datetime('now'));

-- Resources / communities tied to real ChurchCore records
INSERT OR REPLACE INTO journey_node (node_id, church_id, node_type, title, summary, metadata_json, created_at, updated_at) VALUES
('res_what_to_expect','calvarybible','Resource','What to expect on Sunday','A simple overview of what a Sunday gathering is like.','{\"entity_type\":\"resource\",\"entity_id\":\"res1\",\"tool\":\"resource\"}',datetime('now'),datetime('now')),
('res_next_steps','calvarybible','Resource','Next steps','Suggested next steps at Calvary Bible Church.','{\"entity_type\":\"resource\",\"entity_id\":\"res2\",\"tool\":\"resource\"}',datetime('now'),datetime('now')),
('res_weekly_messages','calvarybible','Resource','Weekly messages','Watch weekly service messages.', '{\"entity_type\":\"resource\",\"entity_id\":\"res_message_archive\",\"tool\":\"resource\"}',datetime('now'),datetime('now')),
('comm_parents_group','calvarybible','Community','Parents & Families','Support for parents and families.','{\"entity_type\":\"group\",\"entity_id\":\"g2\",\"tool\":\"groups\"}',datetime('now'),datetime('now'));

INSERT OR REPLACE INTO journey_edge (edge_id, church_id, from_node_id, to_node_id, edge_type, weight, metadata_json, created_at, updated_at) VALUES
('e1','calvarybible','stage_seeker','stage_gospel_clarity','NEXT_STAGE',1.0,'{}',datetime('now'),datetime('now')),
('e2','calvarybible','stage_gospel_clarity','stage_conversion','NEXT_STAGE',1.0,'{}',datetime('now'),datetime('now')),
('e3','calvarybible','stage_conversion','stage_new_believer','NEXT_STAGE',1.0,'{}',datetime('now'),datetime('now')),
('e4','calvarybible','stage_new_believer','stage_connected','NEXT_STAGE',1.0,'{}',datetime('now'),datetime('now')),
('e5','calvarybible','stage_connected','stage_growing','NEXT_STAGE',1.0,'{}',datetime('now'),datetime('now')),
('e6','calvarybible','stage_growing','stage_serving','NEXT_STAGE',1.0,'{}',datetime('now'),datetime('now')),
('e7','calvarybible','stage_serving','stage_multiplying','NEXT_STAGE',1.0,'{}',datetime('now'),datetime('now')),
('e8','calvarybible','stage_multiplying','stage_leader','NEXT_STAGE',1.0,'{}',datetime('now'),datetime('now')),

('rec_seeker_guide','calvarybible','stage_seeker','step_talk_to_guide','RECOMMENDS',1.3,'{}',datetime('now'),datetime('now')),
('rec_seeker_gospel','calvarybible','stage_seeker','topic_gospel','RECOMMENDS',1.2,'{}',datetime('now'),datetime('now')),
('rec_seeker_expect','calvarybible','stage_seeker','res_what_to_expect','RECOMMENDS',1.1,'{}',datetime('now'),datetime('now')),
('rec_seeker_attend','calvarybible','stage_seeker','step_attend_sunday','RECOMMENDS',1.15,'{}',datetime('now'),datetime('now')),
('rec_seeker_messages','calvarybible','stage_seeker','res_weekly_messages','RECOMMENDS',1.05,'{}',datetime('now'),datetime('now')),
('rec_seeker_prayer','calvarybible','stage_seeker','step_request_prayer','RECOMMENDS',1.05,'{}',datetime('now'),datetime('now')),

('r1','calvarybible','stage_gospel_clarity','ms_understood_gospel','REQUIRES',1.2,'{}',datetime('now'),datetime('now')),
('rec_gospel_scripture','calvarybible','stage_gospel_clarity','topic_scripture','RECOMMENDS',1.05,'{}',datetime('now'),datetime('now')),
('rec_gospel_next','calvarybible','stage_gospel_clarity','res_next_steps','RECOMMENDS',1.0,'{}',datetime('now'),datetime('now')),
('r2','calvarybible','stage_conversion','ms_profession_faith','REQUIRES',1.2,'{}',datetime('now'),datetime('now')),
('rec_conversion_guide','calvarybible','stage_conversion','step_talk_to_guide','RECOMMENDS',1.2,'{}',datetime('now'),datetime('now')),
('r3','calvarybible','stage_new_believer','pr_bible','REQUIRES',1.0,'{}',datetime('now'),datetime('now')),
('r4','calvarybible','stage_new_believer','pr_prayer','REQUIRES',1.0,'{}',datetime('now'),datetime('now')),
('rec_newbeliever_assurance','calvarybible','stage_new_believer','topic_assurance','RECOMMENDS',1.15,'{}',datetime('now'),datetime('now')),
('rec_newbeliever_bibleplan','calvarybible','stage_new_believer','step_start_bible_plan','RECOMMENDS',1.1,'{}',datetime('now'),datetime('now')),
('r5','calvarybible','stage_connected','ms_joined_group','REQUIRES',1.1,'{}',datetime('now'),datetime('now')),
('rec_connected_group','calvarybible','stage_connected','step_join_group','RECOMMENDS',1.2,'{}',datetime('now'),datetime('now')),
('r6','calvarybible','stage_growing','ms_foundations_class','REQUIRES',1.0,'{}',datetime('now'),datetime('now')),
('rec_growing_foundations','calvarybible','stage_growing','step_foundations_class','RECOMMENDS',1.15,'{}',datetime('now'),datetime('now')),
('r7','calvarybible','stage_serving','ms_started_serving','REQUIRES',1.0,'{}',datetime('now'),datetime('now')),
('rec_serving_explore','calvarybible','stage_serving','step_interest_serving','RECOMMENDS',1.15,'{}',datetime('now'),datetime('now')),

('b1','calvarybible','stage_gospel_clarity','barrier_doubt','BLOCKED_BY',1.0,'{}',datetime('now'),datetime('now')),
('b2','calvarybible','stage_conversion','barrier_shame','BLOCKED_BY',1.0,'{}',datetime('now'),datetime('now')),

('rec1','calvarybible','barrier_doubt','step_talk_to_guide','RESOLVED_BY',1.3,'{}',datetime('now'),datetime('now')),
('rec1b','calvarybible','barrier_doubt','topic_scripture','RESOLVED_BY',1.1,'{}',datetime('now'),datetime('now')),
('rec2','calvarybible','stage_connected','step_join_group','RECOMMENDS',1.2,'{}',datetime('now'),datetime('now')),
('rec3','calvarybible','stage_new_believer','topic_assurance','RECOMMENDS',1.1,'{}',datetime('now'),datetime('now')),
('rec4','calvarybible','stage_gospel_clarity','topic_gospel','RECOMMENDS',1.1,'{}',datetime('now'),datetime('now')),
('rec_connected_parents','calvarybible','stage_connected','comm_parents_group','RECOMMENDS',1.05,'{}',datetime('now'),datetime('now')),
('u1','calvarybible','ms_baptism','stage_connected','UNLOCKS',1.0,'{}',datetime('now'),datetime('now'));

-- Journey content docs (KB-friendly) + linkages
INSERT OR REPLACE INTO content_docs (id, church_id, entity_type, entity_id, locale, title, body_markdown, created_at, updated_at) VALUES
('doc_scripture_john3_16','calvarybible','scripture_ref','John 3:16','en','John 3:16','Reference only (no stored translation text).\\n\\n- Ref: John 3:16\\n- Link: https://www.openbible.info/labs/cross-references/search?q=John%203%3A16',datetime('now'),datetime('now')),
('doc_scripture_eph2_8_9','calvarybible','scripture_ref','Ephesians 2:8-9','en','Ephesians 2:8–9','Reference only (no stored translation text).\\n\\n- Ref: Ephesians 2:8–9\\n- Link: https://www.openbible.info/labs/cross-references/search?q=Ephesians%202%3A8-9',datetime('now'),datetime('now')),
('doc_scripture_rom3_23_24','calvarybible','scripture_ref','Romans 3:23-24','en','Romans 3:23–24','Reference only (no stored translation text).\\n\\n- Ref: Romans 3:23–24\\n- Link: https://www.openbible.info/labs/cross-references/search?q=Romans%203%3A23-24',datetime('now'),datetime('now')),
('doc_journey_topic_gospel','calvarybible','journey_topic','topic_gospel','en','The Gospel',
 '## The Gospel\\n\\nThe gospel is the good news that **Jesus Christ** lived the life we could not, died for our sins, and rose again. Salvation is **by grace through faith**, not by works.\\n\\n**Next step**: if you want, tell me what you think the gospel is in your own words.',
 datetime('now'),datetime('now')),
('doc_journey_topic_assurance','calvarybible','journey_topic','topic_assurance','en','Assurance of Salvation',
 '## Assurance of Salvation\\n\\nAssurance is confidence grounded in **Christ**—his character and promises—not in perfect feelings. If you are unsure, it is okay to ask honest questions and take one small step at a time.\\n\\n**Next step**: we can talk through what you are trusting and what you are afraid of.',
 datetime('now'),datetime('now')),
('doc_journey_step_talk_to_guide','calvarybible','journey_step','step_talk_to_guide','en','Talk with a Guide',
 '## Talk with a Guide\\n\\nA Guide is a trusted person who can listen, pray, and help you take the next step—at your pace.\\n\\n**Suggested**: ask for a 15-minute conversation after service or this week.',
 datetime('now'),datetime('now')),
('doc_journey_step_join_group','calvarybible','journey_step','step_join_group','en','Join a Group',
 '## Join a Small Group\\n\\nFaith grows in community. A small group is a simple place to build friendships, ask questions, and pray together.\\n\\n**Suggested**: pick a group and attend once.',
 datetime('now'),datetime('now'));

INSERT OR REPLACE INTO journey_resource_link (link_id, church_id, node_id, resource_id, relevance, created_at) VALUES
('jrl_s1','calvarybible','stage_seeker','doc_scripture_john3_16',1.0,datetime('now')),
('jrl_s2','calvarybible','topic_gospel','doc_scripture_eph2_8_9',1.0,datetime('now')),
('jrl_s3','calvarybible','topic_gospel','doc_scripture_rom3_23_24',0.9,datetime('now')),
('jrl1','calvarybible','topic_gospel','doc_journey_topic_gospel',1.0,datetime('now')),
('jrl2','calvarybible','topic_assurance','doc_journey_topic_assurance',1.0,datetime('now')),
('jrl3','calvarybible','step_talk_to_guide','doc_journey_step_talk_to_guide',1.0,datetime('now')),
('jrl4','calvarybible','step_join_group','doc_journey_step_join_group',1.0,datetime('now'));

-- Link journey nodes to real ChurchCore entities (for CTAs in UI)
INSERT OR REPLACE INTO journey_entity_link (link_id, church_id, node_id, entity_type, entity_id, relevance, metadata_json, created_at) VALUES
('jel1','calvarybible','res_what_to_expect','resource','res1',1.0,'{}',datetime('now')),
('jel2','calvarybible','res_next_steps','resource','res2',1.0,'{}',datetime('now')),
('jel3','calvarybible','res_weekly_messages','resource','res_message_archive',1.0,'{\"cta\":\"Watch weekly messages\"}',datetime('now')),
('jel4','calvarybible','comm_parents_group','group','g2',1.0,'{}',datetime('now')),
('jel5','calvarybible','step_join_group','group','g1',0.9,'{\"cta\":\"Explore groups\"}',datetime('now')),
('jel6','calvarybible','step_interest_serving','opportunity','opp1',0.9,'{\"cta\":\"Serve on a team\"}',datetime('now'));

-- Person journey instance (seed)
INSERT OR REPLACE INTO person_journey_state (church_id, person_id, current_stage_id, confidence, updated_at) VALUES
('calvarybible','p_seeker_1','stage_new_believer',0.5,datetime('now')),
('calvarybible','p_seeker_2','stage_seeker',0.5,datetime('now'));

-- Person memory (seed from journey_state)
INSERT OR REPLACE INTO person_memory (church_id, person_id, memory_json, created_at, updated_at) VALUES
(
  'calvarybible',
  'p_seeker_2',
  '{"version":1,"summary":"Noah is exploring faith and planning a first visit to Calvary Bible Church.","identity":{"preferredName":"Noah","campusId":"campus_boulder"},"spiritualJourney":{"stage":"visit_planned","milestones":[]},"intentProfile":{"exploringFaith":true,"wantsCommunity":true},"pastoralCare":{"notes":[]},"updatedAt":"seed"}',
  datetime('now'),
  datetime('now')
);

-- Requests queue seed
INSERT OR REPLACE INTO requests (id, church_id, campus_id, user_id, type, status, payload_json, assigned_to_user_id, created_at, updated_at) VALUES
('req1','calvarybible',NULL,'local-user','prayer','open','{\"request\":\"Please pray for my family.\",\"isPrivate\":true}',NULL,datetime('now'),datetime('now')),
('req2','calvarybible',NULL,'local-user','pastoral_care','open','{\"request\":\"I would like to talk with a pastor.\",\"urgency\":\"normal\"}',NULL,datetime('now'),datetime('now'));

