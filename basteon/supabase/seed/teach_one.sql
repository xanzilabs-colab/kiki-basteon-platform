insert into public.teach_topics (id, title, blurb, teen_ok, verified_only, sort) values
  ('cv_and_jobs','CVs and jobs','Get noticed by employers',true,false,1),
  ('budgeting','Budgeting','Make money stretch',true,false,2),
  ('small_business','Small business','Start and grow small',false,false,3),
  ('staying_safe_online','Staying safe online','Protect your accounts',true,false,4),
  ('cooking_on_a_budget','Cooking on a budget','Good food, small cost',true,false,5),
  ('study_skills','Study skills','Learn smarter',true,false,6),
  ('wellbeing_habits','Wellbeing habits','Small habits that help',true,false,7),
  ('know_your_rights','Know your rights','Verified authors only',false,true,8)
on conflict (id) do update set
  title = excluded.title,
  blurb = excluded.blurb,
  teen_ok = excluded.teen_ok,
  verified_only = excluded.verified_only,
  sort = excluded.sort;

insert into public.teach_cards (topic_id, problem, tip, example, check_q, check_options, check_answer, tier, status)
select seed.topic_id, seed.problem, seed.tip, seed.example, seed.check_q,
  seed.check_options::jsonb, seed.check_answer, 'seed', 'pending'
from (values
  ('budgeting','Money runs out before month end.','Split your income the day you get it: needs first, then a small saving, then the rest.','Salary day: set aside rent and transport first.','What do you set aside first?','["Fun money","Needs like rent and transport","Nothing"]',1),
  ('staying_safe_online','I worry about weak passwords.','Use a long phrase of 4 random words instead of one short word.','"blue-chair-river-tea" is stronger than "Password1".','Which is stronger?','["Password1","blue-chair-river-tea","123456"]',1),
  ('cv_and_jobs','My CV gets ignored.','Start with a 2-line summary, then list results, not duties.','"Cut waiting time by 20%" beats "Served customers".','What should a CV list?','["Only duties","Results you achieved","Your age"]',1)
) as seed(topic_id, problem, tip, example, check_q, check_options, check_answer)
where not exists (
  select 1 from public.teach_cards existing
  where existing.topic_id = seed.topic_id
    and existing.problem = seed.problem
    and existing.tier = 'seed'
);
