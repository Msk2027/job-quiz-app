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
const forceLegacyStorage =
  process.env.NEXT_PUBLIC_STUDY_STORAGE_MODE === "legacy";
const userCacheKey = (key: string, userId: string) => `${key}:${userId}`;
const serialize = (subjects: Subject[], attempts: Attempt[]) =>
  JSON.stringify({ subjects, attempts });
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
        if (sessionUserId)
          writeUserCache(sessionUserId, next, attemptsRef.current);
        return next;
      }),
    [sessionUserId],
  );
  const updateAttempts: Dispatch<SetStateAction<Attempt[]>> = useCallback(
    (value) =>
      setAttempts((current) => {
        const next = typeof value === "function" ? value(current) : value;
        attemptsRef.current = next;
        if (sessionUserId)
          writeUserCache(sessionUserId, subjectsRef.current, next);
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
      const client = supabase!;
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

      storageMode.current = relational.available ? "relational" : "legacy";
      let remote: StudySnapshot =
        relational.available && relational.updatedAt >= legacy.updatedAt
          ? {
              subjects: dedupeSubjects(relational.subjects),
              attempts: relational.attempts,
            }
          : {
              subjects: dedupeSubjects(legacy.subjects),
              attempts: legacy.attempts,
            };
      let remoteUpdatedAt =
        relational.available && relational.updatedAt >= legacy.updatedAt
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
        changedDuringLoad || (remoteIsEmpty && cachedHasData);

      if (shouldPersistLocal) {
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
      setSyncStatus("saved");
      setCloudReady(true);
    }

    loadCloudData().catch(() => {
      if (active) {
        setSyncStatus("error");
        setCloudReady(false);
      }
    });
    return () => {
      active = false;
    };
  }, [ready, sessionUserId, syncRetry]);

  useEffect(() => {
    if (!supabase || !sessionUserId || !cloudReady) return;
    const serialized = serialize(subjects, attempts);
    if (serialized === lastSyncedData.current) return;
    const client = supabase;
    const nextSnapshot = { subjects, attempts };
    const previousSnapshot = lastSyncedSnapshot.current;
    const timer = window.setTimeout(() => {
      setSyncStatus("saving");
      saveQueue.current = saveQueue.current.then(async () => {
        const updatedAt = new Date().toISOString();
        try {
          if (storageMode.current === "relational") {
            try {
              await saveRelationalChanges(
                client,
                previousSnapshot,
                nextSnapshot,
                updatedAt,
              );
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
        } catch {
          setSyncStatus("error");
          return;
        }
        lastSyncedData.current = serialized;
        lastSyncedSnapshot.current = nextSnapshot;
        lastRemoteUpdatedAt.current = Date.parse(updatedAt);
        if (
          serialize(subjectsRef.current, attemptsRef.current) === serialized
        )
          setSyncStatus("saved");
      });
    }, 700);
    return () => window.clearTimeout(timer);
  }, [subjects, attempts, sessionUserId, cloudReady]);

  async function signOut() {
    if (!supabase) return;
    await supabase.auth.signOut();
    cacheLoadedForUser.current = null;
    subjectsRef.current = [];
    attemptsRef.current = [];
    lastSyncedData.current = "";
    lastSyncedSnapshot.current = { subjects: [], attempts: [] };
    lastRemoteUpdatedAt.current = 0;
    setSubjects([]);
    setAttempts([]);
  }

  function retrySync() {
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
    retrySync,
    signOut,
  };
}
