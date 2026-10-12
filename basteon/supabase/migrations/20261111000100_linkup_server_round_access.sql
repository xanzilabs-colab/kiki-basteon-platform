begin;

grant select, insert, update
  on table public.linkup_rounds, public.linkup_answers
  to service_role;

commit;
