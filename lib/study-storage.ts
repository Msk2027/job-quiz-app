import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  AnswerRecord,
  Attempt,
  EssayGrading,
  QType,
  Question,
  Subject,
} from "@/lib/study-types";

export type StudySnapshot = {
  subjects: Subject[];
  attempts: Attempt[];
};

export type Deletions = {
  subjects: string[];
  questions: string[];
  attempts: string[];
};

type StorageResult = StudySnapshot & {
  available: boolean;
  updatedAt: number;
  error?: string;
  /** 削除履歴。取得できなかった場合はnull（従来どおりの判定にフォールバック） */
  deletions?: Deletions | null;
};

type DeletionRow = { kind: string; id: string };

async function loadDeletions(
  client: SupabaseClient,
  userId: string,
): Promise<Deletions | null> {
  try {
    const { data, error } = await client
      .from("study_deletions")
      .select("kind, id")
      .eq("user_id", userId);
    if (error) throw new Error(error.message);
    const rows = (data || []) as DeletionRow[];
    return {
      subjects: rows.filter((r) => r.kind === "subject").map((r) => r.id),
      questions: rows.filter((r) => r.kind === "question").map((r) => r.id),
      attempts: rows.filter((r) => r.kind === "attempt").map((r) => r.id),
    };
  } catch {
    // migration未適用でも従来どおり動かす
    return null;
  }
}

type SubjectRow = {
  id: string;
  name: string;
  color: string;
  folder_name: string | null;
  archived: boolean | null;
  source: Subject["source"] | null;
  position: number;
};

type QuestionRow = {
  subject_id: string;
  id: string;
  question_type: QType;
  question: string;
  options: string[];
  answer: string;
  explanation: string;
  model_answer: string;
  rubric: string;
  position: number;
};

type AttemptRow = {
  id: string;
  subject_id: string;
  subject_ids: string[] | null;
  subject_names: string[] | null;
  display_date: string;
  score: number;
  total: number;
  mode: Attempt["mode"] | null;
  status: Attempt["status"] | null;
  pass_percentage: number | null;
  percentage: number | null;
  passed: boolean | null;
  essay_pending: boolean | null;
  time_limit_minutes: number | null;
  position: number;
};

type AnswerRow = {
  attempt_id: string;
  answer_index: number;
  question_id: string;
  subject_id: string | null;
  subject_name: string | null;
  question: string | null;
  question_type: QType | null;
  answer: string;
  correct: boolean | null;
  correct_answer: string | null;
  explanation: string | null;
  model_answer: string | null;
  rubric: string | null;
  grading: EssayGrading | null;
};

const throwIfError = (error: { message: string } | null) => {
  if (error) throw new Error(error.message);
};

export async function loadLegacyData(
  client: SupabaseClient,
  userId: string,
): Promise<StorageResult> {
  try {
    const { data, error } = await client
      .from("user_data")
      .select("subjects, attempts, updated_at")
      .eq("user_id", userId)
      .maybeSingle();
    throwIfError(error);
    return {
      available: true,
      subjects: data && Array.isArray(data.subjects) ? data.subjects : [],
      attempts: data && Array.isArray(data.attempts) ? data.attempts : [],
      updatedAt: data?.updated_at ? Date.parse(String(data.updated_at)) : 0,
    };
  } catch (error) {
    // 読み込みに失敗したときに「クラウドは空」と扱うと端末のデータを
    // 空で上書きしてしまうため、利用不可であることを呼び出し側へ伝える。
    return {
      available: false,
      subjects: [],
      attempts: [],
      updatedAt: 0,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function loadRelationalData(
  client: SupabaseClient,
  userId: string,
): Promise<StorageResult> {
  try {
    const deletionsPromise = loadDeletions(client, userId);
    const [
      stateResult,
      subjectsResult,
      questionsResult,
      attemptsResult,
      answersResult,
    ] = await Promise.all([
      client
        .from("study_storage_state")
        .select("updated_at")
        .eq("user_id", userId)
        .maybeSingle(),
      client
        .from("study_subjects")
        .select("id, name, color, folder_name, archived, source, position")
        .eq("user_id", userId)
        .order("position"),
      client
        .from("study_questions")
        .select(
          "subject_id, id, question_type, question, options, answer, explanation, model_answer, rubric, position",
        )
        .eq("user_id", userId)
        .order("position"),
      client
        .from("study_attempts")
        .select(
          "id, subject_id, subject_ids, subject_names, display_date, score, total, mode, status, pass_percentage, percentage, passed, essay_pending, time_limit_minutes, position",
        )
        .eq("user_id", userId)
        .order("position"),
      client
        .from("study_answers")
        .select(
          "attempt_id, answer_index, question_id, subject_id, subject_name, question, question_type, answer, correct, correct_answer, explanation, model_answer, rubric, grading",
        )
        .eq("user_id", userId)
        .order("answer_index"),
    ]);

    throwIfError(stateResult.error);
    throwIfError(subjectsResult.error);
    throwIfError(questionsResult.error);
    throwIfError(attemptsResult.error);
    throwIfError(answersResult.error);

    const questionsBySubject = new Map<string, Question[]>();
    ((questionsResult.data || []) as QuestionRow[]).forEach((row) => {
      const question: Question = {
        id: row.id,
        type: row.question_type,
        question: row.question,
        options: Array.isArray(row.options) ? row.options : [],
        answer: row.answer,
        explanation: row.explanation,
        modelAnswer: row.model_answer,
        rubric: row.rubric,
      };
      const current = questionsBySubject.get(row.subject_id) || [];
      current.push(question);
      questionsBySubject.set(row.subject_id, current);
    });

    const answersByAttempt = new Map<string, AnswerRecord[]>();
    ((answersResult.data || []) as AnswerRow[]).forEach((row) => {
      const answer: AnswerRecord = {
        questionId: row.question_id,
        answer: row.answer,
        correct: row.correct,
        ...(row.subject_id ? { subjectId: row.subject_id } : {}),
        ...(row.subject_name ? { subjectName: row.subject_name } : {}),
        ...(row.question ? { question: row.question } : {}),
        ...(row.question_type ? { type: row.question_type } : {}),
        ...(row.correct_answer ? { correctAnswer: row.correct_answer } : {}),
        ...(row.explanation ? { explanation: row.explanation } : {}),
        ...(row.model_answer ? { modelAnswer: row.model_answer } : {}),
        ...(row.rubric ? { rubric: row.rubric } : {}),
        ...(row.grading ? { grading: row.grading } : {}),
      };
      const current = answersByAttempt.get(row.attempt_id) || [];
      current.push(answer);
      answersByAttempt.set(row.attempt_id, current);
    });

    const subjects = ((subjectsResult.data || []) as SubjectRow[]).map(
      (row) => ({
        id: row.id,
        name: row.name,
        color: row.color,
        ...(row.folder_name ? { folder: row.folder_name } : {}),
        ...(row.archived ? { archived: true } : {}),
        ...(row.source ? { source: row.source } : {}),
        questionCount: (questionsBySubject.get(row.id) || []).length,
        questionsLoaded: true,
        questions: questionsBySubject.get(row.id) || [],
      }),
    );
    const attempts = ((attemptsResult.data || []) as AttemptRow[]).map(
      (row) => ({
        id: row.id,
        subjectId: row.subject_id,
        date: row.display_date,
        score: row.score,
        total: row.total,
        answersLoaded: true,
        answers: answersByAttempt.get(row.id) || [],
        ...(row.subject_ids ? { subjectIds: row.subject_ids } : {}),
        ...(row.subject_names ? { subjectNames: row.subject_names } : {}),
        ...(row.mode ? { mode: row.mode } : {}),
        ...(row.status ? { status: row.status } : {}),
        ...(row.pass_percentage !== null
          ? { passPercentage: Number(row.pass_percentage) }
          : {}),
        ...(row.percentage !== null
          ? { percentage: Number(row.percentage) }
          : {}),
        ...(row.passed !== null ? { passed: row.passed } : {}),
        ...(row.essay_pending !== null
          ? { essayPending: row.essay_pending }
          : {}),
        ...(row.time_limit_minutes !== null
          ? { timeLimitMinutes: row.time_limit_minutes }
          : {}),
      }),
    );

    return {
      available: true,
      subjects,
      attempts,
      deletions: await deletionsPromise,
      updatedAt: stateResult.data?.updated_at
        ? Date.parse(String(stateResult.data.updated_at))
        : 0,
    };
  } catch (error) {
    return {
      available: false,
      subjects: [],
      attempts: [],
      updatedAt: 0,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/** ホーム・履歴用。問題本文と解答詳細を送らず、一覧に必要な情報だけ取得する。 */
export async function loadRelationalOverview(
  client: SupabaseClient,
  userId: string,
): Promise<StorageResult> {
  try {
    const [stateResult, subjectsResult, questionIdsResult, attemptsResult] =
      await Promise.all([
        client
          .from("study_storage_state")
          .select("updated_at")
          .eq("user_id", userId)
          .maybeSingle(),
        client
          .from("study_subjects")
          .select("id, name, color, folder_name, archived, source, position")
          .eq("user_id", userId)
          .order("position"),
        client
          .from("study_questions")
          .select("subject_id")
          .eq("user_id", userId),
        client
          .from("study_attempts")
          .select(
            "id, subject_id, subject_ids, subject_names, display_date, score, total, mode, status, pass_percentage, percentage, passed, essay_pending, time_limit_minutes, position",
          )
          .eq("user_id", userId)
          .order("position"),
      ]);

    throwIfError(stateResult.error);
    throwIfError(subjectsResult.error);
    throwIfError(questionIdsResult.error);
    throwIfError(attemptsResult.error);

    const counts = new Map<string, number>();
    ((questionIdsResult.data || []) as { subject_id: string }[]).forEach(
      ({ subject_id }) => counts.set(subject_id, (counts.get(subject_id) || 0) + 1),
    );
    const subjects = ((subjectsResult.data || []) as SubjectRow[]).map((row) => ({
      id: row.id,
      name: row.name,
      color: row.color,
      ...(row.folder_name ? { folder: row.folder_name } : {}),
      ...(row.archived ? { archived: true } : {}),
      ...(row.source ? { source: row.source } : {}),
      questionCount: counts.get(row.id) || 0,
      questionsLoaded: false,
      questions: [],
    }));
    const attempts = ((attemptsResult.data || []) as AttemptRow[]).map((row) => ({
      id: row.id,
      subjectId: row.subject_id,
      date: row.display_date,
      score: row.score,
      total: row.total,
      answersLoaded: false,
      answers: [],
      ...(row.subject_ids ? { subjectIds: row.subject_ids } : {}),
      ...(row.subject_names ? { subjectNames: row.subject_names } : {}),
      ...(row.mode ? { mode: row.mode } : {}),
      ...(row.status ? { status: row.status } : {}),
      ...(row.pass_percentage !== null
        ? { passPercentage: Number(row.pass_percentage) }
        : {}),
      ...(row.percentage !== null ? { percentage: Number(row.percentage) } : {}),
      ...(row.passed !== null ? { passed: row.passed } : {}),
      ...(row.essay_pending !== null ? { essayPending: row.essay_pending } : {}),
      ...(row.time_limit_minutes !== null
        ? { timeLimitMinutes: row.time_limit_minutes }
        : {}),
    }));

    return {
      available: true,
      subjects,
      attempts,
      deletions: await loadDeletions(client, userId),
      updatedAt: stateResult.data?.updated_at
        ? Date.parse(String(stateResult.data.updated_at))
        : 0,
    };
  } catch (error) {
    return {
      available: false,
      subjects: [],
      attempts: [],
      updatedAt: 0,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function loadSubjectQuestions(
  client: SupabaseClient,
  userId: string,
  subjectId: string,
): Promise<Question[]> {
  const { data, error } = await client
    .from("study_questions")
    .select(
      "subject_id, id, question_type, question, options, answer, explanation, model_answer, rubric, position",
    )
    .eq("user_id", userId)
    .eq("subject_id", subjectId)
    .order("position");
  throwIfError(error);
  return ((data || []) as QuestionRow[]).map((row) => ({
    id: row.id,
    type: row.question_type,
    question: row.question,
    options: Array.isArray(row.options) ? row.options : [],
    answer: row.answer,
    explanation: row.explanation,
    modelAnswer: row.model_answer,
    rubric: row.rubric,
  }));
}

export async function loadAttemptAnswers(
  client: SupabaseClient,
  userId: string,
  attemptId: string,
): Promise<AnswerRecord[]> {
  const { data, error } = await client
    .from("study_answers")
    .select(
      "attempt_id, answer_index, question_id, subject_id, subject_name, question, question_type, answer, correct, correct_answer, explanation, model_answer, rubric, grading",
    )
    .eq("user_id", userId)
    .eq("attempt_id", attemptId)
    .order("answer_index");
  throwIfError(error);
  return ((data || []) as AnswerRow[]).map((row) => ({
    questionId: row.question_id,
    answer: row.answer,
    correct: row.correct,
    ...(row.subject_id ? { subjectId: row.subject_id } : {}),
    ...(row.subject_name ? { subjectName: row.subject_name } : {}),
    ...(row.question ? { question: row.question } : {}),
    ...(row.question_type ? { type: row.question_type } : {}),
    ...(row.correct_answer ? { correctAnswer: row.correct_answer } : {}),
    ...(row.explanation ? { explanation: row.explanation } : {}),
    ...(row.model_answer ? { modelAnswer: row.model_answer } : {}),
    ...(row.rubric ? { rubric: row.rubric } : {}),
    ...(row.grading ? { grading: row.grading } : {}),
  }));
}

const serialized = (value: unknown) => JSON.stringify(value);

const subjectMetadata = (subject: Subject, position: number) => ({
  id: subject.id,
  name: subject.name,
  color: subject.color,
  folder: subject.folder,
  archived: subject.archived,
  source: subject.source,
  position,
});

const attemptMetadata = (attempt: Attempt, position: number) => {
  const { answers: _, answersLoaded: __, ...metadata } = attempt;
  void _;
  void __;
  return { ...metadata, position };
};

export async function saveRelationalChanges(
  client: SupabaseClient,
  previous: StudySnapshot,
  next: StudySnapshot,
  updatedAt: string,
) {
  const previousSubjects = new Map(previous.subjects.map((item) => [item.id, item]));
  const nextSubjects = new Map(next.subjects.map((item) => [item.id, item]));
  const previousAttempts = new Map(previous.attempts.map((item) => [item.id, item]));
  const nextAttempts = new Map(next.attempts.map((item) => [item.id, item]));
  const operations: (() => PromiseLike<unknown>)[] = [];

  previousSubjects.forEach((_, id) => {
    if (!nextSubjects.has(id))
      operations.push(() =>
        client.rpc("delete_study_subject", {
          p_subject_id: id,
          p_updated_at: updatedAt,
        }),
      );
  });
  next.subjects.forEach((subject, position) => {
    const oldSubject = previousSubjects.get(subject.id);
    if (
      !oldSubject ||
      serialized(subjectMetadata(oldSubject, previous.subjects.findIndex((item) => item.id === subject.id))) !==
        serialized(subjectMetadata(subject, position))
    ) {
      operations.push(() =>
        client.rpc("upsert_study_subject_metadata", {
          p_subject: subjectMetadata(subject, position),
          p_position: position,
          p_updated_at: updatedAt,
        }),
      );
    }

    const previousQuestions = new Map(
      (oldSubject?.questions || []).map((question) => [question.id, question]),
    );
    const nextQuestions = new Map(
      subject.questions.map((question) => [question.id, question]),
    );
    previousQuestions.forEach((_, questionId) => {
      if (!nextQuestions.has(questionId))
        operations.push(() =>
          client.rpc("delete_study_question", {
            p_subject_id: subject.id,
            p_question_id: questionId,
            p_updated_at: updatedAt,
          }),
        );
    });
    subject.questions.forEach((question, questionPosition) => {
      const previousQuestion = previousQuestions.get(question.id);
      const previousPosition = oldSubject?.questions.findIndex(
        (item) => item.id === question.id,
      );
      if (
        !previousQuestion ||
        previousPosition !== questionPosition ||
        serialized(previousQuestion) !== serialized(question)
      )
        operations.push(() =>
          client.rpc("upsert_study_question", {
            p_subject_id: subject.id,
            p_question: question,
            p_position: questionPosition,
            p_updated_at: updatedAt,
          }),
        );
    });
  });

  previousAttempts.forEach((_, id) => {
    if (!nextAttempts.has(id))
      operations.push(() =>
        client.rpc("delete_study_attempt", {
          p_attempt_id: id,
          p_updated_at: updatedAt,
        }),
      );
  });
  next.attempts.forEach((attempt, position) => {
    const oldAttempt = previousAttempts.get(attempt.id);
    const oldPosition = previous.attempts.findIndex(
      (item) => item.id === attempt.id,
    );
    if (
      !oldAttempt ||
      serialized(attemptMetadata(oldAttempt, oldPosition)) !==
        serialized(attemptMetadata(attempt, position))
    ) {
      operations.push(() =>
        client.rpc("upsert_study_attempt_metadata", {
          p_attempt: attemptMetadata(attempt, position),
          p_position: position,
          p_updated_at: updatedAt,
        }),
      );
    }
    if (!oldAttempt || serialized(oldAttempt.answers) !== serialized(attempt.answers))
      operations.push(() =>
        client.rpc("replace_study_answers", {
          p_attempt_id: attempt.id,
          p_answers: attempt.answers,
          p_updated_at: updatedAt,
        }),
      );
  });

  // 同時実行すると各RPCが同じstudy_storage_stateを奪い合い、一部だけ失敗して
  // 「更新時刻は新しいのに中身が欠けている」状態になる。順番に実行する。
  let firstError: string | null = null;
  for (const operation of operations) {
    try {
      const result = (await operation()) as { error?: { message: string } };
      if (result?.error && !firstError) firstError = result.error.message;
    } catch (error) {
      if (!firstError)
        firstError = error instanceof Error ? error.message : String(error);
    }
  }
  if (firstError) throw new Error(firstError);
}

export async function saveLegacyBackup(
  client: SupabaseClient,
  userId: string,
  snapshot: StudySnapshot,
  updatedAt: string,
) {
  const { error } = await client.from("user_data").upsert({
    user_id: userId,
    subjects: snapshot.subjects,
    attempts: snapshot.attempts,
    updated_at: updatedAt,
  });
  throwIfError(error);
}
