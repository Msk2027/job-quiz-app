"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AnswerBreakdown, AnswerReviewList } from "@/components/answer-review";
import { AuthScreen } from "@/components/auth-screen";
import { DataHealth } from "@/components/data-health";
import { useStudySync } from "@/hooks/use-study-sync";
import { scoreExam, shuffle, summarizeAnswers } from "@/lib/exam";
import {
  blankQuestion,
  dedupeQuestions,
  loadQuestionFile,
  loadSheet,
  MAX_CHOICE_OPTIONS,
  MIN_CHOICE_OPTIONS,
  typeName,
} from "@/lib/questions";
import { isSupabaseConfigured } from "@/lib/supabase";
import type {
  Attempt,
  EssayGrading,
  QType,
  Question,
  Subject,
} from "@/lib/study-types";

type PendingImport = { name: string; url: string };
type ActiveQuestion = Question & {
  sourceSubjectId: string;
  sourceSubjectName: string;
};
type ExamSettings = {
  subjectIds: string[];
  subjectNames: string[];
  passPercentage: number;
};
const uid = () => crypto.randomUUID();
const shuffleChoiceOptions = <T extends Question>(question: T): T =>
  question.type === "choice"
    ? ({ ...question, options: shuffle(question.options) } as T)
    : question;
const upsertSubject = (current: Subject[], subject: Subject) => {
  const unique = Array.from(
    new Map(current.map((item) => [item.id, item])).values(),
  );
  const nextSubject = {
    ...subject,
    questions: dedupeQuestions(subject.questions),
  };
  return unique.some((item) => item.id === subject.id)
    ? unique.map((item) => (item.id === subject.id ? nextSubject : item))
    : [...unique, nextSubject];
};

type StudyView =
  | "home"
  | "subject"
  | "manage"
  | "play"
  | "result"
  | "history"
  | "exam";

export function StudyApp({
  initialView = "home",
  initialSubjectId = "",
}: {
  initialView?: StudyView;
  initialSubjectId?: string;
} = {}) {
  const router = useRouter();
  const {
    ready,
    subjects,
    setSubjects,
    attempts,
    setAttempts,
    session,
    authChecked,
    syncStatus,
    saveNow,
    retrySync,
    signOut: signOutCloud,
    restoreSnapshot,
    ensureSubjectQuestions,
    ensureAttemptAnswers,
    getCompleteSnapshot,
    diagnostics,
  } = useStudySync({
    overviewOnly: true,
  });
  const [view, setView] = useState<StudyView>(initialView),
    [selected, setSelected] = useState(initialSubjectId);
  const [editing, setEditing] = useState<Question | null>(null),
    [active, setActive] = useState<ActiveQuestion[]>([]),
    [index, setIndex] = useState(0),
    [draft, setDraft] = useState(""),
    [answers, setAnswers] = useState<Attempt["answers"]>([]),
    [feedback, setFeedback] = useState<boolean | null>(null),
    [submitted, setSubmitted] = useState(false);
  const [pendingImport, setPendingImport] = useState<PendingImport | null>(
    null,
  );
  const [loadingMessage, setLoadingMessage] = useState<string | null>(null);
  const operationLock = useRef(false);
  const [subjectSettings, setSubjectSettings] = useState<Subject | null>(null),
    [settingsLoading, setSettingsLoading] = useState(false);
  const [expandedAttempt, setExpandedAttempt] = useState<string | null>(null);
  const [loadingAttemptId, setLoadingAttemptId] = useState<string | null>(null);
  const [expandedExam, setExpandedExam] = useState<string | null>(null);
  const [showStudySetup, setShowStudySetup] = useState(false),
    [studyTypes, setStudyTypes] = useState<QType[]>([
      "choice",
      "ox",
      "fill",
      "essay",
    ]),
    [studyCount, setStudyCount] = useState("1"),
    [studyExamMode, setStudyExamMode] = useState(false),
    [studyPassPercentage, setStudyPassPercentage] = useState("90"),
    [lastInterrupted, setLastInterrupted] = useState(false);
  const [showExamSetup, setShowExamSetup] = useState(false),
    [setupMode, setSetupMode] = useState<"exam" | "study">("exam"),
    [examSubjectIds, setExamSubjectIds] = useState<string[]>([]),
    [examTypes, setExamTypes] = useState<QType[]>([
      "choice",
      "ox",
      "fill",
      "essay",
    ]),
    [examCount, setExamCount] = useState("1"),
    [examPassPercentage, setExamPassPercentage] = useState("90"),
    [sessionMode, setSessionMode] = useState<"study" | "exam">("study"),
    [examSettings, setExamSettings] = useState<ExamSettings | null>(null),
    [lastAttempt, setLastAttempt] = useState<Attempt | null>(null),
    [resultSaving, setResultSaving] = useState(false),
    [resultSaveError, setResultSaveError] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [showFolderCreator, setShowFolderCreator] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [folderSubjectIds, setFolderSubjectIds] = useState<string[]>([]);
  const [closedFolders, setClosedFolders] = useState<string[]>([]);
  const [folderPreferencesReady, setFolderPreferencesReady] = useState(false);
  const bulkInputRef = useRef<HTMLInputElement>(null);
  const folderPreferencesKey = `study_closed_folders_v1:${session?.user.id || "local"}`;

  function navigate(target: "home" | "history" | "exam", replace = false) {
    const href = target === "home" ? "/" : `/${target}`;
    if (replace) router.replace(href);
    else router.push(href);
  }

  function navigateToSubject(subjectId: string) {
    router.push(`/courses/${encodeURIComponent(subjectId)}`);
  }

  useEffect(() => {
    if (!authChecked) return;
    const timer = window.setTimeout(() => {
      try {
        const stored = window.localStorage.getItem(folderPreferencesKey);
        const parsed = stored ? JSON.parse(stored) : [];
        setClosedFolders(
          Array.isArray(parsed)
            ? parsed.filter((item): item is string => typeof item === "string")
            : [],
        );
      } catch {
        setClosedFolders([]);
      }
      setFolderPreferencesReady(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [authChecked, folderPreferencesKey]);

  useEffect(() => {
    if (!folderPreferencesReady) return;
    try {
      window.localStorage.setItem(
        folderPreferencesKey,
        JSON.stringify(closedFolders),
      );
    } catch {
      // 表示設定の保存失敗は学習データの保存には影響させない。
    }
  }, [closedFolders, folderPreferencesKey, folderPreferencesReady]);
  const subject = subjects.find((s) => s.id === selected);
  useEffect(() => {
    if (
      initialView !== "subject" ||
      !subject ||
      subject.questionsLoaded !== false ||
      syncStatus !== "saved"
    )
      return;
    void runWithLoading("問題を読み込んでいます…", async () => {
      await ensureSubjectQuestions(subject.id);
    });
  }, [ensureSubjectQuestions, initialView, subject, syncStatus]);
  const stats = useMemo(
    () =>
      attempts.filter(
        (attempt) =>
          attempt.mode !== "exam" && attempt.subjectId === selected,
      ),
    [attempts, selected],
  );
  const studyAvailable =
    subject?.questions.filter((q) => studyTypes.includes(q.type)).length || 0;
  const examAttempts = useMemo(
    () => attempts.filter((attempt) => attempt.mode === "exam"),
    [attempts],
  );
  const latestExam = examAttempts[0];
  const examAvailable = subjects
    .filter((item) => examSubjectIds.includes(item.id))
    .reduce(
      (total, item) =>
        total +
        (item.questionsLoaded === false
          ? item.questionCount || 0
          : item.questions.filter((question) => examTypes.includes(question.type))
              .length),
      0,
    );
  const visibleSubjects = subjects.filter(
    (item) => showArchived || !item.archived,
  );
  const subjectGroups = useMemo(() => {
    const groups = new Map<string, Subject[]>();
    visibleSubjects.forEach((item) => {
      const key = item.folder?.trim() || "未分類";
      groups.set(key, [...(groups.get(key) || []), item]);
    });
    return [...groups.entries()];
  }, [visibleSubjects]);
  const saveSubject = (s: Subject) =>
    setSubjects((current) => upsertSubject(current, s));
  async function runWithLoading<T>(message: string, task: () => Promise<T>) {
    if (operationLock.current) return;
    operationLock.current = true;
    setLoadingMessage(message);
    await new Promise<void>((resolve) =>
      window.requestAnimationFrame(() => resolve()),
    );
    try {
      return await task();
    } finally {
      operationLock.current = false;
      setLoadingMessage(null);
    }
  }
  async function signOut() {
    await signOutCloud();
    setSelected("");
    navigate("home", true);
  }
  function deleteSubject() {
    if (!subject) return;
    if (
      !confirm(
        `「${subject.name}」を削除しますか？\n問題と成績履歴もこの端末から削除されます。`,
      )
    )
      return;
    setSubjects((v) => v.filter((s) => s.id !== subject.id));
    setAttempts((current) =>
      current.filter(
        (attempt) =>
          attempt.subjectId !== subject.id &&
          !attempt.subjectIds?.includes(subject.id),
      ),
    );
    setSelected("");
    navigate("home", true);
  }
  function deleteAttempt(attempt: Attempt) {
    if (
      !confirm(
        `${attempt.date}の結果を削除しますか？\nこの操作は取り消せません。`,
      )
    )
      return;
    setAttempts((current) => current.filter((item) => item.id !== attempt.id));
    setExpandedAttempt(null);
  }
  async function toggleAttemptDetails(attempt: Attempt) {
    if (expandedAttempt === attempt.id) {
      setExpandedAttempt(null);
      return;
    }
    if (attempt.answersLoaded !== false) {
      setExpandedAttempt(attempt.id);
      return;
    }
    setLoadingAttemptId(attempt.id);
    try {
      await ensureAttemptAnswers(attempt.id);
      setExpandedAttempt(attempt.id);
    } catch (error) {
      alert(
        `解答詳細を読み込めませんでした：${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    } finally {
      setLoadingAttemptId(null);
    }
  }
  async function addSubject() {
    const name = prompt("科目名を入力してください");
    if (!name) return;
    const folder = prompt("授業科目・フォルダ名（任意）")?.trim() || undefined;
    const url = prompt("スプレッドシートURL（後から設定する場合は空欄）") || "";
    if (url) {
      setPendingImport({ name: folder ? `${folder}\n${name}` : name, url });
      return;
    }
    const s = { id: uid(), name, folder, color: "#3167e3", questions: [] };
    saveSubject(s);
    setSelected(s.id);
    navigateToSubject(s.id);
  }
  async function finishImport(mode: "sync" | "copy") {
    if (!pendingImport) return;
    await runWithLoading(
      "スプレッドシートから問題を作成しています…",
      async () => {
        try {
          const questions = await loadSheet(pendingImport.url);
          const [folderOrName, importedName] = pendingImport.name.split("\n");
          const s: Subject = {
            id: uid(),
            name: importedName || folderOrName,
            ...(importedName ? { folder: folderOrName } : {}),
            color: "#3167e3",
            source: { url: pendingImport.url, mode },
            questions,
          };
          const nextSubjects = upsertSubject(subjects, s);
          setSubjects(nextSubjects);
          await saveNow({ subjects: nextSubjects, attempts });
          setSelected(s.id);
          navigateToSubject(s.id);
          setPendingImport(null);
        } catch (error) {
          alert(
            error instanceof Error
              ? error.message
              : "問題を作成・保存できませんでした。通信状態と公開CSV URLを確認してください。",
          );
        }
      },
    );
  }
  async function bulkImport(files: FileList | null) {
    if (!files?.length) return;
    const folder = prompt("まとめ先の授業科目・フォルダ名（任意）")?.trim();
    await runWithLoading(`${files.length}ファイルを読み込んでいます…`, async () => {
      const next = [...subjects];
      const errors: string[] = [];
      for (const file of Array.from(files)) {
        try {
          const questions = await loadQuestionFile(file);
          const name = file.name.replace(/\.(csv|xlsx?)$/i, "");
          const existing = next.find(
            (item) => item.name === name && (item.folder || "") === (folder || ""),
          );
          const value: Subject = existing
            ? { ...existing, questions }
            : {
                id: uid(),
                name,
                ...(folder ? { folder } : {}),
                color: "#3167e3",
                questions,
              };
          const index = next.findIndex((item) => item.id === value.id);
          if (index >= 0) next[index] = value;
          else next.push(value);
        } catch (error) {
          errors.push(`${file.name}: ${error instanceof Error ? error.message : "読込失敗"}`);
        }
      }
      setSubjects(next);
      await saveNow({ subjects: next, attempts });
      alert(
        errors.length
          ? `${files.length - errors.length}件を追加しました。\n\n${errors.join("\n")}`
          : `${files.length}件を追加しました`,
      );
    });
  }
  async function createFolder() {
    const folder = newFolderName.trim();
    if (!folder) return alert("フォルダ名を入力してください");
    if (!folderSubjectIds.length)
      return alert("未分類の問題セットを1つ以上選択してください");
    const nextSubjects = subjects.map((item) =>
      folderSubjectIds.includes(item.id)
        ? { ...item, folder, archived: item.archived || undefined }
        : item,
    );
    await runWithLoading("フォルダを作成しています…", async () => {
      setSubjects(nextSubjects);
      try {
        await saveNow({ subjects: nextSubjects, attempts });
        setShowFolderCreator(false);
        setNewFolderName("");
        setFolderSubjectIds([]);
      } catch {
        alert(
          "クラウドへの保存に失敗しました。この端末には変更が残っているため、同期を再試行してください。",
        );
      }
    });
  }
  async function reloadSettings() {
    if (!subjectSettings?.source?.url)
      return alert("CSV URLを入力してください");
    setSettingsLoading(true);
    try {
      const questions = await loadSheet(subjectSettings.source.url);
      setSubjectSettings({ ...subjectSettings, questions });
      alert(`${questions.length}問を読み込みました`);
    } catch (error) {
      alert(
        error instanceof Error
          ? error.message
          : "シートを読み込めませんでした。公開CSV URLを確認してください。",
      );
    } finally {
      setSettingsLoading(false);
    }
  }
  async function replaceSubjectFile(file: File) {
    if (!subjectSettings) return;
    setSettingsLoading(true);
    try {
      const questions = await loadQuestionFile(file);
      setSubjectSettings({
        ...subjectSettings,
        questions,
        // 端末ファイルは自動同期できないため、以後はコピー型として保持する。
        source: undefined,
      });
      alert(
        `${questions.length}問を読み込みました。問題セットIDと結果履歴はそのまま維持されます。「保存」を押すと差し替えが確定します。`,
      );
    } catch (error) {
      alert(
        error instanceof Error
          ? error.message
          : "ファイルを読み込めませんでした。",
      );
    } finally {
      setSettingsLoading(false);
    }
  }
  async function saveSettings() {
    if (!subjectSettings?.name.trim()) return alert("科目名を入力してください");
    let next = subjectSettings;
    if (subjectSettings.source?.url) {
      setSettingsLoading(true);
      try {
        next = {
          ...subjectSettings,
          questions: await loadSheet(subjectSettings.source.url),
        };
      } catch (error) {
        setSettingsLoading(false);
        return alert(
          error instanceof Error
            ? error.message
            : "CSVを読み込めませんでした。URLを確認してください。",
        );
      }
      setSettingsLoading(false);
    } else {
      const { source: _, ...withoutSource } = subjectSettings;
      void _;
      next = withoutSource;
    }
    saveSubject(next);
    setSubjectSettings(null);
  }
  async function openSubject(s: Subject) {
    await runWithLoading("問題を読み込んでいます…", async () => {
      let next = s;
      if (s.source?.mode === "sync") {
        try {
          next = { ...s, questions: await loadSheet(s.source.url) };
          saveSubject(next);
        } catch (error) {
          const reason =
            error instanceof Error
              ? `\n理由: ${error.message}`
              : "";
          alert(
            `同期に失敗したため、保存済みデータを表示します。${reason}`,
          );
        }
      }
      setSelected(s.id);
      navigateToSubject(s.id);
    });
  }
  async function saveQuestion() {
    if (!subject || !editing?.question.trim())
      return alert("問題文を入力してください");
    let nextQuestion = editing;
    if (editing.type === "choice") {
      const options = editing.options.map((option) => option.trim()).filter(Boolean);
      if (options.length < MIN_CHOICE_OPTIONS)
        return alert(`選択肢を${MIN_CHOICE_OPTIONS}個以上入力してください`);
      if (new Set(options).size !== options.length)
        return alert("同じ選択肢が重複しています");
      const answer = editing.answer.trim();
      if (!options.includes(answer))
        return alert("正解には、入力した選択肢と同じ文章を設定してください");
      nextQuestion = { ...editing, options, answer };
    }
    const nextSubject = {
      ...subject,
      questions: dedupeQuestions([
        ...subject.questions.filter((q) => q.id !== nextQuestion.id),
        nextQuestion,
      ]),
    };
    await runWithLoading("問題を保存しています…", async () => {
      const nextSubjects = upsertSubject(subjects, nextSubject);
      setSubjects(nextSubjects);
      try {
        await saveNow({ subjects: nextSubjects, attempts });
        setEditing(null);
      } catch {
        alert(
          "クラウドへの保存に失敗しました。内容はこの端末に残っているため、通信を確認して再試行してください。",
        );
      }
    });
  }
  async function openStudySetup() {
    if (!subject?.questions.length) return alert("問題を追加してください");
    await runWithLoading("学習履歴を確認しています…", async () => {
      await Promise.all(stats.map((attempt) => ensureAttemptAnswers(attempt.id)));
    });
    setStudyTypes(["choice", "ox", "fill", "essay"]);
    setStudyCount(String(subject.questions.length));
    setStudyExamMode(false);
    setStudyPassPercentage("90");
    setShowStudySetup(true);
  }
  function openExamSetup() {
    const availableSubjects = subjects.filter(
      (item) =>
        !item.archived && (item.questionCount ?? item.questions.length) > 0,
    );
    if (!availableSubjects.length)
      return alert("問題が登録された科目を追加してください");
    const subjectIds = availableSubjects.map((item) => item.id);
    const questionCount = availableSubjects.reduce(
      (total, item) => total + (item.questionCount ?? item.questions.length),
      0,
    );
    setExamSubjectIds(subjectIds);
    setExamTypes(["choice", "ox", "fill", "essay"]);
    setExamCount(String(questionCount));
    setExamPassPercentage("90");
    setSetupMode("exam");
    setShowExamSetup(true);
  }
  function openMixedStudySetup() {
    openExamSetup();
    setSetupMode("study");
  }
  function start() {
    if (!subject) return;
    const candidates = subject.questions.filter((q) =>
      studyTypes.includes(q.type),
    );
    if (!candidates.length) return alert("問題形式を1つ以上選択してください");
    const requestedCount = Number(studyCount);
    if (!Number.isInteger(requestedCount) || requestedCount < 1)
      return alert("1以上の数字を入力してください");
    const passPercentage = Number(studyPassPercentage);
    if (
      studyExamMode &&
      (!Number.isInteger(passPercentage) ||
        passPercentage < 1 ||
        passPercentage > 100)
    )
      return alert("合格基準は1〜100の整数で入力してください");
    let selectedQuestions: Question[];
    if (studyExamMode) {
      selectedQuestions = shuffle(candidates).slice(
        0,
        Math.min(requestedCount, candidates.length),
      );
    } else {
      const answerCounts = new Map<string, number>();
      stats.forEach((attempt) =>
        (attempt.answers || []).forEach((answer) =>
          answerCounts.set(
            answer.questionId,
            (answerCounts.get(answer.questionId) || 0) + 1,
          ),
        ),
      );
      selectedQuestions = candidates
        .map((question) => {
          const count = answerCounts.get(question.id) || 0;
          const weight = 1 + 3 / (count + 1);
          return { question, key: Math.pow(Math.random(), 1 / weight) };
        })
        .sort((a, b) => b.key - a.key)
        .slice(0, Math.min(requestedCount, candidates.length))
        .map((item) => item.question);
    }
    setActive(
      selectedQuestions.map((question) => ({
        ...shuffleChoiceOptions(question),
        sourceSubjectId: subject.id,
        sourceSubjectName: subject.name,
      })),
    );
    setIndex(0);
    setAnswers([]);
    setDraft("");
    setFeedback(null);
    setSubmitted(false);
    setLastInterrupted(false);
    setLastAttempt(null);
    setSessionMode(studyExamMode ? "exam" : "study");
    setExamSettings(
      studyExamMode
        ? {
            subjectIds: [subject.id],
            subjectNames: [subject.name],
            passPercentage,
          }
        : null,
    );
    setShowStudySetup(false);
    setView("play");
  }
  async function startExam() {
    if (!examSubjectIds.length) return alert("科目を1つ以上選択してください");
    if (!examTypes.length) return alert("問題形式を1つ以上選択してください");
    const requestedCount = Number(examCount);
    if (!Number.isInteger(requestedCount) || requestedCount < 1)
      return alert("問題数は1以上の数字を入力してください");
    const passPercentage = Number(examPassPercentage);
    if (
      !Number.isInteger(passPercentage) ||
      passPercentage < 1 ||
      passPercentage > 100
    )
      return alert("合格基準は1〜100の整数で入力してください");
    const selectedSubjects = subjects.filter((item) =>
      examSubjectIds.includes(item.id),
    );
    const loadedQuestions = await Promise.all(
      selectedSubjects.map((item) => ensureSubjectQuestions(item.id)),
    );
    const targetSubjects = selectedSubjects.map((item, position) => ({
      ...item,
      questions: loadedQuestions[position],
      questionsLoaded: true,
    }));
    const candidates = targetSubjects.flatMap((item) =>
      item.questions
        .filter((question) => examTypes.includes(question.type))
        .map((question) => ({
          ...question,
          sourceSubjectId: item.id,
          sourceSubjectName: item.name,
        })),
    );
    if (!candidates.length) return alert("出題できる問題がありません");
    const selectedQuestions = shuffle(candidates)
      .slice(0, Math.min(requestedCount, candidates.length))
      .map(shuffleChoiceOptions);
    const subjectNames = targetSubjects.map((item) => item.name);
    setActive(selectedQuestions);
    setIndex(0);
    setAnswers([]);
    setDraft("");
    setFeedback(null);
    setSubmitted(false);
    setLastInterrupted(false);
    setLastAttempt(null);
    setSessionMode(setupMode);
    setExamSettings({
      subjectIds: targetSubjects.map((item) => item.id),
      subjectNames,
      passPercentage,
    });
    setSelected(targetSubjects[0]?.id || "");
    setShowExamSetup(false);
    setView("play");
  }
  function submit() {
    const q = active[index];
    let correct: boolean | null = null;
    if (q.type !== "essay")
      correct = draft.trim().toLowerCase() === q.answer.trim().toLowerCase();
    const record: Attempt["answers"][number] = {
      questionId: q.id,
      subjectId: q.sourceSubjectId,
      subjectName: q.sourceSubjectName,
      question: q.question,
      type: q.type,
      answer: draft,
      correct,
      correctAnswer: q.answer,
      explanation: q.explanation,
      modelAnswer: q.modelAnswer,
      rubric: q.rubric,
    };
    const nextAnswers = [...answers, record];
    setAnswers(nextAnswers);
    if (sessionMode === "exam") {
      if (index + 1 < active.length) {
        setIndex((current) => current + 1);
        setDraft("");
      } else {
        saveAttempt(false, nextAnswers);
      }
      return;
    }
    setFeedback(correct);
    setSubmitted(true);
  }
  async function saveAttempt(
    interrupted: boolean,
    answerOverride: Attempt["answers"] = answers,
  ) {
    const scored = answerOverride;
    if (!scored.length) {
      if (interrupted) {
        alert("まだ回答した問題がないため、結果は保存されません");
        if (sessionMode === "exam") navigate("home");
        else setView("subject");
      }
      return;
    }
    const baseAttempt: Attempt = {
      id: uid(),
      subjectId: selected,
      date: new Date().toLocaleString("ja-JP"),
      score: scored.filter((x) => x.correct).length,
      total: scored.filter((x) => x.correct !== null).length,
      answers: scored,
      status: interrupted ? "interrupted" : "completed",
    };
    const attempt: Attempt =
      sessionMode === "exam" && examSettings
        ? {
            ...baseAttempt,
            ...scoreExam(scored, examSettings.passPercentage),
            mode: "exam",
            subjectIds: examSettings.subjectIds,
            subjectNames: examSettings.subjectNames,
            passPercentage: examSettings.passPercentage,
            passed: interrupted
              ? undefined
              : scoreExam(scored, examSettings.passPercentage).passed,
          }
        : {
            ...baseAttempt,
            mode: "study",
            ...(examSettings
              ? {
                  subjectIds: examSettings.subjectIds,
                  subjectNames: examSettings.subjectNames,
                }
              : {}),
          };
    const nextAttempts = [
      attempt,
      ...attempts.filter((item) => item.id !== attempt.id),
    ].slice(0, 100);
    setAttempts(nextAttempts);
    setLastAttempt(attempt);
    setLastInterrupted(interrupted);
    setResultSaving(true);
    setResultSaveError(false);
    setView("result");
    try {
      await saveNow({ subjects, attempts: nextAttempts });
    } catch {
      setResultSaveError(true);
    } finally {
      setResultSaving(false);
    }
  }
  async function retryResultSave() {
    setResultSaving(true);
    setResultSaveError(false);
    try {
      await saveNow();
    } catch {
      setResultSaveError(true);
    } finally {
      setResultSaving(false);
    }
  }
  function next() {
    if (index + 1 < active.length) {
      setIndex((i) => i + 1);
      setDraft("");
      setFeedback(null);
      setSubmitted(false);
    } else {
      saveAttempt(false);
    }
  }
  function exportEssayText(attemptId?: string) {
    const latest = attemptId
      ? attempts.find((a) => a.id === attemptId)
      : lastAttempt ||
        (subject
          ? attempts.find((a) => a.subjectId === subject.id)
          : undefined);
    const essay =
      latest?.answers.filter(
        (answer) => answer.type === "essay",
      ) || [];
    if (!essay.length) return alert("出力できる論述答案がありません");
    const subjectLabel =
      latest?.subjectNames?.join("・") || subject?.name || "試験モード";
    const instruction = [
      "【AIへの指示】",
      "あなたは大学の試験答案を採点する教員です。",
      "以下の各設問について、受験者の回答を模範解答と採点ポイントに照らして評価してください。",
      "採点後はExcel（.xlsx）ファイルを1つ作成してください。",
      "1行目の列名は必ず attemptId, subjectId, questionId, score, assessment, goodPoints, missingPoints, improvedAnswer としてください。",
      "attemptId、subjectId、questionIdは各設問に記載された値を一字も変更せず使用してください。",
      "scoreは0から100の数値、その他の列は日本語の文章で入力してください。",
      "設問ごとに1行とし、列の追加・削除やセル結合はしないでください。",
      "資料にない事実を推測で補わず、採点ポイントを重視してください。",
    ].join("\n");
    const body = essay
      .map((answer, i) => {
        const current = subjects
          .find(
            (item) =>
              item.id ===
              (answer.subjectId || latest?.subjectId || subject?.id),
          )
          ?.questions.find((q) => q.id === answer.questionId);
        return [
          `【設問${i + 1}】`,
          `科目: ${answer.subjectName || subjectLabel}`,
          `attemptId: ${latest?.id || ""}`,
          `subjectId: ${answer.subjectId || latest?.subjectId || ""}`,
          `questionId: ${answer.questionId}`,
          answer.question || current?.question || "問題文なし",
          "",
          "【受験者の回答】",
          answer.answer || "（未回答）",
          "",
          "【模範解答】",
          answer.modelAnswer || current?.modelAnswer || "未設定",
          "",
          "【採点ポイント】",
          answer.rubric || current?.rubric || "未設定",
        ].join("\n");
      })
      .join("\n\n----------------------------------------\n\n");
    const text = [
      `科目：${subjectLabel}`,
      `実施日時：${latest?.date || new Date().toLocaleString("ja-JP")}`,
      "",
      instruction,
      "",
      "========================================",
      "",
      body,
    ].join("\n");
    const blob = new Blob(["\uFEFF", text], {
      type: "text/plain;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${subjectLabel}-論述答案.txt`;
    link.click();
    URL.revokeObjectURL(url);
  }
  async function importEssayGrades(file: File, attemptId: string) {
    try {
      const XLSX = await import("xlsx");
      const data = await file.arrayBuffer();
      const workbook = XLSX.read(data, { type: "array" });
      const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(
        firstSheet,
        {
          defval: "",
        },
      );
      const grades = new Map<string, EssayGrading>();
      for (const row of rows) {
        const rowAttemptId = String(row.attemptId || "").trim();
        const subjectId = String(row.subjectId || "").trim();
        const questionId = String(row.questionId || "").trim();
        const score = Number(row.score);
        if (rowAttemptId !== attemptId || !questionId) continue;
        if (!Number.isFinite(score) || score < 0 || score > 100) continue;
        grades.set(`${subjectId}:${questionId}`, {
          score,
          assessment: String(row.assessment || ""),
          goodPoints: String(row.goodPoints || ""),
          missingPoints: String(row.missingPoints || ""),
          improvedAnswer: String(row.improvedAnswer || ""),
          importedAt: new Date().toLocaleString("ja-JP"),
        });
      }
      if (!grades.size) {
        return alert(
          "取り込める採点結果がありません。実施回ID・問題ID・列名を確認してください。",
        );
      }
      setAttempts((current) =>
        current.map((attempt) => {
          if (attempt.id !== attemptId) return attempt;
          const nextAnswers = attempt.answers.map((answer) => {
            const exactKey = `${answer.subjectId || ""}:${answer.questionId}`;
            const legacyKey = `:${answer.questionId}`;
            const grading = grades.get(exactKey) || grades.get(legacyKey);
            return grading ? { ...answer, grading } : answer;
          });
          return attempt.mode === "exam"
            ? {
                ...attempt,
                ...scoreExam(nextAnswers, attempt.passPercentage || 90),
                answers: nextAnswers,
              }
            : { ...attempt, answers: nextAnswers };
        }),
      );
      alert(`${grades.size}問分のAI採点結果を取り込みました`);
    } catch {
      alert("Excelファイルを読み込めませんでした");
    }
  }
  if (!ready || !authChecked)
    return (
      <main className="min-h-screen grid place-items-center">読み込み中…</main>
    );
  if (isSupabaseConfigured && !session) return <AuthScreen />;
  return (
    <main className="min-h-screen">
      <header className="bg-[#17233f] text-white px-5 py-4">
        <div className="max-w-5xl mx-auto flex justify-between items-center">
          <button
            onClick={() => navigate("home")}
            className="font-black text-xl"
          >
            Study Studio
          </button>
          <div className="flex items-center gap-3 text-right">
            <div>
              {syncStatus === "error" ? (
                <button
                  onClick={retrySync}
                  className="text-xs font-bold text-amber-300"
                >
                  同期エラー・再試行
                </button>
              ) : (
                <p className="text-xs text-blue-200">
                  {syncStatus === "saved"
                    ? "クラウドに保存済み"
                    : syncStatus === "saving"
                      ? "保存中…"
                      : syncStatus === "loading"
                        ? "同期中…"
                        : "端末内に保存"}
                </p>
              )}
              {session?.user.email && (
                <p className="hidden text-xs text-white/70 sm:block">
                  {session.user.email}
                </p>
              )}
            </div>
            {session && (
              <button
                onClick={signOut}
                className="rounded-lg border border-white/30 px-3 py-2 text-xs font-bold"
              >
                ログアウト
              </button>
            )}
          </div>
        </div>
      </header>
      {(!diagnostics.storageHealthy ||
        syncStatus === "error" ||
        !diagnostics.supabaseConfigured) && (
        <div className="bg-amber-50 px-5 py-3 text-sm text-amber-900">
          <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3">
            <p className="font-bold">
              {!diagnostics.storageHealthy
                ? "この端末の保存に失敗しています（容量不足やプライベートモードの可能性）。データが消える前にバックアップをダウンロードしてください。"
                : syncStatus === "error"
                  ? "クラウドに保存できていません。この端末には残っていますが、他の端末には反映されません。"
                  : "クラウド同期が無効です。データはこの端末にだけ保存され、他の端末では見られません。"}
            </p>
            {syncStatus === "error" && (
              <button
                onClick={retrySync}
                className="rounded-lg bg-amber-600 px-4 py-2 font-bold text-white"
              >
                再試行
              </button>
            )}
          </div>
        </div>
      )}
      {loadingMessage && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-white/85 p-6 backdrop-blur-sm">
          <div className="text-center">
            <div className="mx-auto h-11 w-11 animate-spin rounded-full border-4 border-blue-100 border-t-blue-600" />
            <p className="mt-4 font-bold text-gray-700">{loadingMessage}</p>
            <p className="mt-1 text-sm text-gray-500">
              そのままお待ちください
            </p>
          </div>
        </div>
      )}
      <div className="max-w-5xl mx-auto p-4 md:p-8">
        {view === "home" && (
          <>
            <div className="mb-6">
              <div className="grid w-full gap-2 sm:grid-cols-3">
                <input
                  ref={bulkInputRef}
                  type="file"
                  multiple
                  accept=".csv,.xlsx,.xls"
                  className="hidden"
                  onChange={(event) => {
                    void bulkImport(event.target.files);
                    event.target.value = "";
                  }}
                />
                <button
                  onClick={() => bulkInputRef.current?.click()}
                  className="h-12 w-full rounded-xl border border-blue-600 px-4 font-bold text-blue-700"
                >
                  複数ファイルを一括追加
                </button>
                <button
                  onClick={() => {
                    const unclassified = subjects.filter(
                      (item) => !item.folder?.trim(),
                    );
                    if (!unclassified.length)
                      return alert("未分類の問題セットはありません");
                    setNewFolderName("");
                    setFolderSubjectIds([]);
                    setShowFolderCreator(true);
                  }}
                  className="h-12 w-full rounded-xl border border-blue-600 px-4 font-bold text-blue-700"
                >
                  ＋ フォルダを作成
                </button>
                <button
                  onClick={addSubject}
                  className="h-12 w-full rounded-xl bg-blue-600 px-5 font-bold text-white"
                >
                  ＋ 問題セットを追加
                </button>
              </div>
            </div>
            <div className="mb-6 grid gap-3 sm:grid-cols-3">
              <button
                onClick={openMixedStudySetup}
                className="card min-h-28 p-5 text-left hover:border-blue-400"
              >
                <b className="text-lg">横断学習</b>
                <span className="mt-1 block text-sm text-gray-500">
                  複数の問題セットから通常学習
                </span>
              </button>
              <button
                onClick={() => navigate("exam")}
                className="card min-h-28 p-5 text-left hover:border-blue-400"
              >
                <b className="text-lg">試験モード</b>
                <span className="mt-1 block text-sm text-gray-500">
                  合格基準つきの試験と結果
                </span>
              </button>
              <button
                onClick={() => navigate("history")}
                className="card min-h-28 p-5 text-left hover:border-blue-400"
              >
                <b className="text-lg">すべての結果</b>
                <span className="mt-1 block text-sm text-gray-500">
                  {attempts.length}件の履歴をまとめて確認
                </span>
              </button>
            </div>
            <div className="mb-4 flex flex-wrap justify-end gap-4">
              <button
                type="button"
                onClick={() =>
                  setClosedFolders((current) =>
                    current.length === subjectGroups.length
                      ? []
                      : subjectGroups.map(([folder]) => folder),
                  )
                }
                className="text-sm font-bold text-blue-700"
              >
                {closedFolders.length === subjectGroups.length
                  ? "すべてのフォルダを開く"
                  : "すべてのフォルダを閉じる"}
              </button>
              <label className="flex items-center gap-2 text-sm text-gray-600">
                <input
                  type="checkbox"
                  checked={showArchived}
                  onChange={(event) => setShowArchived(event.target.checked)}
                />
                非表示の問題セットも表示
              </label>
            </div>
            {false && (
            <section className="card mb-6 overflow-hidden">
              <div className="bg-gradient-to-r from-[#17233f] to-blue-700 p-6 text-white md:p-8">
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div>
                    <p className="text-sm font-bold text-blue-200">
                      複数科目からランダム出題
                    </p>
                    <h2 className="mt-1 text-2xl font-black">試験モード</h2>
                    <p className="mt-2 text-sm text-blue-100">
                      途中では正誤を表示せず、終了後に合否と間違えた問題をまとめて確認できます
                    </p>
                  </div>
                  <button
                    onClick={openExamSetup}
                    className="rounded-xl bg-white px-6 py-3 font-black text-blue-700"
                  >
                    試験を設定して開始
                  </button>
                </div>
                <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-3">
                  <div className="rounded-xl bg-white/10 p-4">
                    <p className="text-xs text-blue-200">受験回数</p>
                    <p className="mt-1 text-2xl font-black">
                      {examAttempts.length}回
                    </p>
                  </div>
                  <div className="rounded-xl bg-white/10 p-4">
                    <p className="text-xs text-blue-200">合格回数</p>
                    <p className="mt-1 text-2xl font-black">
                      {
                        examAttempts.filter(
                          (attempt) =>
                            attempt.status !== "interrupted" && attempt.passed,
                        ).length
                      }
                      回
                    </p>
                  </div>
                  <div className="col-span-2 rounded-xl bg-white/10 p-4 md:col-span-1">
                    <p className="text-xs text-blue-200">最新結果</p>
                    <p className="mt-1 text-lg font-black">
                      {!latestExam
                        ? "未受験"
                        : latestExam.status === "interrupted"
                          ? "途中中断"
                          : latestExam.essayPending
                            ? "論述採点待ち"
                            : latestExam.passed
                              ? "合格"
                              : "不合格"}
                    </p>
                    {latestExam && (
                      <p className="mt-1 text-xs text-blue-100">
                        {latestExam.percentage ?? 0}%／合格基準
                        {latestExam.passPercentage ?? 90}%
                      </p>
                    )}
                  </div>
                </div>
              </div>
              {examAttempts.length > 0 && (
                <div className="p-5 md:p-6">
                  <h3 className="font-black">最近の試験結果</h3>
                  <div className="mt-3 space-y-2">
                    {examAttempts.slice(0, 5).map((attempt) => (
                      <div key={attempt.id} className="rounded-xl border">
                        <div className="flex flex-wrap items-center justify-between gap-3 p-3">
                          <div>
                            <p className="font-bold">
                              {attempt.subjectNames?.join("・") || "試験モード"}
                            </p>
                            <p className="mt-1 text-xs text-gray-500">
                              {attempt.date}・{attempt.answers.length}
                              問・合格基準
                              {attempt.passPercentage ?? 90}%・不正解
                              {summarizeAnswers(attempt.answers).incorrect}問
                            </p>
                          </div>
                          <div className="flex items-center gap-3">
                            <span
                              className={`font-black ${
                                attempt.status === "interrupted"
                                  ? "text-gray-500"
                                  : attempt.essayPending
                                    ? "text-amber-600"
                                    : attempt.passed
                                      ? "text-green-600"
                                      : "text-red-600"
                              }`}
                            >
                              {attempt.status === "interrupted"
                                ? "途中中断"
                                : attempt.essayPending
                                  ? "採点待ち"
                                  : attempt.passed
                                    ? `合格 ${attempt.percentage}%`
                                    : `不合格 ${attempt.percentage}%`}
                            </span>
                            {attempt.answers.some(
                              (answer) => answer.type === "essay",
                            ) && (
                              <>
                                <button
                                  onClick={() => exportEssayText(attempt.id)}
                                  className="text-sm font-bold text-blue-700"
                                >
                                  答案出力
                                </button>
                                <label className="cursor-pointer text-sm font-bold text-blue-700">
                                  採点取込
                                  <input
                                    type="file"
                                    accept=".xlsx"
                                    className="hidden"
                                    onChange={(event) => {
                                      const file = event.target.files?.[0];
                                      if (file)
                                        importEssayGrades(file, attempt.id);
                                      event.target.value = "";
                                    }}
                                  />
                                </label>
                              </>
                            )}
                            <button
                              onClick={() =>
                                setExpandedExam(
                                  expandedExam === attempt.id
                                    ? null
                                    : attempt.id,
                                )
                              }
                              className="rounded-lg border border-blue-600 px-3 py-1 text-sm font-bold text-blue-700"
                            >
                              {expandedExam === attempt.id
                                ? "閉じる ▲"
                                : "結果を見る ▼"}
                            </button>
                            <button
                              onClick={() => deleteAttempt(attempt)}
                              className="text-sm font-bold text-red-500"
                            >
                              削除
                            </button>
                          </div>
                        </div>
                        {expandedExam === attempt.id && (
                          <div className="border-t p-4">
                            <AnswerBreakdown answers={attempt.answers} />
                            <div className="mt-6 border-t pt-5">
                              <h4 className="mb-3 font-black">
                                問題ごとの結果
                              </h4>
                              <AnswerReviewList
                                answers={attempt.answers}
                                subjects={subjects}
                                fallbackSubjectId={attempt.subjectId}
                                showSubject
                              />
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </section>
            )}
            <div className="space-y-6">
              {subjectGroups.map(([folder, items]) => (
                <section
                  key={folder}
                  style={{
                    contentVisibility: "auto",
                    containIntrinsicSize: "1px 320px",
                  }}
                >
                  <button
                    type="button"
                    onClick={() =>
                      setClosedFolders((current) =>
                        current.includes(folder)
                          ? current.filter((item) => item !== folder)
                          : [...current, folder],
                      )
                    }
                    aria-expanded={!closedFolders.includes(folder)}
                    className="mb-3 flex w-full items-center justify-between rounded-xl px-2 py-2 text-left hover:bg-gray-100"
                  >
                    <span className="text-lg font-black text-gray-700">
                      {folder}
                      <span className="ml-2 text-sm font-normal text-gray-400">
                        {items.length}件
                      </span>
                    </span>
                    <span className="text-sm font-bold text-blue-700">
                      {closedFolders.includes(folder) ? "開く ▼" : "閉じる ▲"}
                    </span>
                  </button>
                  {!closedFolders.includes(folder) && (
                  <div className="grid gap-4 md:grid-cols-2">
                    {items.map((s) => (
                      <button
                        key={s.id}
                        onClick={() => openSubject(s)}
                        className={`card p-6 text-left transition hover:-translate-y-1 ${s.archived ? "opacity-60" : ""}`}
                      >
                        <div className="flex justify-between gap-3">
                          <h3 className="text-xl font-black">{s.name}</h3>
                          <span className="inline-flex h-10 min-w-16 shrink-0 self-start items-center justify-center whitespace-nowrap rounded-full bg-blue-50 px-3 text-sm text-blue-700">
                            {s.questionCount ?? s.questions.length}問
                          </span>
                        </div>
                        <p className="mt-5 text-sm text-gray-500">
                          {s.archived && "非表示・"}
                          {s.source
                            ? s.source.mode === "sync"
                              ? "スプレッドシート同期"
                              : "スプレッドシートからコピー"
                            : "アプリ内／ファイルから作成"}
                        </p>
                      </button>
                    ))}
                  </div>
                  )}
                </section>
              ))}
            </div>
            {!visibleSubjects.length && (
              <div className="card text-center p-14 text-gray-500">
                「科目を追加」から始めましょう
              </div>
            )}
            <DataHealth
              diagnostics={diagnostics}
              snapshot={{ subjects, attempts }}
              onBuildBackup={getCompleteSnapshot}
              onSaveNow={() => saveNow()}
              onRestore={restoreSnapshot}
            />
          </>
        )}
        {view === "exam" && (
          <>
            <button onClick={() => navigate("home")} className="mb-5 text-gray-500">
              ← 学習ライブラリ
            </button>
            <div className="card p-6 md:p-8">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-bold text-blue-600">TEST MODE</p>
                  <h1 className="mt-1 text-3xl font-black">試験モード</h1>
                  <p className="mt-2 text-gray-500">
                    単一または複数の授業科目から出題し、終了後に合否を判定します
                  </p>
                </div>
                <button
                  onClick={openExamSetup}
                  className="rounded-xl bg-blue-600 px-6 py-3 font-black text-white"
                >
                  新しい試験を開始
                </button>
              </div>
              <div className="mt-7 grid grid-cols-3 gap-3">
                <div className="rounded-xl bg-gray-50 p-4">
                  <p className="text-xs text-gray-500">受験</p>
                  <p className="text-2xl font-black">{examAttempts.length}回</p>
                </div>
                <div className="rounded-xl bg-gray-50 p-4">
                  <p className="text-xs text-gray-500">合格</p>
                  <p className="text-2xl font-black">
                    {examAttempts.filter((a) => a.passed).length}回
                  </p>
                </div>
                <div className="rounded-xl bg-gray-50 p-4">
                  <p className="text-xs text-gray-500">最新</p>
                  <p className="text-2xl font-black">
                    {latestExam?.percentage ?? "—"}{latestExam ? "%" : ""}
                  </p>
                </div>
              </div>
              <div className="mt-7 space-y-3">
                {examAttempts.map((attempt) => (
                  <button
                    key={attempt.id}
                    onClick={() => {
                      setExpandedAttempt(attempt.id);
                      navigate("history");
                    }}
                    className="w-full rounded-xl border p-4 text-left"
                  >
                    <span className="font-bold">
                      {attempt.subjectNames?.join("・") || "試験"}
                    </span>
                    <span className="float-right font-black text-blue-700">
                      {attempt.status === "interrupted"
                        ? "途中中断"
                        : `${attempt.percentage ?? 0}%・${attempt.passed ? "合格" : "不合格"}`}
                    </span>
                    <span className="mt-1 block text-xs text-gray-500">
                      {attempt.date}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </>
        )}
        {view === "history" && (
          <>
            <button onClick={() => navigate("home")} className="mb-5 text-gray-500">
              ← 学習ライブラリ
            </button>
            <div className="card p-6 md:p-8">
              <h1 className="text-3xl font-black">すべての結果</h1>
              <p className="mt-1 text-gray-500">
                通常学習と試験の履歴を新しい順に表示しています
              </p>
              <div className="mt-6 space-y-3">
                {attempts.map((attempt) => {
                  const rate =
                    attempt.percentage ??
                    (attempt.total
                      ? Math.round((attempt.score / attempt.total) * 100)
                      : null);
                  return (
                    <div key={attempt.id} className="overflow-hidden rounded-xl border">
                      <button
                        onClick={() => void toggleAttemptDetails(attempt)}
                        disabled={loadingAttemptId === attempt.id}
                        className="w-full p-4 text-left"
                      >
                        <span className="font-bold">
                          {attempt.subjectNames?.join("・") ||
                            subjects.find((s) => s.id === attempt.subjectId)?.name ||
                            "削除済みの科目"}
                        </span>
                        <span className="float-right font-black text-blue-700">
                          {rate === null
                            ? "論述のみ"
                            : `${attempt.score}/${attempt.total}（${rate}%）`}
                        </span>
                        <span className="mt-1 block text-xs text-gray-500">
                          {attempt.mode === "exam" ? "試験" : "通常学習"}・
                          {attempt.date}
                          {attempt.status === "interrupted" && "・途中中断"}
                          {loadingAttemptId === attempt.id && "・詳細を読込中…"}
                        </span>
                      </button>
                      {expandedAttempt === attempt.id && (
                        <div className="border-t p-4">
                          <AnswerReviewList
                            answers={attempt.answers}
                            subjects={subjects}
                            fallbackSubjectId={attempt.subjectId}
                            showSubject
                          />
                          <button
                            onClick={() => deleteAttempt(attempt)}
                            className="mt-4 text-sm font-bold text-red-600"
                          >
                            この結果を削除
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
                {!attempts.length && (
                  <p className="py-10 text-center text-gray-500">結果はまだありません</p>
                )}
              </div>
            </div>
          </>
        )}
        {view === "subject" && subject && (
          <>
            <button
              onClick={() => navigate("home")}
              className="text-gray-500 mb-5"
            >
              ← 科目一覧
            </button>
            <div className="card p-6 md:p-8">
              <div className="flex flex-wrap justify-between gap-4">
                <div>
                  <h1 className="text-3xl font-black">{subject.name}</h1>
                  <p className="text-gray-500 mt-2">
                    {subject.questionCount ?? subject.questions.length}問・挑戦
                    {stats.length}回
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() =>
                      setSubjectSettings({
                        ...subject,
                        source: subject.source
                          ? { ...subject.source }
                          : undefined,
                        questions: [...subject.questions],
                      })
                    }
                    className="border border-blue-300 text-blue-700 px-4 py-3 rounded-xl font-bold"
                  >
                    科目設定
                  </button>
                  <button
                    onClick={deleteSubject}
                    className="border border-red-300 text-red-600 px-4 py-3 rounded-xl font-bold"
                  >
                    科目を削除
                  </button>
                  <button
                    onClick={() => setView("manage")}
                    className="border px-4 py-3 rounded-xl font-bold"
                  >
                    問題管理
                  </button>
                  <button
                    onClick={openStudySetup}
                    className="bg-blue-600 text-white px-6 py-3 rounded-xl font-bold"
                  >
                    学習開始
                  </button>
                </div>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-8">
                {(["choice", "ox", "fill", "essay"] as QType[]).map((t) => (
                  <div key={t} className="bg-gray-50 rounded-xl p-4">
                    <p className="text-sm text-gray-500">{typeName[t]}</p>
                    <p className="text-2xl font-black mt-1">
                      {subject.questions.filter((q) => q.type === t).length}
                    </p>
                  </div>
                ))}
              </div>
              {stats.length > 0 && (
                <div className="mt-8 border-t pt-6">
                  <h2 className="font-black text-xl mb-3">結果履歴</h2>
                  <div className="space-y-3">
                    {stats.map((a) => (
                      <div
                        key={a.id}
                        className="border rounded-xl overflow-hidden"
                      >
                        <button
                          onClick={() => void toggleAttemptDetails(a)}
                          disabled={loadingAttemptId === a.id}
                          className="w-full flex justify-between p-4 text-left bg-gray-50"
                        >
                          <span>
                            <b>{a.date}</b>
                            <span className="block text-xs text-gray-500 mt-1">
                              {a.total}問の回答記録
                              {a.status === "interrupted" && "・途中中断"}
                            </span>
                          </span>
                          <span className="text-right">
                            <b className="text-blue-700 text-lg">
                              {a.total > 0
                                ? `${a.score}/${a.total}（${Math.round((a.score / a.total) * 100)}%）`
                                : "論述のみ"}
                            </b>
                            <span className="block text-xs text-gray-500">
                              {loadingAttemptId === a.id
                                ? "読込中…"
                                : expandedAttempt === a.id
                                  ? "閉じる ▲"
                                  : "詳細 ▼"}
                            </span>
                          </span>
                        </button>
                        {expandedAttempt === a.id && (
                          <div className="p-4 space-y-4">
                            <AnswerReviewList
                              answers={a.answers || []}
                              subjects={subjects}
                              fallbackSubjectId={a.subjectId}
                            />
                            {a.answers.some(
                              (answer) => answer.type === "essay",
                            ) && (
                              <div className="flex flex-wrap gap-3 pt-2">
                                <button
                                  onClick={() => exportEssayText(a.id)}
                                  className="border border-blue-600 text-blue-700 px-4 py-2 rounded-lg font-bold"
                                >
                                  AI採点用テキストを出力
                                </button>
                                <label className="bg-blue-600 text-white px-4 py-2 rounded-lg font-bold cursor-pointer">
                                  AI採点結果のExcelを取込
                                  <input
                                    type="file"
                                    accept=".xlsx"
                                    className="hidden"
                                    onChange={(event) => {
                                      const file = event.target.files?.[0];
                                      if (file) importEssayGrades(file, a.id);
                                      event.target.value = "";
                                    }}
                                  />
                                </label>
                              </div>
                            )}
                            <div className="mt-4 border-t pt-4">
                              <button
                                onClick={() => deleteAttempt(a)}
                                className="rounded-lg border border-red-300 px-4 py-2 font-bold text-red-600 hover:bg-red-50"
                              >
                                この結果を削除
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                  <button
                    onClick={() => exportEssayText()}
                    className="mt-5 border border-blue-600 text-blue-600 px-5 py-2 rounded-lg font-bold"
                  >
                    最新の論述答案をテキスト出力
                  </button>
                </div>
              )}
            </div>
          </>
        )}
        {view === "manage" && subject && (
          <>
            <div className="flex justify-between mb-5">
              <button onClick={() => setView("subject")}>← 科目へ</button>
              <button
                onClick={() => setEditing(blankQuestion())}
                className="bg-blue-600 text-white px-4 py-2 rounded-lg font-bold"
              >
                ＋ 問題作成
              </button>
            </div>
            <div className="space-y-3">
              {subject.questions.map((q) => (
                <div key={q.id} className="card p-4 flex justify-between gap-4">
                  <div>
                    <span className="text-xs bg-gray-100 px-2 py-1 rounded">
                      {typeName[q.type]}
                    </span>
                    <p className="font-bold mt-2">{q.question}</p>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => setEditing({ ...q })}>編集</button>
                    <button
                      className="text-red-500"
                      onClick={() =>
                        confirm("削除しますか？") &&
                        saveSubject({
                          ...subject,
                          questions: subject.questions.filter(
                            (x) => x.id !== q.id,
                          ),
                        })
                      }
                    >
                      削除
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
        {editing && (
          <div className="fixed inset-0 bg-black/40 p-4 grid place-items-center z-10">
            <div className="card p-6 w-full max-w-2xl max-h-[90vh] overflow-auto">
              <h2 className="text-xl font-black mb-4">問題を作成・編集</h2>
              <label>
                形式
                <select
                  value={editing.type}
                  onChange={(e) => {
                    const type = e.target.value as QType;
                    setEditing({
                      ...editing,
                      type,
                      options:
                        type === "choice" &&
                        editing.options.length < MIN_CHOICE_OPTIONS
                          ? ["", "", "", ""]
                          : editing.options,
                    });
                  }}
                  className="block w-full border p-3 rounded-lg mt-1 mb-4"
                >
                  {Object.entries(typeName).map(([v, n]) => (
                    <option key={v} value={v}>
                      {n}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                問題文
                <textarea
                  value={editing.question}
                  onChange={(e) =>
                    setEditing({ ...editing, question: e.target.value })
                  }
                  className="block w-full border p-3 rounded-lg mt-1 mb-4"
                  rows={3}
                />
              </label>
              {editing.type === "choice" && (
                <div className="mb-4">
                  <p className="mb-2 text-sm font-bold">
                    選択肢（{MIN_CHOICE_OPTIONS}〜{MAX_CHOICE_OPTIONS}個）
                  </p>
                  {editing.options.map((option, index) => (
                    <div key={index} className="mb-2 flex gap-2">
                      <input
                        placeholder={`選択肢${index + 1}`}
                        value={option}
                        onChange={(event) => {
                          const options = [...editing.options];
                          options[index] = event.target.value;
                          setEditing({ ...editing, options });
                        }}
                        className="min-w-0 flex-1 rounded-lg border p-3"
                      />
                      <button
                        type="button"
                        disabled={editing.options.length <= MIN_CHOICE_OPTIONS}
                        onClick={() => {
                          const removed = editing.options[index];
                          const options = editing.options.filter(
                            (_, optionIndex) => optionIndex !== index,
                          );
                          setEditing({
                            ...editing,
                            options,
                            answer:
                              editing.answer === removed &&
                              !options.includes(removed)
                                ? ""
                                : editing.answer,
                          });
                        }}
                        className="rounded-lg border px-3 text-red-600 disabled:text-gray-300"
                      >
                        削除
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    disabled={editing.options.length >= MAX_CHOICE_OPTIONS}
                    onClick={() =>
                      setEditing({
                        ...editing,
                        options: [...editing.options, ""],
                      })
                    }
                    className="rounded-lg border border-blue-600 px-4 py-2 text-sm font-bold text-blue-700 disabled:border-gray-300 disabled:text-gray-400"
                  >
                    ＋ 選択肢を追加
                  </button>
                </div>
              )}
              {editing.type !== "essay" && (
                <label>
                  正解
                  <input
                    value={editing.answer}
                    onChange={(e) =>
                      setEditing({ ...editing, answer: e.target.value })
                    }
                    placeholder={
                      editing.type === "choice"
                        ? "正解の選択肢本文"
                        : editing.type === "ox"
                          ? "○ または ×"
                          : "穴埋めの正解"
                    }
                    className="block w-full border p-3 rounded-lg mt-1 mb-4"
                  />
                </label>
              )}
              <label>
                解説
                <textarea
                  value={editing.explanation}
                  onChange={(e) =>
                    setEditing({ ...editing, explanation: e.target.value })
                  }
                  className="block w-full border p-3 rounded-lg mt-1 mb-4"
                />
              </label>
              {editing.type === "essay" && (
                <>
                  <label>
                    模範解答
                    <textarea
                      value={editing.modelAnswer}
                      onChange={(e) =>
                        setEditing({ ...editing, modelAnswer: e.target.value })
                      }
                      className="block w-full border p-3 rounded-lg mt-1 mb-4"
                      rows={4}
                    />
                  </label>
                  <label>
                    採点ポイント
                    <textarea
                      value={editing.rubric}
                      onChange={(e) =>
                        setEditing({ ...editing, rubric: e.target.value })
                      }
                      className="block w-full border p-3 rounded-lg mt-1 mb-4"
                      rows={3}
                    />
                  </label>
                </>
              )}
              <div className="flex justify-end gap-3">
                <button onClick={() => setEditing(null)}>キャンセル</button>
                <button
                  onClick={saveQuestion}
                  disabled={Boolean(loadingMessage)}
                  className="bg-blue-600 text-white px-5 py-2 rounded-lg font-bold"
                >
                  {loadingMessage ? "保存中…" : "保存"}
                </button>
              </div>
            </div>
          </div>
        )}
        {pendingImport && (
          <div className="fixed inset-0 bg-black/40 p-4 grid place-items-center z-20">
            <div className="card p-6 w-full max-w-lg">
              <h2 className="text-xl font-black">読み込み方法を選択</h2>
              <p className="text-gray-600 mt-2 mb-6">
                スプレッドシートの変更を自動反映するか、現在の問題を保存するか選んでください。
              </p>
              <div className="grid gap-3">
                <button
                  onClick={() => finishImport("sync")}
                  disabled={Boolean(loadingMessage)}
                  className="border-2 border-blue-600 bg-blue-50 text-blue-700 p-4 rounded-xl text-left"
                >
                  <b className="block text-lg">同期型</b>
                  <span className="text-sm">
                    シートを更新すると、アプリにも反映されます
                  </span>
                </button>
                <button
                  onClick={() => finishImport("copy")}
                  disabled={Boolean(loadingMessage)}
                  className="border-2 border-gray-300 p-4 rounded-xl text-left"
                >
                  <b className="block text-lg">コピー型</b>
                  <span className="text-sm text-gray-600">
                    登録時点の問題を端末内に保存します
                  </span>
                </button>
              </div>
              <button
                onClick={() => setPendingImport(null)}
                className="w-full mt-5 text-gray-500"
              >
                戻る
              </button>
            </div>
          </div>
        )}
        {showFolderCreator && (
          <div className="fixed inset-0 z-30 grid place-items-center bg-black/40 p-4">
            <div className="card max-h-[90vh] w-full max-w-xl overflow-y-auto p-6">
              <h2 className="text-2xl font-black">フォルダを作成</h2>
              <p className="mt-1 text-sm text-gray-500">
                新しいフォルダへ移動する未分類の問題セットを選択してください
              </p>
              <label className="mt-6 block font-bold">
                フォルダ名
                <input
                  autoFocus
                  value={newFolderName}
                  onChange={(event) => setNewFolderName(event.target.value)}
                  placeholder="例：消費者行動論Ⅰ"
                  className="mt-2 block w-full rounded-xl border p-3 font-normal"
                />
              </label>
              <div className="mt-6 flex items-center justify-between">
                <p className="font-bold">未分類の問題セット</p>
                <button
                  type="button"
                  onClick={() => {
                    const ids = subjects
                      .filter((item) => !item.folder?.trim())
                      .map((item) => item.id);
                    setFolderSubjectIds(
                      folderSubjectIds.length === ids.length ? [] : ids,
                    );
                  }}
                  className="text-sm font-bold text-blue-700"
                >
                  {folderSubjectIds.length ===
                  subjects.filter((item) => !item.folder?.trim()).length
                    ? "選択解除"
                    : "すべて選択"}
                </button>
              </div>
              <div className="mt-3 space-y-2">
                {subjects
                  .filter((item) => !item.folder?.trim())
                  .map((item) => {
                    const checked = folderSubjectIds.includes(item.id);
                    return (
                      <label
                        key={item.id}
                        className={`flex cursor-pointer items-center justify-between rounded-xl border-2 p-4 ${
                          checked
                            ? "border-blue-600 bg-blue-50"
                            : "border-gray-200"
                        }`}
                      >
                        <span>
                          <b className="block">{item.name}</b>
                          <span className="text-sm text-gray-500">
                            {item.questionCount ?? item.questions.length}問
                          </span>
                        </span>
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() =>
                            setFolderSubjectIds((current) =>
                              checked
                                ? current.filter((id) => id !== item.id)
                                : [...current, item.id],
                            )
                          }
                          className="h-5 w-5 accent-blue-600"
                        />
                      </label>
                    );
                  })}
              </div>
              <div className="mt-6 flex justify-end gap-3">
                <button onClick={() => setShowFolderCreator(false)}>
                  キャンセル
                </button>
                <button
                  onClick={createFolder}
                  disabled={!newFolderName.trim() || !folderSubjectIds.length}
                  className="rounded-xl bg-blue-600 px-6 py-3 font-bold text-white disabled:bg-gray-300"
                >
                  フォルダを作成して移動
                </button>
              </div>
            </div>
          </div>
        )}
        {subjectSettings && (
          <div className="fixed inset-0 bg-black/40 p-4 grid place-items-center z-20">
            <div className="card p-6 w-full max-w-xl">
              <h2 className="text-xl font-black mb-5">科目設定</h2>
              <label className="block font-bold">
                科目名
                <input
                  value={subjectSettings.name}
                  onChange={(e) =>
                    setSubjectSettings({
                      ...subjectSettings,
                      name: e.target.value,
                    })
                  }
                  className="block w-full border p-3 rounded-lg mt-2 mb-4 font-normal"
                />
              </label>
              <label className="block font-bold">
                授業科目・フォルダ
                <input
                  value={subjectSettings.folder || ""}
                  onChange={(e) =>
                    setSubjectSettings({
                      ...subjectSettings,
                      folder: e.target.value,
                    })
                  }
                  placeholder="例：消費者行動論Ⅰ"
                  className="mt-2 mb-4 block w-full rounded-lg border p-3 font-normal"
                />
              </label>
              <label className="mb-5 flex items-start gap-3 rounded-xl bg-gray-50 p-4">
                <input
                  type="checkbox"
                  checked={Boolean(subjectSettings.archived)}
                  onChange={(e) =>
                    setSubjectSettings({
                      ...subjectSettings,
                      archived: e.target.checked,
                    })
                  }
                  className="mt-1"
                />
                <span>
                  <b className="block">一覧で非表示にする</b>
                  <span className="text-sm font-normal text-gray-500">
                    削除せず保管し、通常の一覧と出題対象から外します
                  </span>
                </span>
              </label>
              <div className="mb-5 rounded-xl border-2 border-dashed border-blue-200 p-4">
                <p className="font-bold">CSV／XLSXファイルを差し替え</p>
                <p className="mt-1 text-sm text-gray-500">
                  問題だけを入れ替えます。問題セットIDとこれまでの結果履歴は維持されます。
                </p>
                <label className="mt-3 inline-flex h-11 cursor-pointer items-center justify-center rounded-lg border border-blue-600 px-4 font-bold text-blue-700">
                  ファイルを選択
                  <input
                    type="file"
                    accept=".csv,.xlsx,.xls"
                    className="hidden"
                    disabled={settingsLoading}
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (file) void replaceSubjectFile(file);
                      event.target.value = "";
                    }}
                  />
                </label>
              </div>
              <label className="block font-bold">
                CSV URL
                <textarea
                  value={subjectSettings.source?.url || ""}
                  onChange={(e) =>
                    setSubjectSettings({
                      ...subjectSettings,
                      source: e.target.value
                        ? {
                            url: e.target.value,
                            mode: subjectSettings.source?.mode || "sync",
                          }
                        : undefined,
                    })
                  }
                  placeholder="公開CSVのURLを貼り付け"
                  rows={3}
                  className="block w-full border p-3 rounded-lg mt-2 mb-4 font-normal"
                />
              </label>
              <p className="font-bold mb-2">読み込み方式</p>
              <div className="grid grid-cols-2 gap-3 mb-5">
                <button
                  onClick={() =>
                    setSubjectSettings({
                      ...subjectSettings,
                      source: {
                        url: subjectSettings.source?.url || "",
                        mode: "sync",
                      },
                    })
                  }
                  className={`border-2 p-3 rounded-xl ${subjectSettings.source?.mode === "sync" ? "border-blue-600 bg-blue-50 text-blue-700" : "border-gray-200"}`}
                >
                  <b>同期型</b>
                  <span className="block text-xs mt-1">
                    開くたび最新版を取得
                  </span>
                </button>
                <button
                  onClick={() =>
                    setSubjectSettings({
                      ...subjectSettings,
                      source: {
                        url: subjectSettings.source?.url || "",
                        mode: "copy",
                      },
                    })
                  }
                  className={`border-2 p-3 rounded-xl ${subjectSettings.source?.mode === "copy" ? "border-blue-600 bg-blue-50 text-blue-700" : "border-gray-200"}`}
                >
                  <b>コピー型</b>
                  <span className="block text-xs mt-1">
                    読み込んだ問題を保存
                  </span>
                </button>
              </div>
              <button
                disabled={settingsLoading || !subjectSettings.source?.url}
                onClick={reloadSettings}
                className="w-full border border-blue-600 text-blue-700 disabled:border-gray-300 disabled:text-gray-400 py-3 rounded-xl font-bold"
              >
                {settingsLoading
                  ? "読み込み中…"
                  : `今すぐ再読み込み（現在 ${subjectSettings.questions.length}問）`}
              </button>
              <div className="flex justify-end gap-3 mt-6">
                <button
                  disabled={settingsLoading}
                  onClick={() => setSubjectSettings(null)}
                >
                  キャンセル
                </button>
                <button
                  disabled={settingsLoading}
                  onClick={saveSettings}
                  className="bg-blue-600 disabled:bg-gray-300 text-white px-5 py-2 rounded-lg font-bold"
                >
                  保存
                </button>
              </div>
            </div>
          </div>
        )}
        {showStudySetup && subject && (
          <div className="fixed inset-0 bg-black/40 p-4 grid place-items-center z-20">
            <div className="card p-6 w-full max-w-xl">
              <h2 className="text-2xl font-black">学習設定</h2>
              <p className="text-gray-500 mt-1 mb-6">
                出題する問題形式と問題数を選んでください
              </p>
              <p className="font-bold mb-3">問題形式</p>
              <div className="grid grid-cols-2 gap-3">
                {(["choice", "ox", "fill", "essay"] as QType[]).map((type) => {
                  const selectedType = studyTypes.includes(type);
                  const typeCount = subject.questions.filter(
                    (q) => q.type === type,
                  ).length;
                  return (
                    <button
                      key={type}
                      disabled={!typeCount}
                      onClick={() => {
                        const nextTypes = selectedType
                          ? studyTypes.filter((t) => t !== type)
                          : [...studyTypes, type];
                        setStudyTypes(nextTypes);
                        const nextMax = subject.questions.filter((q) =>
                          nextTypes.includes(q.type),
                        ).length;
                        setStudyCount((count) =>
                          count === ""
                            ? ""
                            : String(
                                Math.max(
                                  1,
                                  Math.min(Number(count), nextMax || 1),
                                ),
                              ),
                        );
                      }}
                      className={
                        "border-2 p-4 rounded-xl text-left disabled:opacity-40 " +
                        (selectedType
                          ? "border-blue-600 bg-blue-50 text-blue-700"
                          : "border-gray-200")
                      }
                    >
                      <b>{typeName[type]}</b>
                      <span className="block text-sm mt-1">{typeCount}問</span>
                    </button>
                  );
                })}
              </div>
              <div className="mt-6">
                <div className="flex justify-between items-center mb-3">
                  <p className="font-bold">出題数</p>
                  <p className="font-black text-blue-700">
                    {studyCount === ""
                      ? "未入力"
                      : `${Math.min(
                          Number(studyCount),
                          studyAvailable || 1,
                        )}問`}
                    <span className="text-sm text-gray-400 font-normal">
                      {" "}
                      / 最大{studyAvailable}問
                    </span>
                  </p>
                </div>
                <input
                  type="range"
                  min="1"
                  max={Math.max(1, studyAvailable)}
                  value={
                    studyCount === ""
                      ? 1
                      : Math.min(
                          Number(studyCount),
                          Math.max(1, studyAvailable),
                        )
                  }
                  onChange={(e) => setStudyCount(e.target.value)}
                  disabled={!studyAvailable}
                  className="w-full accent-blue-600"
                />
                <input
                  type="number"
                  min="1"
                  max={Math.max(1, studyAvailable)}
                  value={studyCount}
                  onChange={(e) => setStudyCount(e.target.value)}
                  disabled={!studyAvailable}
                  className="mt-3 w-28 border p-2 rounded-lg text-center font-bold"
                />
              </div>
              <label className="mt-6 flex cursor-pointer items-start gap-3 rounded-xl border-2 border-blue-200 bg-blue-50 p-4">
                <input
                  type="checkbox"
                  checked={studyExamMode}
                  onChange={(event) => setStudyExamMode(event.target.checked)}
                  className="mt-1 h-5 w-5 accent-blue-600"
                />
                <span>
                  <b className="block text-blue-800">試験モードで実施する</b>
                  <span className="mt-1 block text-sm text-blue-700">
                    途中では正誤・解説を表示せず、終了後に合否と間違えた問題をまとめて確認できます
                  </span>
                </span>
              </label>
              {studyExamMode && (
                <label className="mt-4 block font-bold">
                  合格基準
                  <span className="ml-2 text-sm font-normal text-gray-500">
                    デフォルト90%
                  </span>
                  <div className="mt-2 flex max-w-48 items-center gap-2">
                    <input
                      type="number"
                      min="1"
                      max="100"
                      value={studyPassPercentage}
                      onChange={(event) =>
                        setStudyPassPercentage(event.target.value)
                      }
                      className="w-full rounded-lg border p-3"
                    />
                    <span className="font-black">%</span>
                  </div>
                </label>
              )}
              <div className="bg-amber-50 text-amber-800 text-sm p-3 rounded-xl mt-5">
                {studyExamMode
                  ? "この科目の対象問題からランダムに出題します。論述を含む場合はAI採点後に最終合否が確定します。"
                  : "未回答・回答回数の少ない問題を優先しつつ、回答済みの問題もランダムに出題します。"}
              </div>
              <div className="flex justify-end gap-3 mt-6">
                <button onClick={() => setShowStudySetup(false)}>
                  キャンセル
                </button>
                <button
                  onClick={() =>
                    runWithLoading("問題を準備しています…", async () => {
                      start();
                    })
                  }
                  disabled={!studyAvailable}
                  className="bg-blue-600 disabled:bg-gray-300 text-white px-6 py-3 rounded-xl font-bold"
                >
                  この設定で開始
                </button>
              </div>
            </div>
          </div>
        )}
        {showExamSetup && (
          <div className="fixed inset-0 z-30 grid place-items-center overflow-y-auto bg-black/50 p-4">
            <div className="card my-6 max-h-[92vh] w-full max-w-2xl overflow-y-auto p-6">
              <h2 className="text-2xl font-black">
                {setupMode === "exam" ? "試験設定" : "横断学習設定"}
              </h2>
              <p className="mt-1 text-gray-500">
                複数の問題セット・授業回をまとめて出題できます
              </p>

              <p className="mb-3 mt-6 font-bold">出題する科目</p>
              <div className="grid gap-3 sm:grid-cols-2">
                {subjects.filter((item) => !item.archived).map((item) => {
                  const checked = examSubjectIds.includes(item.id);
                  return (
                    <button
                      key={item.id}
                      type="button"
                      disabled={!(item.questionCount ?? item.questions.length)}
                      onClick={() =>
                        setExamSubjectIds((current) =>
                          checked
                            ? current.filter((id) => id !== item.id)
                            : [...current, item.id],
                        )
                      }
                      className={
                        "rounded-xl border-2 p-4 text-left disabled:opacity-40 " +
                        (checked
                          ? "border-blue-600 bg-blue-50 text-blue-700"
                          : "border-gray-200")
                      }
                    >
                      <b>
                        {checked ? "✓ " : ""}
                        {item.name}
                      </b>
                      <span className="mt-1 block text-sm">
                        {item.questionCount ?? item.questions.length}問
                      </span>
                    </button>
                  );
                })}
              </div>

              <p className="mb-3 mt-6 font-bold">問題形式</p>
              <div className="grid grid-cols-2 gap-3">
                {(["choice", "ox", "fill", "essay"] as QType[]).map((type) => {
                  const checked = examTypes.includes(type);
                  const typeCount = subjects
                    .filter((item) => examSubjectIds.includes(item.id))
                    .reduce(
                      (total, item) =>
                        total +
                        item.questions.filter(
                          (question) => question.type === type,
                        ).length,
                      0,
                    );
                  return (
                    <button
                      key={type}
                      type="button"
                      disabled={!typeCount}
                      onClick={() =>
                        setExamTypes((current) =>
                          checked
                            ? current.filter((item) => item !== type)
                            : [...current, type],
                        )
                      }
                      className={
                        "rounded-xl border-2 p-4 text-left disabled:opacity-40 " +
                        (checked
                          ? "border-blue-600 bg-blue-50 text-blue-700"
                          : "border-gray-200")
                      }
                    >
                      <b>{typeName[type]}</b>
                      <span className="mt-1 block text-sm">{typeCount}問</span>
                    </button>
                  );
                })}
              </div>

              <div className="mt-6 grid gap-5 sm:grid-cols-2">
                <label className="font-bold">
                  問題数
                  <span className="ml-2 text-sm font-normal text-gray-500">
                    最大{examAvailable}問
                  </span>
                  <input
                    type="number"
                    min="1"
                    max={Math.max(1, examAvailable)}
                    value={examCount}
                    onChange={(event) => setExamCount(event.target.value)}
                    className="mt-2 block w-full rounded-lg border p-3"
                  />
                </label>
                <label className="font-bold">
                  {setupMode === "exam" ? "合格基準" : "出題方法"}
                  <span className="ml-2 text-sm font-normal text-gray-500">
                    {setupMode === "exam" ? "デフォルト90%" : ""}
                  </span>
                  {setupMode === "exam" ? <div className="mt-2 flex items-center gap-2">
                    <input
                      type="number"
                      min="1"
                      max="100"
                      value={examPassPercentage}
                      onChange={(event) =>
                        setExamPassPercentage(event.target.value)
                      }
                      className="block w-full rounded-lg border p-3"
                    />
                    <span className="font-black">%</span>
                  </div> : <span className="mt-2 block rounded-lg bg-blue-50 p-3 text-sm font-normal text-blue-800">
                    未回答・回答回数の少ない問題も含めてランダム出題します
                  </span>}
                </label>
              </div>

              <div className="mt-5 rounded-xl bg-blue-50 p-4 text-sm text-blue-800">
                {setupMode === "exam"
                  ? "途中では正誤と解説を表示しません。論述問題を含む場合は、AI採点結果を取り込むまで最終合否は「採点待ち」になります。"
                  : "通常学習と同じく、回答ごとに正誤と解説を確認できます。"}
              </div>
              <div className="mt-6 flex justify-end gap-3">
                <button onClick={() => setShowExamSetup(false)}>
                  キャンセル
                </button>
                <button
                  onClick={() =>
                    runWithLoading("問題を準備しています…", async () => {
                      await startExam();
                    })
                  }
                  disabled={!examAvailable}
                  className="rounded-xl bg-blue-600 px-6 py-3 font-bold text-white disabled:bg-gray-300"
                >
                  {setupMode === "exam" ? "試験を開始" : "横断学習を開始"}
                </button>
              </div>
            </div>
          </div>
        )}
        {view === "play" && active[index] && (
          <div className="card p-6 md:p-10 max-w-3xl mx-auto">
            <div className="flex justify-between text-sm text-gray-500 mb-6">
              <span>
                {sessionMode === "exam" && (
                  <b className="mr-2 text-blue-700">試験モード</b>
                )}
                {active[index].sourceSubjectName}・
                {typeName[active[index].type]}
              </span>
              <div className="flex items-center gap-3">
                <span>
                  {index + 1}/{active.length}
                </span>
                <button
                  onClick={() =>
                    confirm("ここまでの解答を保存して中断しますか？") &&
                    saveAttempt(true)
                  }
                  className="text-red-600 border border-red-200 px-3 py-1 rounded-full font-bold"
                >
                  {sessionMode === "exam" ? "試験を中断" : "中断して保存"}
                </button>
              </div>
            </div>
            <h1 className="text-xl md:text-2xl font-black leading-relaxed mb-7">
              {active[index].question}
            </h1>
            {active[index].type === "choice" ? (
              <div className="space-y-3">
                {active[index].options.map((o) => (
                  <button
                    key={o}
                    disabled={submitted}
                    onClick={() => setDraft(o)}
                    className={`w-full text-left border-2 p-4 rounded-xl ${draft === o ? "border-blue-600 bg-blue-50" : "border-gray-200"}`}
                  >
                    {o}
                  </button>
                ))}
              </div>
            ) : active[index].type === "ox" ? (
              <div className="grid grid-cols-2 gap-4">
                {["○", "×"].map((o) => (
                  <button
                    key={o}
                    disabled={submitted}
                    onClick={() => setDraft(o)}
                    className={`text-4xl border-2 p-8 rounded-xl ${draft === o ? "border-blue-600 bg-blue-50" : ""}`}
                  >
                    {o}
                  </button>
                ))}
              </div>
            ) : (
              <textarea
                value={draft}
                disabled={submitted}
                onChange={(e) => setDraft(e.target.value)}
                rows={active[index].type === "essay" ? 10 : 3}
                placeholder="回答を入力"
                className="w-full border-2 p-4 rounded-xl"
              />
            )}
            {submitted && active[index].type !== "essay" && (
              <div className="bg-gray-50 p-4 rounded-xl mt-5">
                {feedback !== null && (
                  <b className={feedback ? "text-green-600" : "text-red-600"}>
                    {feedback ? "正解" : "不正解"}
                  </b>
                )}
                {feedback === false && (
                  <p className="mt-2 rounded-lg bg-green-50 px-3 py-2 font-bold text-green-700">
                    正しい答え：{active[index].answer}
                  </p>
                )}
                {active[index].explanation && (
                  <p className="mt-2">{active[index].explanation}</p>
                )}
              </div>
            )}
            <div className="flex justify-end mt-6">
              {!submitted ? (
                <button
                  disabled={!draft.trim()}
                  onClick={submit}
                  className="bg-blue-600 disabled:bg-gray-300 text-white px-7 py-3 rounded-xl font-bold"
                >
                  {sessionMode === "exam"
                    ? index + 1 === active.length
                      ? "回答して結果へ"
                      : "回答して次へ"
                    : "回答する"}
                </button>
              ) : (
                <button
                  onClick={next}
                  className="bg-blue-600 text-white px-7 py-3 rounded-xl font-bold"
                >
                  {index + 1 === active.length ? "結果へ" : "次へ"}
                </button>
              )}
            </div>
          </div>
        )}
        {view === "result" && lastAttempt && (
          <div className="mx-auto max-w-3xl space-y-4">
            <div className="card text-center p-8 md:p-10">
              <h1 className="text-3xl font-black">
                {resultSaving
                  ? "結果を保存しています…"
                  : resultSaveError
                    ? "結果を保存できませんでした"
                    : lastInterrupted
                      ? "途中結果を保存しました"
                      : lastAttempt.mode === "exam"
                        ? lastAttempt.essayPending
                          ? "論述採点待ち"
                          : lastAttempt.passed
                            ? "合格"
                            : "不合格"
                        : "学習完了"}
              </h1>
              {resultSaving && (
                <div className="mx-auto mt-5 h-9 w-9 animate-spin rounded-full border-4 border-blue-100 border-t-blue-600" />
              )}
              {resultSaveError && (
                <div className="mt-5 rounded-xl bg-red-50 p-4 text-sm text-red-700">
                  <p>
                    回答はこの端末に残っています。通信を確認して、もう一度保存してください。
                  </p>
                  <button
                    onClick={retryResultSave}
                    className="mt-3 rounded-lg bg-red-600 px-5 py-2 font-bold text-white"
                  >
                    保存を再試行
                  </button>
                </div>
              )}
              {lastAttempt.mode === "exam" ? (
                <>
                  <p className="mt-3 text-gray-500">
                    {lastAttempt.subjectNames?.join("・") ||
                      subjects.find((item) => item.id === lastAttempt.subjectId)
                        ?.name}
                  </p>
                  <div className="mt-6 rounded-2xl bg-gray-50 p-6">
                    <p className="text-sm text-gray-500">
                      {lastAttempt.essayPending
                        ? "自動採点できる問題の暫定結果"
                        : "最終得点率"}
                    </p>
                    <p className="mt-1 text-4xl font-black text-blue-700">
                      {lastAttempt.percentage ?? 0}%
                    </p>
                    <p className="mt-2 text-sm text-gray-500">
                      合格基準 {lastAttempt.passPercentage ?? 90}%・択一等{" "}
                      {lastAttempt.score}/{lastAttempt.total}・不正解{" "}
                      {summarizeAnswers(lastAttempt.answers).incorrect}問
                    </p>
                  </div>
                  {lastAttempt.essayPending && (
                    <p className="mt-4 text-sm text-amber-700">
                      論述答案をAIで採点し、Excelを取り込むと最終合否が確定します。
                    </p>
                  )}
                </>
              ) : (
                <p className="text-gray-500 mt-2">
                  論述問題はテキストにまとめてAIで採点できます
                </p>
              )}
              <div className="flex flex-col gap-3 mt-8">
                {lastAttempt.answers.some(
                  (answer) => answer.type === "essay",
                ) && (
                  <button
                    onClick={() => exportEssayText(lastAttempt.id)}
                    disabled={resultSaving}
                    className="bg-blue-600 text-white py-3 rounded-xl font-bold"
                  >
                    論述答案をテキスト出力
                  </button>
                )}
                <button
                  onClick={() => {
                    if (lastAttempt.mode === "exam") navigate("home");
                    else setView("subject");
                  }}
                  disabled={resultSaving}
                  className="border py-3 rounded-xl font-bold disabled:opacity-50"
                >
                  {lastAttempt.mode === "exam"
                    ? "メイン画面へ戻る"
                    : "科目へ戻る"}
                </button>
              </div>
            </div>
            <div className="card p-6 md:p-8">
              <h2 className="text-xl font-black">解答の振り返り</h2>
              <p className="mt-1 text-sm text-gray-500">
                間違えた問題と正解・解説をここで確認できます。
              </p>
              <div className="mt-5">
                <AnswerBreakdown answers={lastAttempt.answers} />
              </div>
              <div className="mt-6 border-t pt-5">
                <h3 className="mb-3 font-black">問題ごとの結果</h3>
                <AnswerReviewList
                  answers={lastAttempt.answers}
                  subjects={subjects}
                  fallbackSubjectId={lastAttempt.subjectId}
                  showSubject={lastAttempt.mode === "exam"}
                />
              </div>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}

export default function Home() {
  return <StudyApp />;
}
