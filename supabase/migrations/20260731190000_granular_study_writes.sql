-- 画面別の部分読み込みを安全にするため、親行と詳細行を独立して更新する。

create or replace function public.upsert_study_subject_metadata(
  p_subject jsonb,
  p_position integer,
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
  if current_user_id is null or nullif(current_subject_id, '') is null then
    raise exception 'Not authenticated or subject id missing';
  end if;

  insert into public.study_subjects (
    user_id, id, name, color, folder_name, archived, source, position, updated_at
  ) values (
    current_user_id,
    current_subject_id,
    coalesce(p_subject->>'name', ''),
    coalesce(p_subject->>'color', '#3167e3'),
    nullif(trim(coalesce(p_subject->>'folder', '')), ''),
    coalesce((p_subject->>'archived')::boolean, false),
    p_subject->'source',
    p_position,
    p_updated_at
  )
  on conflict (user_id, id) do update set
    name = excluded.name,
    color = excluded.color,
    folder_name = excluded.folder_name,
    archived = excluded.archived,
    source = excluded.source,
    position = excluded.position,
    updated_at = excluded.updated_at;

  delete from public.study_deletions
  where user_id = current_user_id and kind = 'subject' and id = current_subject_id;

  insert into public.study_storage_state (user_id, updated_at)
  values (current_user_id, p_updated_at)
  on conflict (user_id) do update set updated_at = excluded.updated_at;
end;
$$;

create or replace function public.upsert_study_question(
  p_subject_id text,
  p_question jsonb,
  p_position integer,
  p_updated_at timestamptz
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  current_question_id text := p_question->>'id';
begin
  if current_user_id is null or nullif(p_subject_id, '') is null
     or nullif(current_question_id, '') is null then
    raise exception 'Not authenticated or id missing';
  end if;

  insert into public.study_questions (
    user_id, subject_id, id, question_type, question, options, answer,
    explanation, model_answer, rubric, position, updated_at
  ) values (
    current_user_id, p_subject_id, current_question_id,
    coalesce(p_question->>'type', 'choice'),
    coalesce(p_question->>'question', ''),
    coalesce(p_question->'options', '[]'::jsonb),
    coalesce(p_question->>'answer', ''),
    coalesce(p_question->>'explanation', ''),
    coalesce(p_question->>'modelAnswer', ''),
    coalesce(p_question->>'rubric', ''),
    p_position, p_updated_at
  )
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

  delete from public.study_deletions
  where user_id = current_user_id and kind = 'question'
    and id = current_question_id and subject_id = p_subject_id;

  insert into public.study_storage_state (user_id, updated_at)
  values (current_user_id, p_updated_at)
  on conflict (user_id) do update set updated_at = excluded.updated_at;
end;
$$;

create or replace function public.delete_study_question(
  p_subject_id text,
  p_question_id text,
  p_updated_at timestamptz
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare current_user_id uuid := auth.uid();
begin
  if current_user_id is null then raise exception 'Not authenticated'; end if;

  delete from public.study_questions
  where user_id = current_user_id and subject_id = p_subject_id and id = p_question_id;

  insert into public.study_deletions (user_id, kind, id, subject_id, deleted_at)
  values (current_user_id, 'question', p_question_id, p_subject_id, p_updated_at)
  on conflict (user_id, kind, id) do update
    set subject_id = excluded.subject_id, deleted_at = excluded.deleted_at;

  insert into public.study_storage_state (user_id, updated_at)
  values (current_user_id, p_updated_at)
  on conflict (user_id) do update set updated_at = excluded.updated_at;
end;
$$;

create or replace function public.upsert_study_attempt_metadata(
  p_attempt jsonb,
  p_position integer,
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
  if current_user_id is null or nullif(current_attempt_id, '') is null then
    raise exception 'Not authenticated or attempt id missing';
  end if;

  insert into public.study_attempts (
    user_id, id, subject_id, subject_ids, subject_names, display_date,
    score, total, mode, status, pass_percentage, percentage, passed,
    essay_pending, time_limit_minutes, position, updated_at
  ) values (
    current_user_id, current_attempt_id,
    coalesce(p_attempt->>'subjectId', ''), p_attempt->'subjectIds',
    p_attempt->'subjectNames', coalesce(p_attempt->>'date', ''),
    coalesce((p_attempt->>'score')::integer, 0),
    coalesce((p_attempt->>'total')::integer, 0),
    p_attempt->>'mode', p_attempt->>'status',
    nullif(p_attempt->>'passPercentage', '')::numeric,
    nullif(p_attempt->>'percentage', '')::numeric,
    nullif(p_attempt->>'passed', '')::boolean,
    nullif(p_attempt->>'essayPending', '')::boolean,
    nullif(p_attempt->>'timeLimitMinutes', '')::integer,
    p_position, p_updated_at
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

  delete from public.study_deletions
  where user_id = current_user_id and kind = 'attempt' and id = current_attempt_id;

  insert into public.study_storage_state (user_id, updated_at)
  values (current_user_id, p_updated_at)
  on conflict (user_id) do update set updated_at = excluded.updated_at;
end;
$$;

create or replace function public.replace_study_answers(
  p_attempt_id text,
  p_answers jsonb,
  p_updated_at timestamptz
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare current_user_id uuid := auth.uid();
begin
  if current_user_id is null then raise exception 'Not authenticated'; end if;

  delete from public.study_answers
  where user_id = current_user_id and attempt_id = p_attempt_id;

  insert into public.study_answers (
    user_id, attempt_id, answer_index, question_id, subject_id, subject_name,
    question, question_type, answer, correct, correct_answer, explanation,
    model_answer, rubric, grading
  )
  select
    current_user_id, p_attempt_id, ordinality::integer - 1,
    coalesce(value->>'questionId', ''), value->>'subjectId',
    value->>'subjectName', value->>'question', value->>'type',
    coalesce(value->>'answer', ''), nullif(value->>'correct', '')::boolean,
    value->>'correctAnswer', value->>'explanation', value->>'modelAnswer',
    value->>'rubric', value->'grading'
  from jsonb_array_elements(coalesce(p_answers, '[]'::jsonb))
    with ordinality as answers(value, ordinality);

  insert into public.study_storage_state (user_id, updated_at)
  values (current_user_id, p_updated_at)
  on conflict (user_id) do update set updated_at = excluded.updated_at;
end;
$$;

grant execute on function public.upsert_study_subject_metadata(jsonb, integer, timestamptz) to authenticated;
grant execute on function public.upsert_study_question(text, jsonb, integer, timestamptz) to authenticated;
grant execute on function public.delete_study_question(text, text, timestamptz) to authenticated;
grant execute on function public.upsert_study_attempt_metadata(jsonb, integer, timestamptz) to authenticated;
grant execute on function public.replace_study_answers(text, jsonb, timestamptz) to authenticated;
