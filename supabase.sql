begin;
create schema if not exists element_private;
revoke all on schema element_private from public, anon, authenticated;

create table if not exists element_private.admins (
  user_id uuid primary key references auth.users(id) on delete cascade
);
create table if not exists element_private.answer_key (
  version text primary key,
  answers integer[] not null
);
insert into element_private.answer_key values ('element-v1',array[1,2,0,1,2,0,1,2,0,1])
on conflict (version) do nothing;

create table if not exists public.element_attempts (
  id uuid primary key default gen_random_uuid(),
  full_name text not null check(char_length(full_name) between 5 and 160),
  student_group text not null check(char_length(student_group) between 1 and 40),
  test_version text not null default 'element-v1',
  started_at timestamptz not null default now(),
  submitted_at timestamptz,
  answers integer[],
  score integer check(score between 0 and 10),
  grade integer check(grade between 2 and 5),
  check ((submitted_at is null and score is null and grade is null and answers is null)
      or (submitted_at is not null and score is not null and grade is not null and cardinality(answers)=10))
);
-- Токены не входят в доступную администратору таблицу попыток.
create table if not exists element_private.tokens (
  token uuid primary key,
  attempt_id uuid unique not null references public.element_attempts(id) on delete cascade
);
alter table public.element_attempts enable row level security;
alter table element_private.admins enable row level security;
alter table element_private.tokens enable row level security;
alter table element_private.answer_key enable row level security;
revoke all on public.element_attempts from public, anon, authenticated;
grant select on public.element_attempts to authenticated;

create or replace function element_private.is_admin()
returns boolean language sql stable security definer set search_path=''
as $$ select exists(select 1 from element_private.admins where user_id=(select auth.uid())); $$;
revoke all on function element_private.is_admin() from public, anon, authenticated;
grant usage on schema element_private to authenticated;
grant execute on function element_private.is_admin() to authenticated;
drop policy if exists element_admin_read on public.element_attempts;
create policy element_admin_read on public.element_attempts for select to authenticated
using ((select element_private.is_admin()));

create or replace function public.element_admin_check()
returns boolean language sql stable security invoker set search_path=''
as $$ select element_private.is_admin(); $$;
revoke all on function public.element_admin_check() from public, anon, authenticated;
grant execute on function public.element_admin_check() to authenticated;

create or replace function public.element_start(p_token uuid,p_name text,p_group text)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_id uuid; v_row public.element_attempts;
begin
 if p_token is null or p_name is null or p_group is null
    or char_length(btrim(p_name)) not between 5 and 160
    or btrim(p_name) !~ '[^[:space:]]+[[:space:]]+[^[:space:]]+'
    or char_length(btrim(p_group)) not between 1 and 40 then
   raise exception 'Проверьте ФИО и группу.';
 end if;
 perform pg_advisory_xact_lock(hashtextextended(p_token::text,0));
 select attempt_id into v_id from element_private.tokens where token=p_token;
 if v_id is not null then
   select * into v_row from public.element_attempts where id=v_id;
   if v_row.full_name<>btrim(p_name) or v_row.student_group<>btrim(p_group) then
     raise exception 'Данные попытки не совпадают.';
   end if;
   return jsonb_build_object('started',true);
 end if;
 insert into public.element_attempts(full_name,student_group)
 values(btrim(p_name),btrim(p_group)) returning id into v_id;
 insert into element_private.tokens values(p_token,v_id);
 return jsonb_build_object('started',true);
end $$;
revoke all on function public.element_start(uuid,text,text) from public, anon, authenticated;
grant execute on function public.element_start(uuid,text,text) to anon,authenticated;

create or replace function public.element_submit(p_token uuid,p_answers integer[])
returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_row public.element_attempts; v_key integer[]; v_score integer; v_grade integer; v_id uuid;
begin
 if p_token is null or p_answers is null or array_ndims(p_answers)<>1
   or array_lower(p_answers,1)<>1 or cardinality(p_answers)<>10 then
   raise exception 'Нужно ответить на все 10 вопросов.';
 end if;
 if exists(select 1 from unnest(p_answers) a where a is null or a not between 0 and 2) then
   raise exception 'Недопустимый вариант ответа.';
 end if;
 select attempt_id into v_id from element_private.tokens where token=p_token;
 if v_id is null then raise exception 'Попытка не найдена. Обратитесь к преподавателю.'; end if;
 select * into v_row from public.element_attempts where id=v_id for update;
 if v_row.submitted_at is not null then
   return jsonb_build_object('score',v_row.score,'grade',v_row.grade);
 end if;
 select answers into v_key from element_private.answer_key where version=v_row.test_version;
 if v_key is null then raise exception 'Нет ключа для версии теста.'; end if;
 select count(*)::integer into v_score from generate_series(1,10) i where p_answers[i]=v_key[i];
 v_grade=case when v_score>=9 then 5 when v_score>=7 then 4 when v_score>=5 then 3 else 2 end;
 update public.element_attempts set submitted_at=clock_timestamp(),answers=p_answers,score=v_score,grade=v_grade where id=v_id;
 return jsonb_build_object('score',v_score,'grade',v_grade);
end $$;
revoke all on function public.element_submit(uuid,integer[]) from public, anon, authenticated;
grant execute on function public.element_submit(uuid,integer[]) to anon,authenticated;

create or replace function public.element_admin_key()
returns integer[] language plpgsql stable security definer set search_path=''
as $$
begin
 if not element_private.is_admin() then raise exception 'Доступ запрещён.'; end if;
 return (select answers from element_private.answer_key where version='element-v1');
end $$;
revoke all on function public.element_admin_key() from public,anon,authenticated;
grant execute on function public.element_admin_key() to authenticated;
create index if not exists element_attempts_started_idx on public.element_attempts(started_at desc);
commit;

