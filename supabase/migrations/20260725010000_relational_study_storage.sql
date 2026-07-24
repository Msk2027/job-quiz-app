create table if not exists public.study_storage_state (
  user_id uuid primary key references auth.users(id) on delete cascade,
  updated_at timestamptz not null default now()
);

create table if not exists public.study_subjects (
  user_id uuid not null references auth.users(id) on delete cascade,
  id text not null,
  name text not null,
  color text not null default '#3167e3',
  source jsonb,
  position integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

create table if not exists public.study_questions (
  user_id uuid not null,
  subject_id text not null,
  id text not null,
  question_type text not null,
  question text not null,
  options jsonb not null default '[]'::jsonb,
  answer text not null default '',
  explanation text not null default '',
  model_answer text not null default '',
  rubric text not null default '',
  position integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (user_id, subject_id, id),
  foreign key (user_id, subject_id)
    references public.study_subjects(user_id, id) on delete cascade
);

create table if not exists public.study_attempts (
  user_id uuid not null references auth.users(id) on delete cascade,
  id text not null,
  subject_id text not null default '',
  subject_ids jsonb,
  subject_names jsonb,
  display_date text not null,
  score integer not null default 0,
  total integer not null default 0,
  mode text,
  status text,
  pass_percentage numeric,
  percentage numeric,
  passed boolean,
  essay_pending boolean,
  time_limit_minutes integer,
  position integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

create table if not exists public.study_answers (
  user_id uuid not null,
  attempt_id text not null,
  answer_index integer not null,
  question_id text not null,
  subject_id text,
  subject_name text,
  question text,
  question_type text,
  answer text not null default '',
  correct boolean,
  correct_answer text,
  explanation text,
  model_answer text,
  rubric text,
  grading jsonb,
  primary key (user_id, attempt_id, answer_index),
  foreign key (user_id, attempt_id)
    references public.study_attempts(user_id, id) on delete cascade
);

create index if not exists study_subjects_user_position_idx
  on public.study_subjects(user_id, position);
create index if not exists study_questions_subject_position_idx
  on public.study_questions(user_id, subject_id, position);
create index if not exists study_attempts_user_position_idx
  on public.study_attempts(user_id, position);
create index if not exists study_answers_attempt_index_idx
  on public.study_answers(user_id, attempt_id, answer_index);

alter table public.study_storage_state enable row level security;
alter table public.study_subjects enable row level security;
alter table public.study_questions enable row level security;
alter table public.study_attempts enable row level security;
alter table public.study_answers enable row level security;

grant select, insert, update, delete on table
  public.study_storage_state,
  public.study_subjects,
  public.study_questions,
  public.study_attempts,
  public.study_answers
to authenticated;

drop policy if exists "Users manage own study storage state"
  on public.study_storage_state;
create policy "Users manage own study storage state"
  on public.study_storage_state for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Users manage own study subjects"
  on public.study_subjects;
create policy "Users manage own study subjects"
  on public.study_subjects for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Users manage own study questions"
  on public.study_questions;
create policy "Users manage own study questions"
  on public.study_questions for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Users manage own study attempts"
  on public.study_attempts;
create policy "Users manage own study attempts"
  on public.study_attempts for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Users manage own study answers"
  on public.study_answers;
create policy "Users manage own study answers"
  on public.study_answers for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create or replace function public.replace_study_subject(
  p_subject jsonb,
  p_updated_at timestamptz
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  current_subject_id text := p_subject->>'id';
begin
  if current_user_id is null or current_subject_id is null then
    raise exception 'Not authenticated or subject id missing';
  end if;

  insert into public.study_subjects (
    user_id, id, name, color, source, position, updated_at
  )
  values (
    current_user_id,
    current_subject_id,
    coalesce(p_subject->>'name', ''),
    coalesce(p_subject->>'color', '#3167e3'),
    p_subject->'source',
    coalesce((p_subject->>'position')::integer, 0),
    p_updated_at
  )
  on conflict (user_id, id) do update set
    name = excluded.name,
    color = excluded.color,
    source = excluded.source,
    position = excluded.position,
    updated_at = excluded.updated_at;

  delete from public.study_questions q
  where q.user_id = current_user_id
    and q.subject_id = current_subject_id
    and not exists (
      select 1
      from jsonb_array_elements(coalesce(p_subject->'questions', '[]'::jsonb))
        as question(value)
      where question.value->>'id' = q.id
    );

  insert into public.study_questions (
    user_id, subject_id, id, question_type, question, options, answer,
    explanation, model_answer, rubric, position, updated_at
  )
  select
    current_user_id,
    current_subject_id,
    question_id,
    coalesce(value->>'type', 'choice'),
    coalesce(value->>'question', ''),
    coalesce(value->'options', '[]'::jsonb),
    coalesce(value->>'answer', ''),
    coalesce(value->>'explanation', ''),
    coalesce(value->>'modelAnswer', ''),
    coalesce(value->>'rubric', ''),
    position,
    p_updated_at
  from (
    select distinct on (value->>'id')
      value->>'id' as question_id,
      value,
      ordinality::integer - 1 as position
    from jsonb_array_elements(coalesce(p_subject->'questions', '[]'::jsonb))
      with ordinality as questions(value, ordinality)
    where value->>'id' is not null
    order by value->>'id', ordinality desc
  ) deduplicated_questions
  on conflict (user_id, subject_id, id) do update set
    question_type = excluded.question_type,
    question = excluded.question,
    options = excluded.options,
    answer = excluded.answer,
    explanation = excluded.explanation,
    model_answer = excluded.model_answer,
    rubric = excluded.rubric,
    position = excluded.position,
    updated_at = excluded.updated_at;

  insert into public.study_storage_state (user_id, updated_at)
  values (current_user_id, p_updated_at)
  on conflict (user_id) do update
    set updated_at = excluded.updated_at;
end;
$$;

create or replace function public.delete_study_subject(
  p_subject_id text,
  p_updated_at timestamptz
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
begin
  if current_user_id is null then
    raise exception 'Not authenticated';
  end if;

  delete from public.study_subjects
  where user_id = current_user_id and id = p_subject_id;

  insert into public.study_storage_state (user_id, updated_at)
  values (current_user_id, p_updated_at)
  on conflict (user_id) do update
    set updated_at = excluded.updated_at;
end;
$$;

create or replace function public.replace_study_attempt(
  p_attempt jsonb,
  p_updated_at timestamptz
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  current_attempt_id text := p_attempt->>'id';
begin
  if current_user_id is null or current_attempt_id is null then
    raise exception 'Not authenticated or attempt id missing';
  end if;

  insert into public.study_attempts (
    user_id, id, subject_id, subject_ids, subject_names, display_date,
    score, total, mode, status, pass_percentage, percentage, passed,
    essay_pending, time_limit_minutes, position, updated_at
  )
  values (
    current_user_id,
    current_attempt_id,
    coalesce(p_attempt->>'subjectId', ''),
    p_attempt->'subjectIds',
    p_attempt->'subjectNames',
    coalesce(p_attempt->>'date', ''),
    coalesce((p_attempt->>'score')::integer, 0),
    coalesce((p_attempt->>'total')::integer, 0),
    p_attempt->>'mode',
    p_attempt->>'status',
    nullif(p_attempt->>'passPercentage', '')::numeric,
    nullif(p_attempt->>'percentage', '')::numeric,
    nullif(p_attempt->>'passed', '')::boolean,
    nullif(p_attempt->>'essayPending', '')::boolean,
    nullif(p_attempt->>'timeLimitMinutes', '')::integer,
    coalesce((p_attempt->>'position')::integer, 0),
    p_updated_at
  )
  on conflict (user_id, id) do update set
    subject_id = excluded.subject_id,
    subject_ids = excluded.subject_ids,
    subject_names = excluded.subject_names,
    display_date = excluded.display_date,
    score = excluded.score,
    total = excluded.total,
    mode = excluded.mode,
    status = excluded.status,
    pass_percentage = excluded.pass_percentage,
    percentage = excluded.percentage,
    passed = excluded.passed,
    essay_pending = excluded.essay_pending,
    time_limit_minutes = excluded.time_limit_minutes,
    position = excluded.position,
    updated_at = excluded.updated_at;

  delete from public.study_answers
  where user_id = current_user_id and attempt_id = current_attempt_id;

  insert into public.study_answers (
    user_id, attempt_id, answer_index, question_id, subject_id, subject_name,
    question, question_type, answer, correct, correct_answer, explanation,
    model_answer, rubric, grading
  )
  select
    current_user_id,
    current_attempt_id,
    ordinality::integer - 1,
    coalesce(value->>'questionId', ''),
    value->>'subjectId',
    value->>'subjectName',
    value->>'question',
    value->>'type',
    coalesce(value->>'answer', ''),
    nullif(value->>'correct', '')::boolean,
    value->>'correctAnswer',
    value->>'explanation',
    value->>'modelAnswer',
    value->>'rubric',
    value->'grading'
  from jsonb_array_elements(coalesce(p_attempt->'answers', '[]'::jsonb))
    with ordinality as answers(value, ordinality);

  insert into public.study_storage_state (user_id, updated_at)
  values (current_user_id, p_updated_at)
  on conflict (user_id) do update
    set updated_at = excluded.updated_at;
end;
$$;

create or replace function public.delete_study_attempt(
  p_attempt_id text,
  p_updated_at timestamptz
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
begin
  if current_user_id is null then
    raise exception 'Not authenticated';
  end if;

  delete from public.study_attempts
  where user_id = current_user_id and id = p_attempt_id;

  insert into public.study_storage_state (user_id, updated_at)
  values (current_user_id, p_updated_at)
  on conflict (user_id) do update
    set updated_at = excluded.updated_at;
end;
$$;

grant execute on function public.replace_study_subject(jsonb, timestamptz)
  to authenticated;
grant execute on function public.delete_study_subject(text, timestamptz)
  to authenticated;
grant execute on function public.replace_study_attempt(jsonb, timestamptz)
  to authenticated;
grant execute on function public.delete_study_attempt(text, timestamptz)
  to authenticated;

revoke execute on function public.replace_study_subject(jsonb, timestamptz)
  from public, anon;
revoke execute on function public.delete_study_subject(text, timestamptz)
  from public, anon;
revoke execute on function public.replace_study_attempt(jsonb, timestamptz)
  from public, anon;
revoke execute on function public.delete_study_attempt(text, timestamptz)
  from public, anon;

with raw_subject_rows as (
  select
    data.user_id,
    subject.value,
    subject.ordinality::integer - 1 as position,
    data.updated_at
  from public.user_data data
  cross join lateral jsonb_array_elements(data.subjects)
    with ordinality as subject(value, ordinality)
),
subject_rows as (
  select distinct on (user_id, value->>'id')
    user_id, value, position, updated_at
  from raw_subject_rows
  where value->>'id' is not null
  order by user_id, value->>'id', position desc
)
insert into public.study_subjects (
  user_id, id, name, color, source, position, updated_at
)
select
  user_id,
  value->>'id',
  coalesce(value->>'name', ''),
  coalesce(value->>'color', '#3167e3'),
  value->'source',
  position,
  updated_at
from subject_rows
on conflict (user_id, id) do update set
  name = excluded.name,
  color = excluded.color,
  source = excluded.source,
  position = excluded.position,
  updated_at = excluded.updated_at;

with raw_question_rows as (
  select
    data.user_id,
    subject.value->>'id' as subject_id,
    question.value,
    question.ordinality::integer - 1 as position,
    data.updated_at
  from public.user_data data
  cross join lateral jsonb_array_elements(data.subjects)
    as subject(value)
  cross join lateral jsonb_array_elements(
    coalesce(subject.value->'questions', '[]'::jsonb)
  ) with ordinality as question(value, ordinality)
),
question_rows as (
  select distinct on (user_id, subject_id, value->>'id')
    user_id, subject_id, value, position, updated_at
  from raw_question_rows
  where subject_id is not null and value->>'id' is not null
  order by user_id, subject_id, value->>'id', position desc
)
insert into public.study_questions (
  user_id, subject_id, id, question_type, question, options, answer,
  explanation, model_answer, rubric, position, updated_at
)
select
  user_id,
  subject_id,
  value->>'id',
  coalesce(value->>'type', 'choice'),
  coalesce(value->>'question', ''),
  coalesce(value->'options', '[]'::jsonb),
  coalesce(value->>'answer', ''),
  coalesce(value->>'explanation', ''),
  coalesce(value->>'modelAnswer', ''),
  coalesce(value->>'rubric', ''),
  position,
  updated_at
from question_rows
on conflict (user_id, subject_id, id) do update set
  question_type = excluded.question_type,
  question = excluded.question,
  options = excluded.options,
  answer = excluded.answer,
  explanation = excluded.explanation,
  model_answer = excluded.model_answer,
  rubric = excluded.rubric,
  position = excluded.position,
  updated_at = excluded.updated_at;

with raw_attempt_rows as (
  select
    data.user_id,
    attempt.value,
    attempt.ordinality::integer - 1 as position,
    data.updated_at
  from public.user_data data
  cross join lateral jsonb_array_elements(data.attempts)
    with ordinality as attempt(value, ordinality)
),
attempt_rows as (
  select distinct on (user_id, value->>'id')
    user_id, value, position, updated_at
  from raw_attempt_rows
  where value->>'id' is not null
  order by user_id, value->>'id', position desc
)
insert into public.study_attempts (
  user_id, id, subject_id, subject_ids, subject_names, display_date,
  score, total, mode, status, pass_percentage, percentage, passed,
  essay_pending, time_limit_minutes, position, updated_at
)
select
  user_id,
  value->>'id',
  coalesce(value->>'subjectId', ''),
  value->'subjectIds',
  value->'subjectNames',
  coalesce(value->>'date', ''),
  coalesce((value->>'score')::integer, 0),
  coalesce((value->>'total')::integer, 0),
  value->>'mode',
  value->>'status',
  nullif(value->>'passPercentage', '')::numeric,
  nullif(value->>'percentage', '')::numeric,
  nullif(value->>'passed', '')::boolean,
  nullif(value->>'essayPending', '')::boolean,
  nullif(value->>'timeLimitMinutes', '')::integer,
  position,
  updated_at
from attempt_rows
on conflict (user_id, id) do update set
  subject_id = excluded.subject_id,
  subject_ids = excluded.subject_ids,
  subject_names = excluded.subject_names,
  display_date = excluded.display_date,
  score = excluded.score,
  total = excluded.total,
  mode = excluded.mode,
  status = excluded.status,
  pass_percentage = excluded.pass_percentage,
  percentage = excluded.percentage,
  passed = excluded.passed,
  essay_pending = excluded.essay_pending,
  time_limit_minutes = excluded.time_limit_minutes,
  position = excluded.position,
  updated_at = excluded.updated_at;

with raw_answer_rows as (
  select
    data.user_id,
    attempt.value->>'id' as attempt_id,
    attempt.ordinality as attempt_ordinality,
    answer.value,
    answer.ordinality::integer - 1 as answer_index
  from public.user_data data
  cross join lateral jsonb_array_elements(data.attempts)
    with ordinality as attempt(value, ordinality)
  cross join lateral jsonb_array_elements(
    coalesce(attempt.value->'answers', '[]'::jsonb)
  ) with ordinality as answer(value, ordinality)
),
answer_rows as (
  select distinct on (user_id, attempt_id, answer_index)
    user_id, attempt_id, value, answer_index
  from raw_answer_rows
  where attempt_id is not null
  order by user_id, attempt_id, answer_index, attempt_ordinality desc
)
insert into public.study_answers (
  user_id, attempt_id, answer_index, question_id, subject_id, subject_name,
  question, question_type, answer, correct, correct_answer, explanation,
  model_answer, rubric, grading
)
select
  user_id,
  attempt_id,
  answer_index,
  coalesce(value->>'questionId', ''),
  value->>'subjectId',
  value->>'subjectName',
  value->>'question',
  value->>'type',
  coalesce(value->>'answer', ''),
  nullif(value->>'correct', '')::boolean,
  value->>'correctAnswer',
  value->>'explanation',
  value->>'modelAnswer',
  value->>'rubric',
  value->'grading'
from answer_rows
on conflict (user_id, attempt_id, answer_index) do update set
  question_id = excluded.question_id,
  subject_id = excluded.subject_id,
  subject_name = excluded.subject_name,
  question = excluded.question,
  question_type = excluded.question_type,
  answer = excluded.answer,
  correct = excluded.correct,
  correct_answer = excluded.correct_answer,
  explanation = excluded.explanation,
  model_answer = excluded.model_answer,
  rubric = excluded.rubric,
  grading = excluded.grading;

insert into public.study_storage_state (user_id, updated_at)
select user_id, updated_at
from public.user_data
on conflict (user_id) do update
  set updated_at = greatest(
    study_storage_state.updated_at,
    excluded.updated_at
  );
