"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import type { Session } from "@supabase/supabase-js";
import { dedupeQuestions } from "@/lib/questions";
import {
  loadLegacyData,
  loadRelationalData,
  saveLegacyBackup,
  saveRelationalChanges,
  type StudySnapshot,
} from "@/lib/study-storage";
import { isSupabaseConfigured, supabase } from "@/lib/supabase";
import type { Attempt, Subject, SyncStatus } from "@/lib/study-types";

const SUBJECTS_KEY = "study_subjects_v2";
const ATTEMPTS_KEY = "study_attempts_v2";
const CACHE_UPDATED_KEY = "study_cache_updated_v2";
const CACHE_DIRTY_KEY = "study_cache_dirty_v2";
const forceLegacyStorage =
  process.env.NEXT_PUBLIC_STUDY_STORAGE_MODE === "legacy";
const userCacheKey = (key: string, userId: string) => `${key}:${userId}`;
const canonicalize = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, item]) => item !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalize(item)]),
    );
  return value;
};
const serialize = (subjects: Subject[], attempts: Attempt[]) =>
  JSON.stringify(canonicalize({ subjects, attempts }));
const dedupeSubjects = (subjects: Subject[]) =>
  Array.from(
    new Map(
      subjects.map((subject) => [
        subject.id,
        {
          ...subject,
          questions: dedupeQuestions(
            Array.isArray(subject.questions) ? subject.questions : [],
          ),
        },
      ]),
    ).values(),
  );
const readJson = <T>(key: string, fallback: T): T => {
  try {
    return JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback));
  } catch {
    return fallback;
  }
};
const writeUserCache = (
  userId: string,
  subjects: Subject[],
  attempts: Attempt[],
  updatedAt = Date.now(),
) => {
  localStorage.setItem(
    userCacheKey(SUBJECTS_KEY, userId),
    JSON.stringify(subjects),
  );
  localStorage.setItem(
    userCacheKey(ATTEMPTS_KEY, userId),
    JSON.stringify(attempts),
  );
  localStorage.setItem(
    userCacheKey(CACHE_UPDATED_KEY, userId),
    String(updatedAt),
  );
};
const markUserCacheDirty = (userId: string) =>
  localStorage.setItem(userCacheKey(CACHE_DIRTY_KEY, userId), "1");
const clearUserCacheDirty = (userId: string) =>
  localStorage.removeItem(userCacheKey(CACHE_DIRTY_KEY, userId));

export function useStudySync() {
  const [ready, setReady] = useState(false);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [attempts, setAttempts] = useState<Attempt[]>([]);
  const [session, setSession] = useState<Session | null>(null);
  const [authChecked, setAuthChecked] = useState(!isSupabaseConfigured);
  const [cloudReady, setCloudReady] = useState(!isSupabaseConfigured);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>(
    isSupabaseConfigured ? "loading" : "offline",
  );
  const [syncProgress, setSyncProgress] = useState(
    isSupabaseConfigured ? 0 : 100,
  );
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [syncRetry, setSyncRetry] = useState(0);
  const lastSyncedData = useRef("");
  const lastSyncedSnapshot = useRef<StudySnapshot>({
    subjects: [],
    attempts: [],
  });
  const lastRemoteUpdatedAt = useRef(0);
  const storageMode = useRef<"relational" | "legacy">("legacy");
  const subjectsRef = useRef<Subject[]>([]);
  const attemptsRef = useRef<Attempt[]>([]);
  const saveQueue = useRef<Promise<void>>(Promise.resolve());
  const cacheLoadedForUser = useRef<string | null>(null);
  const sessionUserId = session?.user.id;

  useEffect(() => {
    subjectsRef.current = subjects;
    attemptsRef.current = attempts;
  }, [subjects, attempts]);

  const updateSubjects: Dispatch<SetStateAction<Subject[]>> = useCallback(
    (value) =>
      setSubjects((current) => {
        const next = dedupeSubjects(
          typeof value === "function" ? value(current) : value,
        );
        subjectsRef.current = next;
        if (sessionUserId) {
          writeUserCache(sessionUserId, next, attemptsRef.current);
          markUserCacheDirty(sessionUserId);
        }
        return next;
      }),
    [sessionUserId],
  );
  const updateAttempts: Dispatch<SetStateAction<Attempt[]>> = useCallback(
    (value) =>
      setAttempts((current) => {
        const next = typeof value === "function" ? value(current) : value;
        attemptsRef.current = next;
        if (sessionUserId) {
          writeUserCache(sessionUserId, subjectsRef.current, next);
          markUserCacheDirty(sessionUserId);
        }
        return next;
      }),
    [sessionUserId],
  );

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSubjects(readJson(SUBJECTS_KEY, []));
      setAttempts(readJson(ATTEMPTS_KEY, []));
      setReady(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!ready) return;
    if (sessionUserId) {
      if (!cloudReady) return;
      const serialized = serialize(subjects, attempts);
      const cacheUpdatedAt =
        serialized === lastSyncedData.current && lastRemoteUpdatedAt.current
          ? lastRemoteUpdatedAt.current
          : Date.now();
      writeUserCache(sessionUserId, subjects, attempts, cacheUpdatedAt);
    } else if (!isSupabaseConfigured) {
      localStorage.setItem(SUBJECTS_KEY, JSON.stringify(subjects));
      localStorage.setItem(ATTEMPTS_KEY, JSON.stringify(attempts));
    }
  }, [subjects, attempts, ready, sessionUserId, cloudReady]);

  useEffect(() => {
    if (!ready || !supabase) return;
    let active = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setSession(data.session);
      setAuthChecked(true);
      if (!data.session) setSyncStatus("offline");
    });
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, nextSession) => {
      if (!active) return;
      setSession(nextSession);
      setAuthChecked(true);
      if (nextSession && event === "SIGNED_IN") {
        setCloudReady(false);
        setSyncStatus("loading");
      } else if (!nextSession) {
        cacheLoadedForUser.current = null;
        lastSyncedData.current = "";
        lastRemoteUpdatedAt.current = 0;
        setCloudReady(false);
        setSyncStatus("offline");
      }
    });
    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, [ready]);

  useEffect(() => {
    if (!ready || !supabase || !sessionUserId) return;
    let active = true;
    const userId = sessionUserId;

    async function loadCloudData() {
      setSyncProgress(10);
      const firstLoadForUser = cacheLoadedForUser.current !== userId;
      let cachedSubjects: Subject[];
      let cachedAttempts: Attempt[];
      if (firstLoadForUser) {
        const userSubjectsKey = userCacheKey(SUBJECTS_KEY, userId);
        const userAttemptsKey = userCacheKey(ATTEMPTS_KEY, userId);
        const hasUserSubjectsCache =
          localStorage.getItem(userSubjectsKey) !== null;
        const hasUserAttemptsCache =
          localStorage.getItem(userAttemptsKey) !== null;
        const userSubjects = readJson<Subject[]>(
          userSubjectsKey,
          [],
        );
        const legacySubjects = readJson<Subject[]>(SUBJECTS_KEY, []);
        cachedSubjects = dedupeSubjects(
          hasUserSubjectsCache ? userSubjects : legacySubjects,
        );
        const userAttempts = readJson<Attempt[]>(
          userAttemptsKey,
          [],
        );
        const legacyAttempts = readJson<Attempt[]>(ATTEMPTS_KEY, []);
        cachedAttempts = hasUserAttemptsCache ? userAttempts : legacyAttempts;
        cacheLoadedForUser.current = userId;
        subjectsRef.current = cachedSubjects;
        attemptsRef.current = cachedAttempts;
        setSubjects(cachedSubjects);
        setAttempts(cachedAttempts);
      } else {
        cachedSubjects = dedupeSubjects(subjectsRef.current);
        cachedAttempts = attemptsRef.current;
      }
      const cachedSerialized = serialize(cachedSubjects, cachedAttempts);
      const hasUnsyncedCache =
        localStorage.getItem(userCacheKey(CACHE_DIRTY_KEY, userId)) === "1";
      const client = supabase!;
      setSyncProgress(25);
      const [legacy, relational] = await Promise.all([
        loadLegacyData(client, userId),
        forceLegacyStorage
          ? Promise.resolve({
              available: false,
              subjects: [],
              attempts: [],
              updatedAt: 0,
            })
          : loadRelationalData(client, userId),
      ]);
      if (!active) return;
      setSyncProgress(65);

      storageMode.current = relational.available ? "relational" : "legacy";
      // Both stores normally receive the same timestamp. In that case the
      // legacy snapshot is the authoritative full backup; preferring a
      // partially written relational snapshot can make a just-saved result
      // disappear on reload.
      const useRelational =
        relational.available &&
        (relational.updatedAt > legacy.updatedAt ||
          (legacy.subjects.length + legacy.attempts.length === 0 &&
            relational.updatedAt >= legacy.updatedAt));
      let remote: StudySnapshot =
        useRelational
          ? {
              subjects: dedupeSubjects(relational.subjects),
              attempts: relational.attempts,
            }
          : {
              subjects: dedupeSubjects(legacy.subjects),
              attempts: legacy.attempts,
            };
      let remoteUpdatedAt = useRelational
        ? relational.updatedAt
        : legacy.updatedAt;
      const latestSubjects = dedupeSubjects(subjectsRef.current);
      const latestAttempts = attemptsRef.current;
      const latestSerialized = serialize(latestSubjects, latestAttempts);
      const changedDuringLoad = latestSerialized !== cachedSerialized;
      const remoteIsEmpty = remote.subjects.length + remote.attempts.length === 0;
      const cachedHasData =
        cachedSubjects.length + cachedAttempts.length > 0;
      const shouldPersistLocal =
        changedDuringLoad ||
        hasUnsyncedCache ||
        (remoteIsEmpty && cachedHasData);

      if (shouldPersistLocal) {
        setSyncProgress(75);
        const next: StudySnapshot = {
          subjects: changedDuringLoad ? latestSubjects : cachedSubjects,
          attempts: changedDuringLoad ? latestAttempts : cachedAttempts,
        };
        const updatedAt = new Date().toISOString();
        if (relational.available) {
          await saveRelationalChanges(client, remote, next, updatedAt);
          storageMode.current = "relational";
        }
        await saveLegacyBackup(client, userId, next, updatedAt);
        if (!active) return;
        remote = next;
        remoteUpdatedAt = Date.parse(updatedAt);
        clearUserCacheDirty(userId);
      } else if (
        relational.available &&
        legacy.updatedAt > relational.updatedAt
      ) {
        const migratedAt = new Date(legacy.updatedAt || Date.now()).toISOString();
        await saveRelationalChanges(
          client,
          {
            subjects: dedupeSubjects(relational.subjects),
            attempts: relational.attempts,
          },
          remote,
          migratedAt,
        );
        storageMode.current = "relational";
      }

      const remoteSerialized = serialize(remote.subjects, remote.attempts);
      lastSyncedData.current = remoteSerialized;
      lastSyncedSnapshot.current = remote;
      lastRemoteUpdatedAt.current = remoteUpdatedAt;
      subjectsRef.current = remote.subjects;
      attemptsRef.current = remote.attempts;
      setSubjects(remote.subjects);
      setAttempts(remote.attempts);

      localStorage.removeItem(SUBJECTS_KEY);
      localStorage.removeItem(ATTEMPTS_KEY);
      setSyncProgress(100);
      setLastSyncedAt(remoteUpdatedAt || Date.now());
      setSyncError(null);
      setSyncStatus("saved");
      setCloudReady(true);
    }

    loadCloudData().catch((error) => {
      if (active) {
        setSyncError(
          error instanceof Error
            ? error.message
            : "クラウドデータを取得できませんでした",
        );
        setSyncStatus("error");
        setCloudReady(false);
      }
    });
    return () => {
      active = false;
    };
  }, [ready, sessionUserId, syncRetry]);

  const persistSnapshot = useCallback(
    (nextSnapshot: StudySnapshot, verify = false) => {
      if (!supabase || !sessionUserId || !cloudReady)
        return Promise.reject(new Error("クラウド同期の準備ができていません"));
      const client = supabase;
      const serialized = serialize(
        nextSnapshot.subjects,
        nextSnapshot.attempts,
      );
      setSyncStatus("saving");
      setSyncProgress(10);
      setSyncError(null);
      const operation = saveQueue.current.then(async () => {
        const updatedAt = new Date().toISOString();
        const previousSnapshot = lastSyncedSnapshot.current;
        try {
          if (storageMode.current === "relational") {
            try {
              await saveRelationalChanges(
                client,
                previousSnapshot,
                nextSnapshot,
                updatedAt,
              );
              setSyncProgress(65);
            } catch {
              storageMode.current = "legacy";
            }
          }
          await saveLegacyBackup(
            client,
            sessionUserId,
            nextSnapshot,
            updatedAt,
          );
          setSyncProgress(90);
          if (verify) {
            const saved = await loadLegacyData(client, sessionUserId);
            if (
              serialize(saved.subjects, saved.attempts) !==
              serialize(nextSnapshot.subjects, nextSnapshot.attempts)
            )
              throw new Error(
                "クラウドへの保存内容を確認できませんでした。端末データは保持しています。",
              );
          }
        } catch (error) {
          setSyncError(
            error instanceof Error
              ? error.message
              : "クラウドへ保存できませんでした",
          );
          setSyncStatus("error");
          throw error;
        }
        lastSyncedData.current = serialized;
        lastSyncedSnapshot.current = nextSnapshot;
        lastRemoteUpdatedAt.current = Date.parse(updatedAt);
        setLastSyncedAt(Date.parse(updatedAt));
        if (
          serialize(subjectsRef.current, attemptsRef.current) === serialized
        ) {
          clearUserCacheDirty(sessionUserId);
          setSyncProgress(100);
          setSyncStatus("saved");
        }
      });
      saveQueue.current = operation.catch(() => undefined);
      return operation;
    },
    [sessionUserId, cloudReady],
  );

  useEffect(() => {
    if (!supabase || !sessionUserId || !cloudReady) return;
    const serialized = serialize(subjects, attempts);
    if (serialized === lastSyncedData.current) return;
    const nextSnapshot = { subjects, attempts };
    const timer = window.setTimeout(() => {
      if (serialized === lastSyncedData.current) return;
      void persistSnapshot(nextSnapshot).catch(() => undefined);
    }, 700);
    return () => window.clearTimeout(timer);
  }, [subjects, attempts, sessionUserId, cloudReady, persistSnapshot]);

  const saveNow = useCallback(
    (nextSnapshot?: StudySnapshot) =>
      persistSnapshot(
        nextSnapshot || {
          subjects: subjectsRef.current,
          attempts: attemptsRef.current,
        },
        true,
      ),
    [persistSnapshot],
  );

  async function signOut() {
    if (!supabase) return;
    await supabase.auth.signOut();
    cacheLoadedForUser.current = null;
    subjectsRef.current = [];
    attemptsRef.current = [];
    lastSyncedData.current = "";
    lastSyncedSnapshot.current = { subjects: [], attempts: [] };
    lastRemoteUpdatedAt.current = 0;
    setLastSyncedAt(null);
    setSyncError(null);
    setSyncProgress(100);
    setSubjects([]);
    setAttempts([]);
  }

  function retrySync() {
    if (!sessionUserId) return;
    setCloudReady(false);
    setSyncError(null);
    setSyncProgress(0);
    setSyncStatus("loading");
    setSyncRetry((value) => value + 1);
  }

  return {
    ready,
    subjects,
    setSubjects: updateSubjects,
    attempts,
    setAttempts: updateAttempts,
    session,
    authChecked,
    syncStatus,
    syncProgress,
    lastSyncedAt,
    syncError,
    saveNow,
    retrySync,
    signOut,
  };
}
