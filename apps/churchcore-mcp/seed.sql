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

INSERT OR REPLACE INTO people (
  id, church_id, campus_id, first_name, last_name, birthdate,
  created_at, updated_at
) VALUES
('p_child_1','demo-church','campus_main','Mia','Seeker','2021-06-01',datetime('now'),datetime('now'));

-- Household for Noah + child (kids check-in demo)
INSERT OR REPLACE INTO households (id, church_id, name, created_at, updated_at) VALUES
('hh_noah_1','demo-church','Seeker Household',datetime('now'),datetime('now'));

INSERT OR REPLACE INTO household_contacts (id, church_id, household_id, contact_type, contact_value, is_primary, created_at, updated_at) VALUES
('hc_noah_phone','demo-church','hh_noah_1','phone','+15550000002',1,datetime('now'),datetime('now')),
('hc_noah_email','demo-church','hh_noah_1','email','noah.seeker@example.com',1,datetime('now'),datetime('now')),
('hc_ava_phone','demo-church','hh_noah_1','phone','+15550000001',0,datetime('now'),datetime('now')),
('hc_ava_email','demo-church','hh_noah_1','email','ava.seeker@example.com',0,datetime('now'),datetime('now'));

INSERT OR REPLACE INTO household_members (household_id, person_id, role) VALUES
('hh_noah_1','p_seeker_2','adult'),
('hh_noah_1','p_seeker_1','adult'),
('hh_noah_1','p_child_1','child');

INSERT OR REPLACE INTO person_relationships (id, church_id, from_person_id, to_person_id, relationship_type, status, notes, created_at, updated_at) VALUES
('rel_noah_guardian','demo-church','p_seeker_2','p_child_1','guardian','active',NULL,datetime('now'),datetime('now')),
('rel_noah_pickup','demo-church','p_seeker_2','p_child_1','authorized_pickup','active',NULL,datetime('now'),datetime('now')),
('rel_ava_guardian','demo-church','p_seeker_1','p_child_1','guardian','active',NULL,datetime('now'),datetime('now')),
('rel_ava_pickup','demo-church','p_seeker_1','p_child_1','authorized_pickup','active',NULL,datetime('now'),datetime('now'));

INSERT OR REPLACE INTO child_profiles (person_id, church_id, grade, allergies, medical_notes, special_needs, custody_notes, created_at, updated_at) VALUES
('p_child_1','demo-church',NULL,'peanuts',NULL,0,NULL,datetime('now'),datetime('now'));

-- Roles for guide demo userId=local-guide
INSERT OR REPLACE INTO roles (id, church_id, user_id, role, created_at) VALUES
('r1','demo-church','local-guide','guide',datetime('now')),
('r2','demo-church','local-guide','staff',datetime('now'));

-- Volunteer role for Ava (kids classroom check-in assistant)
INSERT OR REPLACE INTO roles (id, church_id, user_id, role, created_at) VALUES
('r3','demo-church','demo_user_ava','volunteer',datetime('now'));

INSERT OR REPLACE INTO memberships (id, church_id, user_id, status, updated_at) VALUES
('m1','demo-church','local-user','guest',datetime('now')),
('m2','demo-church','local-guide','member',datetime('now'));

-- Default app-user -> person binding (Noah Seeker)
INSERT OR REPLACE INTO user_person_bindings (church_id, user_id, person_id, created_at, updated_at) VALUES
('demo-church','demo_user_noah','p_seeker_2',datetime('now'),datetime('now'));

-- Default app-user -> person binding (Ava Seeker)
INSERT OR REPLACE INTO user_person_bindings (church_id, user_id, person_id, created_at, updated_at) VALUES
('demo-church','demo_user_ava','p_seeker_1',datetime('now'),datetime('now'));

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

-- Kids check-in config
INSERT OR REPLACE INTO checkin_areas (id, church_id, campus_id, name, kind, created_at, updated_at) VALUES
('area_kids_main','demo-church','campus_main','Kids Check-in','kids',datetime('now'),datetime('now'));

INSERT OR REPLACE INTO checkin_rooms (id, church_id, campus_id, area_id, name, min_age_months, max_age_months, min_grade, max_grade, capacity, notes, created_at, updated_at) VALUES
('room_kids_preschool','demo-church','campus_main','area_kids_main','Preschool (3-5)',36,71,NULL,NULL,24,'Allergies must be shown on label',datetime('now'),datetime('now')),
('room_kids_early','demo-church','campus_main','area_kids_main','Early Elementary (K-2)',72,119,'K','2',30,NULL,datetime('now'),datetime('now'));

INSERT OR REPLACE INTO checkin_schedules (id, church_id, campus_id, service_plan_id, area_id, opens_at, closes_at, created_at, updated_at) VALUES
('sched_plan1_kids','demo-church','campus_main','plan1','area_kids_main',datetime('now','+2 days','-30 minutes'),datetime('now','+2 days','+30 minutes'),datetime('now'),datetime('now'));

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

-- Evangelical faith journey graph (canonical)
INSERT OR REPLACE INTO journey_node (node_id, church_id, node_type, title, summary, metadata_json, created_at, updated_at) VALUES
('stage_seeker','demo-church','Stage','Seeker','Exploring faith, asking questions.','{}',datetime('now'),datetime('now')),
('stage_gospel_clarity','demo-church','Stage','Gospel Clarity','Understands the gospel and its implications.','{}',datetime('now'),datetime('now')),
('stage_conversion','demo-church','Stage','Conversion','Responded to Christ with repentance and faith.','{}',datetime('now'),datetime('now')),
('stage_new_believer','demo-church','Stage','New Believer','Early formation, assurance, basic practices.','{}',datetime('now'),datetime('now')),
('stage_connected','demo-church','Stage','Connected','Belongs in community and participates regularly.','{}',datetime('now'),datetime('now')),
('stage_growing','demo-church','Stage','Growing Disciple','Developing habits, doctrine, obedience.','{}',datetime('now'),datetime('now')),
('stage_serving','demo-church','Stage','Serving','Using gifts to build up the church.','{}',datetime('now'),datetime('now')),
('stage_multiplying','demo-church','Stage','Multiplying','Sharing faith and discipling others.','{}',datetime('now'),datetime('now')),
('stage_leader','demo-church','Stage','Leader','Shepherding others with recognized responsibility.','{}',datetime('now'),datetime('now')),

('ms_understood_gospel','demo-church','Milestone','Understood the Gospel','Can explain the gospel in their own words.','{}',datetime('now'),datetime('now')),
('ms_profession_faith','demo-church','Milestone','Profession of Faith','Expressed repentance and faith in Christ.','{}',datetime('now'),datetime('now')),
('ms_baptism','demo-church','Milestone','Baptism','Public identification with Christ.','{}',datetime('now'),datetime('now')),
('ms_joined_group','demo-church','Milestone','Joined a Small Group','Connected into ongoing community.','{}',datetime('now'),datetime('now')),
('ms_foundations_class','demo-church','Milestone','Completed Foundations','Completed core beliefs / discipleship class.','{}',datetime('now'),datetime('now')),
('ms_started_serving','demo-church','Milestone','Started Serving','Serving on a team consistently.','{}',datetime('now'),datetime('now')),
('ms_shared_testimony','demo-church','Milestone','Shared Testimony','Able to share story clearly.','{}',datetime('now'),datetime('now')),

('pr_bible','demo-church','Practice','Bible Reading','Regular Scripture intake.','{}',datetime('now'),datetime('now')),
('pr_prayer','demo-church','Practice','Prayer','Daily prayer rhythm.','{}',datetime('now'),datetime('now')),
('pr_worship_gathering','demo-church','Practice','Worship Gathering','Regular Sunday gathering participation.','{}',datetime('now'),datetime('now')),
('pr_community','demo-church','Practice','Community Participation','Meaningful relationships and mutual care.','{}',datetime('now'),datetime('now')),
('pr_generosity','demo-church','Practice','Generosity','Regular generosity as worship and love of neighbor.','{}',datetime('now'),datetime('now')),
('pr_serving','demo-church','Practice','Serving','Using gifts to build up the church.','{}',datetime('now'),datetime('now')),
('pr_evangelism','demo-church','Practice','Evangelism','Prayerfully sharing faith and inviting others.','{}',datetime('now'),datetime('now')),
('pr_sabbath','demo-church','Practice','Sabbath/Rest','Healthy rhythms of rest and trust.','{}',datetime('now'),datetime('now')),
('pr_scripture_memory','demo-church','Practice','Scripture Memory','Hiding God’s word in your heart.','{}',datetime('now'),datetime('now')),
('pr_confession','demo-church','Practice','Confession & Repentance','Regular honesty and turning back to God.','{}',datetime('now'),datetime('now')),

('topic_gospel','demo-church','DoctrineTopic','The Gospel','Jesus, sin, grace, faith, new life.','{}',datetime('now'),datetime('now')),
('topic_assurance','demo-church','DoctrineTopic','Assurance of Salvation','Confidence grounded in Christ.','{}',datetime('now'),datetime('now')),
('topic_scripture','demo-church','DoctrineTopic','Scripture (Authority & Reading)','Why the Bible matters and how to read it.','{}',datetime('now'),datetime('now')),
('topic_trinity','demo-church','DoctrineTopic','Trinity','Father, Son, and Holy Spirit.','{}',datetime('now'),datetime('now')),
('topic_jesus','demo-church','DoctrineTopic','Jesus (Person & Work)','Incarnation, atonement, resurrection.','{}',datetime('now'),datetime('now')),
('topic_salvation','demo-church','DoctrineTopic','Salvation (Grace/Faith)','Justification and sanctification.','{}',datetime('now'),datetime('now')),
('topic_holy_spirit','demo-church','DoctrineTopic','Holy Spirit','New birth, empowerment, guidance.','{}',datetime('now'),datetime('now')),
('topic_church','demo-church','DoctrineTopic','Church & Ordinances','Community, baptism, communion.','{}',datetime('now'),datetime('now')),
('topic_prayer','demo-church','DoctrineTopic','Prayer','Talking with God, dependence, intercession.','{}',datetime('now'),datetime('now')),
('topic_suffering','demo-church','DoctrineTopic','Suffering & Evil','God’s goodness amid pain.','{}',datetime('now'),datetime('now')),
('topic_ethics','demo-church','DoctrineTopic','Christian Ethics','Holiness, love of neighbor, integrity.','{}',datetime('now'),datetime('now')),
('topic_mission','demo-church','DoctrineTopic','Mission','Making disciples and blessing the world.','{}',datetime('now'),datetime('now')),

('barrier_doubt','demo-church','Barrier','Doubt/Uncertainty','Questions about faith, truth, or salvation.','{}',datetime('now'),datetime('now')),
('barrier_shame','demo-church','Barrier','Shame/Guilt','Feels unworthy or stuck in regret.','{}',datetime('now'),datetime('now')),
('barrier_church_hurt','demo-church','Barrier','Church Hurt','Painful experiences with church/Christians.','{}',datetime('now'),datetime('now')),
('barrier_assurance_anxiety','demo-church','Barrier','Assurance Anxiety','Fear about salvation / “am I really saved?”.','{}',datetime('now'),datetime('now')),
('barrier_addictions','demo-church','Barrier','Addictions/Habits','Stuck patterns that feel stronger than willpower.','{}',datetime('now'),datetime('now')),
('barrier_loneliness','demo-church','Barrier','Loneliness','Lack of meaningful community.','{}',datetime('now'),datetime('now')),
('barrier_relationship_conflict','demo-church','Barrier','Relationship Conflict','Marriage/family/friend conflict and strain.','{}',datetime('now'),datetime('now')),
('barrier_anxiety_depression','demo-church','Barrier','Anxiety/Depression','Persistent anxiety/depression symptoms (handle carefully).','{\"safety\":\"route_to_humans\"}',datetime('now'),datetime('now')),

('step_talk_to_guide','demo-church','ActionStep','Talk with a Guide','Schedule a 15-minute conversation with a church guide.','{\"cta\":\"Talk with a guide\",\"tool\":\"guide\"}',datetime('now'),datetime('now')),
('step_attend_sunday','demo-church','ActionStep','Attend a Sunday Gathering','Pick a service time and attend in person.','{\"cta\":\"Plan a visit\",\"tool\":\"chat\"}',datetime('now'),datetime('now')),
('step_join_group','demo-church','ActionStep','Join a Small Group','Pick a group and attend this week.','{\"cta\":\"Find a group\",\"tool\":\"groups\"}',datetime('now'),datetime('now')),
('step_start_bible_plan','demo-church','ActionStep','Start a Bible Reading Plan','Choose a simple plan and start this week.','{\"cta\":\"Start a plan\",\"tool\":\"faith_journey\"}',datetime('now'),datetime('now')),
('step_request_prayer','demo-church','ActionStep','Request Prayer','Share a prayer request and we’ll pray with you.','{\"cta\":\"Request prayer\",\"tool\":\"care_pastoral\"}',datetime('now'),datetime('now')),
('step_foundations_class','demo-church','ActionStep','Join Foundations Class','Join the next Foundations class cohort.','{\"cta\":\"Join class\",\"tool\":\"groups\"}',datetime('now'),datetime('now')),
('step_interest_serving','demo-church','ActionStep','Explore Serving','Tell us where you’d like to serve.','{\"cta\":\"Serve\",\"tool\":\"teams_skills\"}',datetime('now'),datetime('now'));

-- Resources / communities tied to real ChurchCore records
INSERT OR REPLACE INTO journey_node (node_id, church_id, node_type, title, summary, metadata_json, created_at, updated_at) VALUES
('res_what_to_expect','demo-church','Resource','What to expect on Sunday','A simple overview of what a Sunday gathering is like.','{\"entity_type\":\"resource\",\"entity_id\":\"res1\",\"tool\":\"resource\"}',datetime('now'),datetime('now')),
('res_next_steps','demo-church','Resource','Next steps','Suggested next steps at Demo Church.','{\"entity_type\":\"resource\",\"entity_id\":\"res2\",\"tool\":\"resource\"}',datetime('now'),datetime('now')),
('comm_parents_group','demo-church','Community','Parents Group','Monthly support + prayer.','{\"entity_type\":\"group\",\"entity_id\":\"g2\",\"tool\":\"groups\"}',datetime('now'),datetime('now'));

INSERT OR REPLACE INTO journey_edge (edge_id, church_id, from_node_id, to_node_id, edge_type, weight, metadata_json, created_at, updated_at) VALUES
('e1','demo-church','stage_seeker','stage_gospel_clarity','NEXT_STAGE',1.0,'{}',datetime('now'),datetime('now')),
('e2','demo-church','stage_gospel_clarity','stage_conversion','NEXT_STAGE',1.0,'{}',datetime('now'),datetime('now')),
('e3','demo-church','stage_conversion','stage_new_believer','NEXT_STAGE',1.0,'{}',datetime('now'),datetime('now')),
('e4','demo-church','stage_new_believer','stage_connected','NEXT_STAGE',1.0,'{}',datetime('now'),datetime('now')),
('e5','demo-church','stage_connected','stage_growing','NEXT_STAGE',1.0,'{}',datetime('now'),datetime('now')),
('e6','demo-church','stage_growing','stage_serving','NEXT_STAGE',1.0,'{}',datetime('now'),datetime('now')),
('e7','demo-church','stage_serving','stage_multiplying','NEXT_STAGE',1.0,'{}',datetime('now'),datetime('now')),
('e8','demo-church','stage_multiplying','stage_leader','NEXT_STAGE',1.0,'{}',datetime('now'),datetime('now')),

('rec_seeker_guide','demo-church','stage_seeker','step_talk_to_guide','RECOMMENDS',1.3,'{}',datetime('now'),datetime('now')),
('rec_seeker_gospel','demo-church','stage_seeker','topic_gospel','RECOMMENDS',1.2,'{}',datetime('now'),datetime('now')),
('rec_seeker_expect','demo-church','stage_seeker','res_what_to_expect','RECOMMENDS',1.1,'{}',datetime('now'),datetime('now')),
('rec_seeker_attend','demo-church','stage_seeker','step_attend_sunday','RECOMMENDS',1.15,'{}',datetime('now'),datetime('now')),
('rec_seeker_prayer','demo-church','stage_seeker','step_request_prayer','RECOMMENDS',1.05,'{}',datetime('now'),datetime('now')),

('r1','demo-church','stage_gospel_clarity','ms_understood_gospel','REQUIRES',1.2,'{}',datetime('now'),datetime('now')),
('rec_gospel_scripture','demo-church','stage_gospel_clarity','topic_scripture','RECOMMENDS',1.05,'{}',datetime('now'),datetime('now')),
('rec_gospel_next','demo-church','stage_gospel_clarity','res_next_steps','RECOMMENDS',1.0,'{}',datetime('now'),datetime('now')),
('r2','demo-church','stage_conversion','ms_profession_faith','REQUIRES',1.2,'{}',datetime('now'),datetime('now')),
('rec_conversion_guide','demo-church','stage_conversion','step_talk_to_guide','RECOMMENDS',1.2,'{}',datetime('now'),datetime('now')),
('r3','demo-church','stage_new_believer','pr_bible','REQUIRES',1.0,'{}',datetime('now'),datetime('now')),
('r4','demo-church','stage_new_believer','pr_prayer','REQUIRES',1.0,'{}',datetime('now'),datetime('now')),
('rec_newbeliever_assurance','demo-church','stage_new_believer','topic_assurance','RECOMMENDS',1.15,'{}',datetime('now'),datetime('now')),
('rec_newbeliever_bibleplan','demo-church','stage_new_believer','step_start_bible_plan','RECOMMENDS',1.1,'{}',datetime('now'),datetime('now')),
('r5','demo-church','stage_connected','ms_joined_group','REQUIRES',1.1,'{}',datetime('now'),datetime('now')),
('rec_connected_group','demo-church','stage_connected','step_join_group','RECOMMENDS',1.2,'{}',datetime('now'),datetime('now')),
('r6','demo-church','stage_growing','ms_foundations_class','REQUIRES',1.0,'{}',datetime('now'),datetime('now')),
('rec_growing_foundations','demo-church','stage_growing','step_foundations_class','RECOMMENDS',1.15,'{}',datetime('now'),datetime('now')),
('r7','demo-church','stage_serving','ms_started_serving','REQUIRES',1.0,'{}',datetime('now'),datetime('now')),
('rec_serving_explore','demo-church','stage_serving','step_interest_serving','RECOMMENDS',1.15,'{}',datetime('now'),datetime('now')),

('b1','demo-church','stage_gospel_clarity','barrier_doubt','BLOCKED_BY',1.0,'{}',datetime('now'),datetime('now')),
('b2','demo-church','stage_conversion','barrier_shame','BLOCKED_BY',1.0,'{}',datetime('now'),datetime('now')),

('rec1','demo-church','barrier_doubt','step_talk_to_guide','RESOLVED_BY',1.3,'{}',datetime('now'),datetime('now')),
('rec1b','demo-church','barrier_doubt','topic_scripture','RESOLVED_BY',1.1,'{}',datetime('now'),datetime('now')),
('rec2','demo-church','stage_connected','step_join_group','RECOMMENDS',1.2,'{}',datetime('now'),datetime('now')),
('rec3','demo-church','stage_new_believer','topic_assurance','RECOMMENDS',1.1,'{}',datetime('now'),datetime('now')),
('rec4','demo-church','stage_gospel_clarity','topic_gospel','RECOMMENDS',1.1,'{}',datetime('now'),datetime('now')),
('rec_connected_parents','demo-church','stage_connected','comm_parents_group','RECOMMENDS',1.05,'{}',datetime('now'),datetime('now')),
('u1','demo-church','ms_baptism','stage_connected','UNLOCKS',1.0,'{}',datetime('now'),datetime('now'));

-- Journey content docs (KB-friendly) + linkages
INSERT OR REPLACE INTO content_docs (id, church_id, entity_type, entity_id, locale, title, body_markdown, created_at, updated_at) VALUES
('doc_scripture_john3_16','demo-church','scripture_ref','John 3:16','en','John 3:16','Reference only (no stored translation text).\\n\\n- Ref: John 3:16\\n- Link: https://www.openbible.info/labs/cross-references/search?q=John%203%3A16',datetime('now'),datetime('now')),
('doc_scripture_eph2_8_9','demo-church','scripture_ref','Ephesians 2:8-9','en','Ephesians 2:8–9','Reference only (no stored translation text).\\n\\n- Ref: Ephesians 2:8–9\\n- Link: https://www.openbible.info/labs/cross-references/search?q=Ephesians%202%3A8-9',datetime('now'),datetime('now')),
('doc_scripture_rom3_23_24','demo-church','scripture_ref','Romans 3:23-24','en','Romans 3:23–24','Reference only (no stored translation text).\\n\\n- Ref: Romans 3:23–24\\n- Link: https://www.openbible.info/labs/cross-references/search?q=Romans%203%3A23-24',datetime('now'),datetime('now')),
('doc_journey_topic_gospel','demo-church','journey_topic','topic_gospel','en','The Gospel',
 '## The Gospel\\n\\nThe gospel is the good news that **Jesus Christ** lived the life we could not, died for our sins, and rose again. Salvation is **by grace through faith**, not by works.\\n\\n**Next step**: if you want, tell me what you think the gospel is in your own words.',
 datetime('now'),datetime('now')),
('doc_journey_topic_assurance','demo-church','journey_topic','topic_assurance','en','Assurance of Salvation',
 '## Assurance of Salvation\\n\\nAssurance is confidence grounded in **Christ**—his character and promises—not in perfect feelings. If you are unsure, it is okay to ask honest questions and take one small step at a time.\\n\\n**Next step**: we can talk through what you are trusting and what you are afraid of.',
 datetime('now'),datetime('now')),
('doc_journey_step_talk_to_guide','demo-church','journey_step','step_talk_to_guide','en','Talk with a Guide',
 '## Talk with a Guide\\n\\nA Guide is a trusted person who can listen, pray, and help you take the next step—at your pace.\\n\\n**Suggested**: ask for a 15-minute conversation after service or this week.',
 datetime('now'),datetime('now')),
('doc_journey_step_join_group','demo-church','journey_step','step_join_group','en','Join a Small Group',
 '## Join a Small Group\\n\\nFaith grows in community. A small group is a simple place to build friendships, ask questions, and pray together.\\n\\n**Suggested**: pick a group and attend once.',
 datetime('now'),datetime('now'));

INSERT OR REPLACE INTO journey_resource_link (link_id, church_id, node_id, resource_id, relevance, created_at) VALUES
('jrl_s1','demo-church','stage_seeker','doc_scripture_john3_16',1.0,datetime('now')),
('jrl_s2','demo-church','topic_gospel','doc_scripture_eph2_8_9',1.0,datetime('now')),
('jrl_s3','demo-church','topic_gospel','doc_scripture_rom3_23_24',0.9,datetime('now')),
('jrl1','demo-church','topic_gospel','doc_journey_topic_gospel',1.0,datetime('now')),
('jrl2','demo-church','topic_assurance','doc_journey_topic_assurance',1.0,datetime('now')),
('jrl3','demo-church','step_talk_to_guide','doc_journey_step_talk_to_guide',1.0,datetime('now')),
('jrl4','demo-church','step_join_group','doc_journey_step_join_group',1.0,datetime('now'));

-- Link journey nodes to real ChurchCore entities (for CTAs in UI)
INSERT OR REPLACE INTO journey_entity_link (link_id, church_id, node_id, entity_type, entity_id, relevance, metadata_json, created_at) VALUES
('jel1','demo-church','res_what_to_expect','resource','res1',1.0,'{}',datetime('now')),
('jel2','demo-church','res_next_steps','resource','res2',1.0,'{}',datetime('now')),
('jel3','demo-church','comm_parents_group','group','g2',1.0,'{}',datetime('now')),
('jel4','demo-church','step_join_group','group','g2',0.9,'{\"cta\":\"Join Parents Group\"}',datetime('now')),
('jel5','demo-church','step_interest_serving','opportunity','opp1',0.9,'{\"cta\":\"Serve in Kids Check-in\"}',datetime('now'));

-- Person journey instance (seed)
INSERT OR REPLACE INTO person_journey_state (church_id, person_id, current_stage_id, confidence, updated_at) VALUES
('demo-church','p_seeker_1','stage_new_believer',0.5,datetime('now')),
('demo-church','p_seeker_2','stage_seeker',0.5,datetime('now'));

-- Person memory (seed from journey_state)
INSERT OR REPLACE INTO person_memory (church_id, person_id, memory_json, created_at, updated_at) VALUES
(
  'demo-church',
  'p_seeker_2',
  '{"version":1,"summary":"Noah is exploring faith and planning a first visit.","identity":{"preferredName":"Noah","campusId":"campus_main"},"spiritualJourney":{"stage":"visit_planned","milestones":[]},"intentProfile":{"exploringFaith":true,"wantsCommunity":true},"pastoralCare":{"notes":[]},"updatedAt":"seed"}',
  datetime('now'),
  datetime('now')
);

-- Requests queue seed
INSERT OR REPLACE INTO requests (id, church_id, campus_id, user_id, type, status, payload_json, assigned_to_user_id, created_at, updated_at) VALUES
('req1','demo-church',NULL,'local-user','prayer','open','{\"request\":\"Please pray for my family.\",\"isPrivate\":true}',NULL,datetime('now'),datetime('now')),
('req2','demo-church',NULL,'local-user','pastoral_care','open','{\"request\":\"I would like to talk with a pastor.\",\"urgency\":\"normal\"}',NULL,datetime('now'),datetime('now'));

