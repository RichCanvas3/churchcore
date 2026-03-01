PRAGMA foreign_keys = ON;

-- Seed for demo-church

-- Church / campus / locations
INSERT OR REPLACE INTO churches (
  id, name, legal_name, timezone, website,
  address_line1, city, region, postal_code, country,
  created_at, updated_at
) VALUES
('demo-church','Demo Church','Demo Church Inc.','America/Denver','https://example.com','123 Church St','Boulder','CO','80301','US',datetime('now'),datetime('now'));

INSERT OR REPLACE INTO campuses (
  id, church_id, name, timezone,
  address_line1, city, region, postal_code, country,
  created_at, updated_at
) VALUES
('campus_main','demo-church','Main Campus','America/Denver','123 Church St','Boulder','CO','80301','US',datetime('now'),datetime('now'));

INSERT OR REPLACE INTO locations (
  id, church_id, campus_id, name, address_line1, city, region, postal_code, country, notes,
  created_at, updated_at
) VALUES
('loc_sanctuary','demo-church','campus_main','Main Sanctuary','123 Church St','Boulder','CO','80301','US','Primary worship space',datetime('now'),datetime('now')),
('loc_hall','demo-church','campus_main','Fellowship Hall','123 Church St','Boulder','CO','80301','US','Meals + newcomer events',datetime('now'),datetime('now'));

-- People
INSERT OR REPLACE INTO people (
  id, church_id, campus_id, first_name, last_name, email, phone,
  created_at, updated_at
) VALUES
('p_seeker_1','demo-church','campus_main','Ava','Seeker','ava.seeker@example.com','+15550000001',datetime('now'),datetime('now')),
('p_seeker_2','demo-church','campus_main','Noah','Seeker','noah.seeker@example.com','+15550000002',datetime('now'),datetime('now')),
('p_leader_1','demo-church','campus_main','Grace','Leader','grace.leader@example.com','+15550000003',datetime('now'),datetime('now'));

-- Roles for guide demo userId=local-guide
INSERT OR REPLACE INTO roles (id, church_id, user_id, role, created_at) VALUES
('r1','demo-church','local-guide','guide',datetime('now')),
('r2','demo-church','local-guide','staff',datetime('now'));

INSERT OR REPLACE INTO memberships (id, church_id, user_id, status, updated_at) VALUES
('m1','demo-church','local-user','guest',datetime('now')),
('m2','demo-church','local-guide','member',datetime('now'));

-- Default app-user -> person binding (Noah Seeker)
INSERT OR REPLACE INTO user_person_bindings (church_id, user_id, person_id, created_at, updated_at) VALUES
('demo-church','demo_user_noah','p_seeker_2',datetime('now'),datetime('now'));

-- Seed chat topics for Noah
INSERT OR REPLACE INTO chat_threads (id, church_id, user_id, title, status, created_at, updated_at) VALUES
('thread_noah_general','demo-church','demo_user_noah','General','active',datetime('now'),datetime('now')),
('thread_noah_visiting','demo-church','demo_user_noah','Planning a visit','active',datetime('now'),datetime('now'));

INSERT OR REPLACE INTO chat_messages (id, church_id, thread_id, sender_type, content, envelope_json, created_at) VALUES
('msg_noah_1','demo-church','thread_noah_general','assistant','Hi Noah — how can I help today?',NULL,datetime('now'));

-- Services
INSERT OR REPLACE INTO services (
  id, church_id, campus_id, name, day_of_week, start_time_local, duration_minutes, timezone,
  location_name, location_address, created_at, updated_at
) VALUES
('svc1','demo-church','campus_main','Sunday Gathering',0,'09:00',75,'America/Denver','Main Sanctuary','123 Church St',datetime('now'),datetime('now')),
('svc2','demo-church','campus_main','Sunday Gathering',0,'11:00',75,'America/Denver','Main Sanctuary','123 Church St',datetime('now'),datetime('now')),
('svc3','demo-church','campus_main','Midweek Prayer',3,'19:00',60,'America/Denver','Chapel','123 Church St',datetime('now'),datetime('now'));

-- Service plan (example run-of-show)
INSERT OR REPLACE INTO service_plans (id, church_id, campus_id, service_id, title, starts_at, ends_at, created_at, updated_at) VALUES
('plan1','demo-church','campus_main','svc1','Sunday Gathering Plan',datetime('now','+2 days'),datetime('now','+2 days','+90 minutes'),datetime('now'),datetime('now'));

INSERT OR REPLACE INTO service_plan_items (id, church_id, plan_id, sort_order, item_type, title, notes, duration_minutes, created_at, updated_at) VALUES
('item1','demo-church','plan1',10,'welcome','Welcome','Quick welcome + announcements',3,datetime('now'),datetime('now')),
('item2','demo-church','plan1',20,'song','Song: Amazing Grace','Key: G',5,datetime('now'),datetime('now')),
('item3','demo-church','plan1',30,'prayer','Prayer','',3,datetime('now'),datetime('now')),
('item4','demo-church','plan1',40,'sermon','Message','Series: Hope',30,datetime('now'),datetime('now'));

-- Events
INSERT OR REPLACE INTO events (
  id, church_id, campus_id, title, description, start_at, end_at,
  location_name, location_address, created_at, updated_at
) VALUES
('ev1','demo-church','campus_main','Welcome Lunch','Meet pastors and new friends.',datetime('now','+3 days'),datetime('now','+3 days','+2 hours'),'Fellowship Hall','123 Church St',datetime('now'),datetime('now')),
('ev2','demo-church','campus_main','Serve Team Night','Learn about serving teams.',datetime('now','+10 days'),datetime('now','+10 days','+90 minutes'),'Room 201','123 Church St',datetime('now'),datetime('now'));

-- Outreach campaign
INSERT OR REPLACE INTO outreach_campaigns (id, church_id, campus_id, title, description, start_at, end_at, status, created_at, updated_at) VALUES
('out1','demo-church','campus_main','Neighborhood Cookout','Invite neighbors for food + conversation.',datetime('now','+14 days'),datetime('now','+14 days','+3 hours'),'active',datetime('now'),datetime('now'));

-- Groups
INSERT OR REPLACE INTO groups (
  id, church_id, campus_id, name, description, leader_person_id, meeting_details, is_open,
  created_at, updated_at
) VALUES
('g1','demo-church','campus_main','Young Adults Group','Weekly discussion + dinner.','p_leader_1','Thursdays 6:30pm @ leader home',1,datetime('now'),datetime('now')),
('g2','demo-church','campus_main','Parents Group','Monthly support + prayer.','p_leader_1','2nd Tuesday 8:00pm (Zoom)',1,datetime('now'),datetime('now'));

INSERT OR REPLACE INTO group_memberships (church_id, group_id, person_id, role, status, joined_at) VALUES
('demo-church','g1','p_seeker_1','member','active',datetime('now')),
('demo-church','g2','p_seeker_2','member','active',datetime('now'));

-- Opportunities
INSERT OR REPLACE INTO opportunities (
  id, church_id, campus_id, title, description, contact_email, created_at, updated_at
) VALUES
('opp1','demo-church','campus_main','Kids Check-in','Help families check kids in on Sundays.','serve@example.com',datetime('now'),datetime('now')),
('opp2','demo-church','campus_main','Hospitality Team','Welcome guests at the doors.','serve@example.com',datetime('now'),datetime('now'));

-- Resources (KB-friendly)
INSERT OR REPLACE INTO resources (id, church_id, campus_id, title, body_markdown, visibility, created_at, updated_at) VALUES
('res1','demo-church','campus_main','What to expect on Sunday', 'Most Sundays include music, a message, prayer, and time to meet people. Dress is casual. You are welcome even if you are unsure what you believe.', 'public', datetime('now'), datetime('now')),
('res2','demo-church','campus_main','Next steps', 'Suggested next steps: attend a service, join a group, request contact, or explore serving.', 'public', datetime('now'), datetime('now'));

-- Content docs stored in D1 (instead of local markdown files)
INSERT OR REPLACE INTO content_docs (id, church_id, entity_type, entity_id, locale, title, body_markdown, created_at, updated_at) VALUES
('doc_faq','demo-church','faq','general','en','FAQ','## Is it okay to come if I''m not sure what I believe?\\n\\nYes. You are welcome to ask honest questions and take next steps at your own pace.\\n\\n## How do I get connected?\\n\\n- Join a group\\n- Attend a newcomer event\\n- Request contact', datetime('now'), datetime('now'));

-- Assignments (guide local-guide shepherds 2 seekers)
INSERT OR REPLACE INTO assignments (id, church_id, seeker_id, guide_user_id, assigned_at) VALUES
('a1','demo-church','p_seeker_1','local-guide',datetime('now')),
('a2','demo-church','p_seeker_2','local-guide',datetime('now'));

-- Journey state
INSERT OR REPLACE INTO journey_state (id, church_id, seeker_id, state_json, updated_at) VALUES
('js1','demo-church','p_seeker_1','{\"stage\":\"new\",\"lastTouch\":\"seed\"}',datetime('now')),
('js2','demo-church','p_seeker_2','{\"stage\":\"visit_planned\",\"lastTouch\":\"seed\"}',datetime('now'));

-- Requests queue seed
INSERT OR REPLACE INTO requests (id, church_id, campus_id, user_id, type, status, payload_json, assigned_to_user_id, created_at, updated_at) VALUES
('req1','demo-church',NULL,'local-user','prayer','open','{\"request\":\"Please pray for my family.\",\"isPrivate\":true}',NULL,datetime('now'),datetime('now')),
('req2','demo-church',NULL,'local-user','pastoral_care','open','{\"request\":\"I would like to talk with a pastor.\",\"urgency\":\"normal\"}',NULL,datetime('now'),datetime('now'));

