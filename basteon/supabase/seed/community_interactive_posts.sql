-- Seed data for anonymous community interactive posts.
-- Requires base anonymous community migrations and 20261121000000_community_interactive_posts.sql.
-- Replace placeholder storage objects in the `community-images` bucket to display seeded images.
-- Note: seeded posts are inserted as official/Kiki posts (author_membership_id null, is_kiki true)
-- to satisfy community_posts_author_check and avoid depending on existing user memberships.

do $$
declare
  v_everyday_id uuid;
  v_kiki_tips_id uuid;
  v_fill_post_id uuid;
  v_cap_post_id uuid;
  v_ama_post_id uuid;
  v_quiz_post_id uuid;
begin
  select id into v_everyday_id from public.communities where slug = 'everyday-safety' limit 1;
  select id into v_kiki_tips_id from public.communities where slug = 'kiki-tips' limit 1;

  if v_everyday_id is null and v_kiki_tips_id is null then
    raise notice 'No seeded communities found; skipping interactive post seed.';
    return;
  end if;

  insert into public.community_stories (community_id, title, emoji, byline, body, starts_at, expires_at)
  values
    (null, 'Community Pulse', '🛡️', 'Kiki Official', 'Share calm, general safety habits. Keep names, locations, and contact details out of posts.', now(), now() + interval '30 days'),
    (v_everyday_id, 'Evening Check-in', '🌙', 'Kiki Safety Lab', 'Small routines help: let a trusted person know your plan and check in when you arrive.', now(), now() + interval '14 days'),
    (v_everyday_id, 'Image-only Posts', '🖼️', 'Kiki Editorial', 'You can add image carousels and per-image captions. Videos are not supported in communities.', now(), now() + interval '14 days'),
    (v_kiki_tips_id, 'Ask Before You Share', '💬', 'Kiki Official', 'Use AMA and question posts for general guidance. Kiki Guard removes identifying details before anything is shared.', now(), now() + interval '30 days')
  on conflict do nothing;

  -- 1. Post (text)
  insert into public.community_posts (community_id, author_membership_id, author_emoji, post_type, author_alias, is_kiki, title, body, category_group, config)
  values (coalesce(v_everyday_id, v_kiki_tips_id), null, '🪶', 'post', 'Kiki Safety Lab', true, null, 'A calm check-in can be as simple as: "I’m heading out now" and "I’ve arrived."', 'general', '{}'::jsonb);

  -- 2. Carousel
  insert into public.community_posts (id, community_id, author_membership_id, author_emoji, post_type, author_alias, is_kiki, title, body, category_group, config)
  values ('11111111-1111-4111-8111-111111111111', coalesce(v_everyday_id, v_kiki_tips_id), null, '🪶', 'carousel', 'Kiki Editorial', true, '3-Step Evening Commute Checklist', 'Swipe through each image for a quick reminder.', 'carousel', '{}'::jsonb);
  insert into public.community_post_media (post_id, position, storage_path, width, height, caption, alt_text) values
    ('11111111-1111-4111-8111-111111111111', 0, 'seed/carousel/step-1.jpg', 1200, 900, 'Share your plan with someone you trust.', 'Phone showing a message draft'),
    ('11111111-1111-4111-8111-111111111111', 1, 'seed/carousel/step-2.jpg', 1200, 900, 'Choose a well-lit route when possible.', 'A well-lit walkway'),
    ('11111111-1111-4111-8111-111111111111', 2, 'seed/carousel/step-3.jpg', 1200, 900, 'Check in when you arrive.', 'A calm arrival check-in');

  -- 3. Poll
  insert into public.community_posts (id, community_id, author_membership_id, author_emoji, post_type, author_alias, is_kiki, title, body, category_group, config)
  values ('22222222-2222-4222-8222-222222222222', coalesce(v_everyday_id, v_kiki_tips_id), null, '🪶', 'poll', 'Kiki Community', true, 'Which check-in habit feels easiest to keep?', 'Pick one. You can change your vote later.', 'vote', '{}'::jsonb);
  insert into public.community_post_options (id, post_id, position, label, sub_label) values
    ('22222222-2222-4222-8222-000000000001', '22222222-2222-4222-8222-222222222222', 0, 'Quick text before leaving', 'Simple and fast'),
    ('22222222-2222-4222-8222-000000000002', '22222222-2222-4222-8222-222222222222', 1, 'Share arrival time', 'Good for routines'),
    ('22222222-2222-4222-8222-000000000003', '22222222-2222-4222-8222-222222222222', 2, 'Check in when I arrive', 'Low effort');

  -- 4. This or that
  insert into public.community_posts (id, community_id, author_membership_id, author_emoji, post_type, author_alias, is_kiki, title, body, category_group, config)
  values ('33333333-3333-4333-8333-333333333333', coalesce(v_everyday_id, v_kiki_tips_id), null, '🦦', 'tt', 'Kiki Community', true, 'One Earbud Out vs Live Bubble Timer', 'Which helps you feel more aware?', 'vote', '{}'::jsonb);
  insert into public.community_post_options (id, post_id, position, label, sub_label) values
    ('33333333-3333-4333-8333-000000000001', '33333333-3333-4333-8333-333333333333', 0, 'One earbud out', 'Full ambient awareness'),
    ('33333333-3333-4333-8333-000000000002', '33333333-3333-4333-8333-333333333333', 1, 'Live bubble timer', 'Regular check-ins');

  -- 5. Slider
  insert into public.community_posts (id, community_id, author_membership_id, author_emoji, post_type, author_alias, is_kiki, title, body, category_group, config)
  values ('44444444-4444-4444-8444-444444444444', coalesce(v_everyday_id, v_kiki_tips_id), null, '🐢', 'slider', 'Kiki Community', true, 'How prepared do you feel for an evening commute?', 'Rate from 0 to 100.', 'vote', jsonb_build_object('lo', 'Not ready', 'hi', 'Very ready'));

  -- 6. Fill in the blank
  insert into public.community_posts (id, community_id, author_membership_id, author_emoji, post_type, author_alias, is_kiki, title, body, category_group, config)
  values ('55555555-5555-4555-8555-555555555555', coalesce(v_everyday_id, v_kiki_tips_id), null, '🪶', 'fill', 'Kiki Community', true, 'Complete the sentence', 'Keep it general and helpful.', 'prompts', jsonb_build_object('prefix', 'Before I head out, I always', 'suffix', 'so I feel prepared.'))
  returning id into v_fill_post_id;

  -- 7. Caption contest
  insert into public.community_posts (id, community_id, author_membership_id, author_emoji, post_type, author_alias, is_kiki, title, body, category_group, config)
  values ('66666666-6666-4666-8666-666666666666', coalesce(v_everyday_id, v_kiki_tips_id), null, '🪶', 'cap', 'Kiki Community', true, 'Caption this calm commute moment', 'Add a short, kind caption.', 'prompts', '{}'::jsonb)
  returning id into v_cap_post_id;
  insert into public.community_post_media (post_id, position, storage_path, width, height, caption, alt_text)
  values ('66666666-6666-4666-8666-666666666666', 0, 'seed/caption/calm-commute.jpg', 1200, 900, 'A calm, well-lit path at dusk.', 'Path lights at dusk');

  -- 8. Hot take
  insert into public.community_posts (id, community_id, author_membership_id, author_emoji, post_type, author_alias, is_kiki, title, body, category_group, config)
  values ('77777777-7777-4777-8777-777777777777', coalesce(v_everyday_id, v_kiki_tips_id), null, '🦊', 'hot', 'Kiki Community', true, 'Checking in is caring, not controlling.', 'Share your view and add nuance if helpful.', 'prompts', '{}'::jsonb);
  insert into public.community_post_options (id, post_id, position, label) values
    ('77777777-7777-4777-8777-000000000001', '77777777-7777-4777-8777-777777777777', 0, 'Agree'),
    ('77777777-7777-4777-8777-000000000002', '77777777-7777-4777-8777-777777777777', 1, 'Disagree');

  -- 9. Quiz
  insert into public.community_posts (id, community_id, author_membership_id, author_emoji, post_type, author_alias, is_kiki, title, body, category_group, config)
  values ('88888888-8888-4888-8888-888888888888', coalesce(v_kiki_tips_id, v_everyday_id), null, '🛡️', 'quiz', 'Kiki Safety Lab', true, 'What number can you call in South Africa for emergency help from a mobile phone?', 'Choose the best answer.', 'games', '{}'::jsonb)
  returning id into v_quiz_post_id;
  insert into public.community_post_options (id, post_id, position, label) values
    ('88888888-8888-4888-8888-000000000001', '88888888-8888-4888-8888-888888888888', 0, '112'),
    ('88888888-8888-4888-8888-000000000002', '88888888-8888-4888-8888-888888888888', 1, '12345'),
    ('88888888-8888-4888-8888-000000000003', '88888888-8888-4888-8888-888888888888', 2, '0800 000 000');
  insert into public.community_post_secrets (post_id, correct_option_id, explanation)
  values ('88888888-8888-4888-8888-888888888888', '88888888-8888-4888-8888-000000000001', '112 is a widely available emergency number from mobile phones in South Africa.');

  -- 10. Myth or fact
  insert into public.community_posts (id, community_id, author_membership_id, author_emoji, post_type, author_alias, is_kiki, title, body, category_group, config)
  values ('99999999-9999-4999-8999-999999999999', coalesce(v_kiki_tips_id, v_everyday_id), null, '🛡️', 'mf', 'Kiki Editorial', true, 'Sharing your live location with everyone nearby is always safer.', 'Is this a myth or a fact?', 'games', '{}'::jsonb);
  insert into public.community_post_options (id, post_id, position, label) values
    ('99999999-9999-4999-8999-000000000001', '99999999-9999-4999-8999-999999999999', 0, 'Myth'),
    ('99999999-9999-4999-8999-000000000002', '99999999-9999-4999-8999-999999999999', 1, 'Fact');
  insert into public.community_post_secrets (post_id, correct_option_id, explanation)
  values ('99999999-9999-4999-8999-999999999999', '99999999-9999-4999-8999-000000000001', 'Share location only with trusted people and only when needed.');

  -- 11. Hunt
  insert into public.community_posts (id, community_id, author_membership_id, author_emoji, post_type, author_alias, is_kiki, title, body, category_group, config)
  values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', coalesce(v_everyday_id, v_kiki_tips_id), null, '🪶', 'hunt', 'Kiki Safety Lab', true, 'Spot the helpful safety cues', 'Tap the image to find both cues.', 'games', jsonb_build_object('hit_radius', 10));
  insert into public.community_post_media (post_id, position, storage_path, width, height, caption, alt_text)
  values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 0, 'seed/hunt/street-cues.jpg', 1200, 900, 'Can you find the cues?', 'Street scene illustration');
  insert into public.community_hunt_targets (post_id, position, x, y, label) values
    ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 0, 28.00, 52.00, '24h Lit Storefront'),
    ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 1, 68.00, 71.00, 'Main Avenue Crossing');

  -- 12. Challenge
  insert into public.community_posts (id, community_id, author_membership_id, author_emoji, post_type, author_alias, is_kiki, title, body, category_group, config)
  values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', coalesce(v_everyday_id, v_kiki_tips_id), null, '🪶', 'chal', 'Kiki Community', true, '7-day calm check-in challenge', 'Join and check in once per day.', 'games', jsonb_build_object('days', 7));

  -- 13. AMA
  insert into public.community_posts (id, community_id, author_membership_id, author_emoji, post_type, author_alias, is_kiki, title, body, category_group, config)
  values ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', coalesce(v_kiki_tips_id, v_everyday_id), null, '🛡️', 'ama', 'Kiki Host', true, 'Ask Kiki about everyday safety habits', 'Ask a general question. Do not share personal details.', 'cocreate', '{}'::jsonb)
  returning id into v_ama_post_id;

  -- 14. Decide
  insert into public.community_posts (id, community_id, author_membership_id, author_emoji, post_type, author_alias, is_kiki, title, body, category_group, config, ends_at)
  values ('dddddddd-dddd-4ddd-8ddd-dddddddddddd', coalesce(v_everyday_id, v_kiki_tips_id), null, '🪶', 'decide', 'Kiki Community', true, 'What topic should we cover next week?', 'Vote to help choose.', 'cocreate', '{}'::jsonb, now() + interval '3 days');
  insert into public.community_post_options (id, post_id, position, label) values
    ('dddddddd-dddd-4ddd-8ddd-000000000001', 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', 0, 'Walking with confidence'),
    ('dddddddd-dddd-4ddd-8ddd-000000000002', 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', 1, 'Planning safer meetups'),
    ('dddddddd-dddd-4ddd-8ddd-000000000003', 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', 2, 'Digital privacy basics');

  -- 15. Choose your path
  insert into public.community_posts (id, community_id, author_membership_id, author_emoji, post_type, author_alias, is_kiki, title, body, category_group, config)
  values ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', coalesce(v_everyday_id, v_kiki_tips_id), null, '🪶', 'path', 'Kiki Safety Lab', true, 'Your phone drops to 8% battery…', 'Choose what you would do next.', 'cocreate', jsonb_build_object(
    'nodes', jsonb_build_array(
      jsonb_build_object('id', 'start', 't', 'Your phone drops to 8% battery while you are heading home.', 'ch', jsonb_build_array(
        jsonb_build_object('t', 'Send a quick check-in now', 'to', 'checkin', 'tip', 'A short update can be helpful while you still have battery.'),
        jsonb_build_object('t', 'Save battery and wait', 'to', 'save')
      )),
      jsonb_build_object('id', 'checkin', 't', 'You send a brief update to someone you trust.', 'end', true),
      jsonb_build_object('id', 'save', 't', 'You lower brightness and close apps to save power.', 'ch', jsonb_build_array(
        jsonb_build_object('t', 'Find a safe place to charge', 'to', 'charge'),
        jsonb_build_object('t', 'Keep moving quietly', 'to', 'move')
      )),
      jsonb_build_object('id', 'charge', 't', 'You look for a staffed, public place to charge if needed.', 'end', true),
      jsonb_build_object('id', 'move', 't', 'You keep your route simple and check in when you can.', 'end', true)
    )
  ));
end $$;