export type QType = "choice" | "ox" | "fill" | "essay";

export type Question = {
  id: string;
  type: QType;
  question: string;
  options: string[];
  answer: string;
  explanation: string;
  modelAnswer: string;
  rubric: string;
};

export type Subject = {
  id: string;
  name: string;
  color: string;
  /** 授業科目・講義など、複数の問題セットをまとめるフォルダ名 */
  folder?: string;
  /** 終了した科目を削除せず一覧から隠す */
  archived?: boolean;
  source?: { url: string; mode: "sync" | "copy" };
  /** 一覧表示用。問題本文を未取得でも件数を表示する。 */
  questionCount?: number;
  /** falseの場合、questionsはまだクラウドから取得していない。 */
  questionsLoaded?: boolean;
  questions: Question[];
};

export type EssayGrading = {
  score: number;
  assessment: string;
  goodPoints: string;
  missingPoints: string;
  improvedAnswer: string;
  importedAt: string;
};

export type AnswerRecord = {
  questionId: string;
  subjectId?: string;
  subjectName?: string;
  question?: string;
  type?: QType;
  answer: string;
  correct: boolean | null;
  correctAnswer?: string;
  explanation?: string;
  modelAnswer?: string;
  rubric?: string;
  grading?: EssayGrading;
};

export type Attempt = {
  id: string;
  subjectId: string;
  subjectIds?: string[];
  subjectNames?: string[];
  date: string;
  score: number;
  total: number;
  mode?: "study" | "exam";
  passPercentage?: number;
  percentage?: number;
  passed?: boolean;
  essayPending?: boolean;
  timeLimitMinutes?: number | null;
  answers: AnswerRecord[];
  /** falseの場合、answersは結果を展開したときに取得する。 */
  answersLoaded?: boolean;
  status?: "completed" | "interrupted";
};

export type SyncStatus = "loading" | "saved" | "saving" | "error" | "offline";
