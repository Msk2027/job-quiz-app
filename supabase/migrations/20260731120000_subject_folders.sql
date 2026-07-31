-- 授業科目フォルダとアーカイブ状態を正規化テーブルにも保存する。
alter table public.study_subjects
  add column if not exists folder_name text,
  add column if not exists archived boolean not null default false;

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
    user_id, id, name, color, folder_name, archived, source, position, updated_at
  )
  values (
    current_user_id,
    current_subject_id,
    coalesce(p_subject->>'name', ''),
    coalesce(p_subject->>'color', '#3167e3'),
    nullif(trim(coalesce(p_subject->>'folder', '')), ''),
    coalesce((p_subject->>'archived')::boolean, false),
    p_subject->'source',
    coalesce((p_subject->>'position')::integer, 0),
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
    current_user_id, current_subject_id, question_id,
    coalesce(value->>'type', 'choice'), coalesce(value->>'question', ''),
    coalesce(value->'options', '[]'::jsonb), coalesce(value->>'answer', ''),
    coalesce(value->>'explanation', ''), coalesce(value->>'modelAnswer', ''),
    coalesce(value->>'rubric', ''), position, p_updated_at
  from (
    select distinct on (value->>'id')
      value->>'id' as question_id, value, ordinality::integer - 1 as position
    from jsonb_array_elements(coalesce(p_subject->'questions', '[]'::jsonb))
      with ordinality as questions(value, ordinality)
    where nullif(value->>'id', '') is not null
    order by value->>'id', ordinality
  ) normalized
  on conflict (user_id, subject_id, id) do update set
    question_type = excluded.question_type, question = excluded.question,
    options = excluded.options, answer = excluded.answer,
    explanation = excluded.explanation, model_answer = excluded.model_answer,
    rubric = excluded.rubric, position = excluded.position,
    updated_at = excluded.updated_at;

  delete from public.study_deletions
  where user_id = current_user_id
    and (
      (kind = 'subject' and id = current_subject_id)
      or (kind = 'question' and subject_id = current_subject_id and exists (
        select 1
        from jsonb_array_elements(coalesce(p_subject->'questions', '[]'::jsonb))
          as question(value)
        where question.value->>'id' = public.study_deletions.id
      ))
    );

  insert into public.study_storage_state (user_id, updated_at)
  values (current_user_id, p_updated_at)
  on conflict (user_id) do update set updated_at = excluded.updated_at;
end;
$$;

grant execute on function public.replace_study_subject(jsonb, timestamptz)
  to authenticated;
