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
  source?: { url: string; mode: "sync" | "copy" };
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
  status?: "completed" | "interrupted";
};

export type SyncStatus = "loading" | "saved" | "saving" | "error" | "offline";
