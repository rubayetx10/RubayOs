import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useCohorts } from '../features/academic/useCohorts';
import { apiFetch } from '../services/api';
import { useAuth } from './AuthContext';

const Ctx = createContext({ cohorts: [], cohortId: null, setCohortId: () => {}, semesters: [], semesterId: null, setSemesterId: () => {} });
export const useAcademic = () => useContext(Ctx);

const read = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } };
const write = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage unavailable */ } };

/**
 * Which cohort and semester an admin is looking at, chosen once in the header and shared by every page.
 * Remembered per user and device. It only changes the view, never anyone's enrollment.
 */
export function AcademicProvider({ children }) {
  const { user } = useAuth();
  const { data: cohorts = [] } = useCohorts();
  const cohortKey = `rubayos-ctx:${user.id}`;
  const semKey = `rubayos-sem:${user.id}`;
  const [savedCohort, setSavedCohort] = useState(() => read(cohortKey, null));
  const [semMap, setSemMap] = useState(() => read(semKey, {}));

  const cohortId = cohorts.some((c) => c.id === savedCohort) ? savedCohort : cohorts[0]?.id ?? null;
  const { data: semesters = [] } = useQuery({
    queryKey: ['academic', 'semesters', cohortId],
    enabled: !!cohortId,
    queryFn: () => apiFetch(`/academic/semesters?cohortId=${cohortId}&limit=20`),
  });
  // Default to the semester the batch is in now, so nobody has to pick it twice.
  const semesterId = semesters.some((s) => s._id === semMap[cohortId]) ? semMap[cohortId] : (semesters.find((s) => s.status === 'active') ?? semesters[0])?._id ?? null;

  useEffect(() => { if (cohortId) write(cohortKey, cohortId); }, [cohortKey, cohortId]);
  const setSemesterId = (id) => { const next = { ...semMap, [cohortId]: id }; setSemMap(next); write(semKey, next); };

  const value = useMemo(
    () => ({ cohorts, cohortId, setCohortId: setSavedCohort, semesters, semesterId, setSemesterId }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [cohorts, cohortId, semesters, semesterId, semMap],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function CohortSelect() {
  const { cohorts, cohortId, setCohortId } = useAcademic();
  if (!cohorts.length) return null;
  return (
    <select aria-label="Cohort" className="select select-bordered select-sm max-w-[14rem]" value={cohortId ?? ''} onChange={(e) => setCohortId(e.target.value)}>
      {cohorts.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
    </select>
  );
}

export function SemesterSelect() {
  const { semesters, semesterId, setSemesterId } = useAcademic();
  if (!semesters.length) return null;
  return (
    <select aria-label="Semester" className="select select-bordered select-sm" value={semesterId ?? ''} onChange={(e) => setSemesterId(e.target.value)}>
      {semesters.map((s) => <option key={s._id} value={s._id}>Semester {s.number}{s.status === 'active' ? ' · now' : ''}</option>)}
    </select>
  );
}
