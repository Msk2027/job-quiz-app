-- 削除履歴（tombstone）を保存し、別端末の古いキャッシュから
-- 削除済みのデータが復活しないようにする。
create table if not exists public.study_deletions (
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null,
  id text not null,
  subject_id text,
  deleted_at timestamptz not null default now(),
  primary key (user_id, kind, id)
);

create index if not exists study_deletions_user_kind_idx
  on public.study_deletions(user_id, kind);

alter table public.study_deletions enable row level security;

grant select, insert, update, delete on table public.study_deletions
  to authenticated;

drop policy if exists "Users manage own study deletions"
  on public.study_deletions;
create policy "Users manage own study deletions"
  on public.study_deletions for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- 科目の保存：消えた問題を削除履歴へ記録し、保存し直したものは記録から外す
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

  insert into public.study_deletions (user_id, kind, id, subject_id, deleted_at)
  select current_user_id, 'question', q.id, current_subject_id, p_updated_at
  from public.study_questions q
  where q.user_id = current_user_id
    and q.subject_id = current_subject_id
    and not exists (
      select 1
      from jsonb_array_elements(coalesce(p_subject->'questions', '[]'::jsonb))
        as question(value)
      where question.value->>'id' = q.id
    )
  on conflict (user_id, kind, id) do update
    set deleted_at = excluded.deleted_at,
        subject_id = excluded.subject_id;

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

  -- 作り直した科目・問題は削除済みではないので記録から外す
  delete from public.study_deletions
  where user_id = current_user_id
    and (
      (kind = 'subject' and id = current_subject_id)
      or (
        kind = 'question'
        and id in (
          select value->>'id'
          from jsonb_array_elements(
            coalesce(p_subject->'questions', '[]'::jsonb)
          ) as questions(value)
          where value->>'id' is not null
        )
      )
    );

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

  insert into public.study_deletions (user_id, kind, id, deleted_at)
  values (current_user_id, 'subject', p_subject_id, p_updated_at)
  on conflict (user_id, kind, id) do update
    set deleted_at = excluded.deleted_at;

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

  delete from public.study_deletions
  where user_id = current_user_id
    and kind = 'attempt'
    and id = current_attempt_id;

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

  insert into public.study_deletions (user_id, kind, id, deleted_at)
  values (current_user_id, 'attempt', p_attempt_id, p_updated_at)
  on conflict (user_id, kind, id) do update
    set deleted_at = excluded.deleted_at;

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
