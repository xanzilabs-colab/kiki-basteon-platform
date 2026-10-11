insert into public.teach_cards (
  id, topic_id, problem, tip, example, check_q, check_options, check_answer,
  tier, status, flagged, reviewed_by, reviewed_at
) values
  (
    '02000000-0000-0000-0000-000000000001', 'cv_and_jobs',
    'I am not sure what to include on a CV.',
    'Keep it easy to scan: put your contact details, a short introduction, relevant skills, and your experience or projects under clear headings. Match the skills you mention to the opportunity, and ask someone you trust to proofread it.',
    'For a first job, a school project or volunteer task can show useful skills when you explain what you did.',
    'What makes a CV easier to scan?',
    jsonb_build_array('Clear headings and relevant details', 'Using one long paragraph', 'Adding every detail about your life'),
    0, 'seed', 'approved', false, 'Kiki content review', now()
  ),
  (
    '02000000-0000-0000-0000-000000000002', 'budgeting',
    'My money runs out before the end of the month.',
    'Write down the money you expect and the expenses you can predict. Set aside essentials first, then choose a realistic limit for flexible spending. Check the plan once a week and adjust it without judging yourself.',
    'If transport costs change, update that line before deciding how much is left for treats.',
    'What is a useful first step for a simple budget?',
    jsonb_build_array('List expected money and expenses', 'Spend first and guess later', 'Ignore costs that change'),
    0, 'seed', 'approved', false, 'Kiki content review', now()
  ),
  (
    '02000000-0000-0000-0000-000000000003', 'small_business',
    'I have an idea for a small business but do not know where to start.',
    'Start with one small test: describe who might use the product, ask a few people what they need, and make a small sample or offer. Record what it costs and what people say before spending more.',
    'Try a small batch of a product before buying supplies for a large batch.',
    'Why test an idea on a small scale first?',
    jsonb_build_array('To learn what people need before spending more', 'To guarantee a profit', 'To avoid asking anyone for feedback'),
    0, 'seed', 'approved', false, 'Kiki content review', now()
  ),
  (
    '02000000-0000-0000-0000-000000000004', 'staying_safe_online',
    'I want to make my accounts harder to break into.',
    'Use a different long passphrase for each important account. Turn on two-step verification when it is available, and never share a one-time code with someone who contacts you unexpectedly.',
    'A password manager can help you keep unique passphrases without reusing one everywhere.',
    'What should you do with a one-time sign-in code?',
    jsonb_build_array('Keep it private, even from unexpected callers', 'Post it so you can find it later', 'Send it to anyone who asks'),
    0, 'seed', 'approved', false, 'Kiki content review', now()
  ),
  (
    '02000000-0000-0000-0000-000000000005', 'cooking_on_a_budget',
    'I want to plan filling meals without overspending.',
    'Before shopping, check what you already have and plan a few meals around affordable ingredients. Compare unit prices, choose flexible staples, and store food safely so it lasts as expected.',
    'Rice, beans, or vegetables can be used in more than one meal during the week.',
    'What can help keep a food shop within budget?',
    jsonb_build_array('Plan meals around ingredients you can reuse', 'Shop while hungry without a list', 'Buy the largest pack every time'),
    0, 'seed', 'approved', false, 'Kiki content review', now()
  ),
  (
    '02000000-0000-0000-0000-000000000006', 'study_skills',
    'I reread my notes but forget them later.',
    'After a short study section, close your notes and write or say what you remember. Check what you missed, then revisit it later in another short session. Practice questions can help you spot what needs more work.',
    'Make three questions from a page of notes and try answering them the next day.',
    'Which habit helps you check what you can recall?',
    jsonb_build_array('Answer practice questions without looking first', 'Reread the same page without pausing', 'Keep studying until you feel exhausted'),
    0, 'seed', 'approved', false, 'Kiki content review', now()
  ),
  (
    '02000000-0000-0000-0000-000000000007', 'wellbeing_habits',
    'I want a small routine that helps me feel more settled.',
    'Choose one gentle habit that fits your day, keep it small, and attach it to something you already do. If you miss a day, simply restart when you can. A routine is a support, not a test you have to pass.',
    'After brushing your teeth, take a moment to stretch or plan one thing for tomorrow.',
    'What is a helpful way to build a new routine?',
    jsonb_build_array('Start with one small habit you can repeat', 'Change every part of your day at once', 'Treat a missed day as failure'),
    0, 'seed', 'approved', false, 'Kiki content review', now()
  ),
  (
    '02000000-0000-0000-0000-000000000008', 'know_your_rights',
    'A form or instruction is difficult to understand.',
    'Ask the organization for a plain-language explanation and who can help with your next step. Keep a copy of anything you submit and note the date. Rules and services can differ by place, so check with a suitable local support organization when needed.',
    'Before you submit a form, ask which sections are required and keep a copy for your records.',
    'What can you do when an instruction is unclear?',
    jsonb_build_array('Ask the organization for an explanation', 'Guess and submit it without checking', 'Share the form publicly with personal details visible'),
    0, 'seed', 'approved', false, 'Kiki content review', now()
  )
on conflict (id) do update set
  topic_id = excluded.topic_id,
  problem = excluded.problem,
  tip = excluded.tip,
  example = excluded.example,
  check_q = excluded.check_q,
  check_options = excluded.check_options,
  check_answer = excluded.check_answer,
  tier = excluded.tier,
  status = excluded.status,
  flagged = excluded.flagged,
  reviewed_by = excluded.reviewed_by,
  reviewed_at = excluded.reviewed_at;
