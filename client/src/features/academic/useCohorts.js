import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../../services/api';

/** Cohorts the signed-in admin may see, each with a readable label like "2023-24 · B.Sc. (Honours)". */
export function useCohorts(enabled = true) {
  return useQuery({
    queryKey: ['cohort-options'],
    enabled,
    queryFn: async () => {
      const [cohorts, sessions, programs] = await Promise.all([
        apiFetch('/academic/cohorts?limit=100'), apiFetch('/academic/sessions?limit=100'), apiFetch('/academic/programs?limit=100'),
      ]);
      const s = Object.fromEntries(sessions.map((x) => [x._id, x.label]));
      const p = Object.fromEntries(programs.map((x) => [x._id, x.name]));
      return cohorts
        .map((c) => ({ id: c._id, departmentId: c.departmentId, label: `${s[c.sessionId] ?? '?'} · ${p[c.programId] ?? '?'}` }))
        .sort((a, b) => a.label.localeCompare(b.label));
    },
  });
}
