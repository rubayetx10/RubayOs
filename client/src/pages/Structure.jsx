import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAcademic } from '../context/AcademicContext';
import { apiFetch } from '../services/api';

const post = (path, body) => apiFetch(path, { method: 'POST', body });
const Err = ({ e }) => (e ? <p role="alert" className="mt-2 rounded bg-error px-2 py-1 text-sm font-semibold text-error-content">{e.message}</p> : null);

function NewCohort() {
  const qc = useQueryClient();
  const { setCohortId } = useAcademic();
  const { data: programs = [] } = useQuery({ queryKey: ['structure', 'programs'], queryFn: () => apiFetch('/academic/programs?limit=100') });
  const [programId, setProgramId] = useState('');
  const [label, setLabel] = useState('');
  const [semNo, setSemNo] = useState(1);
  const create = useMutation({
    mutationFn: async () => {
      const program = programs.find((p) => p._id === (programId || programs[0]?._id));
      const m = label.trim().match(/^(\d{2}|\d{4})\s*[-–]\s*(\d{2}|\d{4})$/);
      if (!program || !m) throw new Error('Enter the session like 2022-23 or 22-23');
      const full = (y) => (y.length === 2 ? 2000 + Number(y) : Number(y));
      const start = full(m[1]);
      if (full(m[2]) !== start + 1) throw new Error('A session covers two consecutive years, like 2022-23');
      const name = `${start}-${String(start + 1).slice(-2)}`;
      const sessions = await apiFetch('/academic/sessions?limit=100');
      const session = sessions.find((x) => x.label === name) ?? (await post('/academic/sessions', { institutionId: program.institutionId, label: name, startYear: start, endYear: start + 1 }));
      const cohort = await post('/academic/cohorts', { programId: program._id, sessionId: session._id });
      // An older batch may already be in a later semester. Set this before any student joins.
      if (semNo > 1) await apiFetch(`/academic/cohorts/${cohort._id}`, { method: 'PATCH', body: { currentSemesterNo: semNo } });
      const sems = await apiFetch(`/academic/semesters?cohortId=${cohort._id}&limit=20`);
      for (const x of sems) {
        const status = x.number < semNo ? 'completed' : x.number === semNo ? 'active' : null;
        if (status) await apiFetch(`/academic/semesters/${x._id}`, { method: 'PATCH', body: { status } });
      }
      return cohort;
    },
    onSuccess: (c) => { qc.invalidateQueries({ queryKey: ['cohort-options'] }); setCohortId(c._id); setLabel(''); },
  });
  return (
    <div className="ros-card p-5">
      <h2 className="font-bold">New cohort (batch)</h2>
      <p className="text-sm opacity-70">A cohort is one program and one session, old or new. Its semesters are created for you. Set the semester the batch is in today before students join.</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <select aria-label="Program" className="select select-bordered select-sm" value={programId} onChange={(e) => setProgramId(e.target.value)}>
          {programs.map((p) => <option key={p._id} value={p._id}>{p.name}</option>)}
        </select>
        <input aria-label="Session" className="input input-bordered input-sm w-32" placeholder="2022-23" value={label} onChange={(e) => setLabel(e.target.value)} />
        <label className="flex items-center gap-1 text-sm" htmlFor="curSem">now in semester
          <select id="curSem" className="select select-bordered select-sm" value={semNo} onChange={(e) => setSemNo(Number(e.target.value))}>
            {Array.from({ length: programs.find((p) => p._id === (programId || programs[0]?._id))?.semesterCount ?? 8 }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
        <button className="btn btn-primary btn-sm" disabled={create.isPending || !label} onClick={() => create.mutate()}>Create</button>
      </div>
      <Err e={create.error} />
    </div>
  );
}

function AddPart({ section, onDone }) {
  const [v, setV] = useState({ name: '', min: '', max: '' });
  const add = useMutation({
    mutationFn: () => post('/academic/parts', { sectionId: section._id, name: v.name.trim(), rollMin: Number(v.min), rollMax: Number(v.max) }),
    onSuccess: () => { setV({ name: '', min: '', max: '' }); onDone(); },
  });
  const set = (k) => (e) => setV({ ...v, [k]: e.target.value });
  return (
    <div className="mt-3">
      <div className="flex flex-wrap items-center gap-2">
        <input aria-label="Part name" className="input input-bordered input-sm w-28" placeholder="Part 1" value={v.name} onChange={set('name')} />
        <input aria-label="First roll" type="number" min="1" className="input input-bordered input-sm w-24" placeholder="Roll from" value={v.min} onChange={set('min')} />
        <input aria-label="Last roll" type="number" min="1" className="input input-bordered input-sm w-24" placeholder="Roll to" value={v.max} onChange={set('max')} />
        <button className="btn btn-secondary btn-sm" disabled={add.isPending || !v.name || !v.min || !v.max} onClick={() => add.mutate()}>Add part</button>
      </div>
      <Err e={add.error} />
    </div>
  );
}

function Progress({ cohortId }) {
  const qc = useQueryClient();
  const { semesters, setSemesterId } = useAcademic();
  const { data: cohort } = useQuery({ queryKey: ['structure', 'cohort', cohortId], queryFn: () => apiFetch(`/academic/cohorts/${cohortId}`) });
  const [done, setDone] = useState(null);
  const cur = cohort?.currentSemesterNo;
  const last = semesters.length;
  const move = useMutation({
    mutationFn: () => post(`/enrollment/cohorts/${cohortId}/promote`, { toSemesterNo: cur + 1 }),
    onSuccess: async (r) => {
      const fresh = await apiFetch(`/academic/semesters?cohortId=${cohortId}&limit=20`);
      const next = fresh.find((x) => x.number === r.toSemesterNo);
      ['academic', 'structure', 'enrollment-overview'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      if (next) setSemesterId(next._id);
      setDone(r);
    },
  });
  if (!cohort) return null;
  const ask = () => {
    if (window.confirm(`Move this batch from semester ${cur} to semester ${cur + 1}?\n\nEvery student gets a new record for semester ${cur + 1}. Semester ${cur} records are kept. This cannot be undone here.`)) move.mutate();
  };
  return (
    <div className="ros-card p-5">
      <h2 className="font-bold">Batch progress</h2>
      <p className="mt-1 text-sm">This batch is in <b>semester {cur}</b>.</p>
      <button className="btn btn-secondary btn-sm mt-3" disabled={move.isPending || cur >= last} onClick={ask}>
        {cur >= last ? 'Last semester reached' : `Move batch to semester ${cur + 1}`}
      </button>
      <Err e={move.error} />
      {done && <p role="status" className="mt-3 text-sm">Moved {done.students} student(s) to semester {done.toSemesterNo}. {done.assigned} placed in a section already, {done.unassigned} waiting until you set up sections for this semester.</p>}
    </div>
  );
}

function PartRow({ p, onDone }) {
  const [edit, setEdit] = useState(false);
  const [v, setV] = useState({ name: p.name, min: p.rollMin, max: p.rollMax });
  const save = useMutation({
    mutationFn: (body) => apiFetch(`/academic/parts/${p.id}`, { method: 'PATCH', body }),
    onSuccess: () => { setEdit(false); onDone(); },
  });
  const set = (k) => (e) => setV({ ...v, [k]: e.target.value });
  if (!edit) {
    return (
      <li className="flex flex-wrap items-center gap-2">
        <span className={p.status === 'active' ? '' : 'opacity-60'}>{p.name} · rolls {p.rollMin}–{p.rollMax} · {p.students} student(s){p.status !== 'active' && ' · closed'}</span>
        <button className="btn btn-ghost btn-xs" onClick={() => setEdit(true)}>Edit range</button>
        {p.status === 'active'
          ? <button className="btn btn-ghost btn-xs" onClick={() => window.confirm(`Close ${p.name}? Its roll range will be free for another part.`) && save.mutate({ status: 'inactive' })}>Close</button>
          : <button className="btn btn-ghost btn-xs" onClick={() => save.mutate({ status: 'active' })}>Reopen</button>}
        <Err e={save.error} />
      </li>
    );
  }
  return (
    <li>
      <div className="flex flex-wrap items-center gap-2">
        <input aria-label="Part name" className="input input-bordered input-xs w-24" value={v.name} onChange={set('name')} />
        <input aria-label="First roll" type="number" min="1" className="input input-bordered input-xs w-20" value={v.min} onChange={set('min')} />
        <input aria-label="Last roll" type="number" min="1" className="input input-bordered input-xs w-20" value={v.max} onChange={set('max')} />
        <button className="btn btn-primary btn-xs" disabled={save.isPending} onClick={() => save.mutate({ name: v.name.trim(), rollMin: Number(v.min), rollMax: Number(v.max) })}>Save</button>
        <button className="btn btn-ghost btn-xs" onClick={() => setEdit(false)}>Cancel</button>
      </div>
      <Err e={save.error} />
    </li>
  );
}

function SetRange({ section, onDone }) {
  const [v, setV] = useState({ min: '', max: '' });
  const save = useMutation({
    mutationFn: () => post('/academic/parts', { sectionId: section._id, name: 'All', rollMin: Number(v.min), rollMax: Number(v.max) }),
    onSuccess: () => { setV({ min: '', max: '' }); onDone(); },
  });
  return (
    <div className="mt-2">
      <p className="text-sm opacity-70">No roll range yet. Students stay waiting until you set one.</p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <input aria-label="Roll from" type="number" min="1" className="input input-bordered input-sm w-28" placeholder="Roll from" value={v.min} onChange={(e) => setV({ ...v, min: e.target.value })} />
        <input aria-label="Roll to" type="number" min="1" className="input input-bordered input-sm w-28" placeholder="Roll to" value={v.max} onChange={(e) => setV({ ...v, max: e.target.value })} />
        <button className="btn btn-secondary btn-sm" disabled={save.isPending || !v.min || !v.max} onClick={() => save.mutate()}>Set roll range</button>
      </div>
      <Err e={save.error} />
    </div>
  );
}

function SimpleRange({ part, onDone, onSplit }) {
  const [edit, setEdit] = useState(false);
  const [v, setV] = useState({ min: part.rollMin, max: part.rollMax });
  const save = useMutation({
    mutationFn: (body) => apiFetch(`/academic/parts/${part.id}`, { method: 'PATCH', body }),
    onSuccess: () => { setEdit(false); onDone(); },
  });
  if (part.status !== 'active') {
    return (
      <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
        <span className="opacity-70">Range {part.rollMin}–{part.rollMax} is closed.</span>
        <button className="btn btn-ghost btn-xs" onClick={() => save.mutate({ status: 'active' })}>Reopen</button>
        <Err e={save.error} />
      </div>
    );
  }
  return (
    <div className="mt-2 text-sm">
      {edit ? (
        <div className="flex flex-wrap items-center gap-2">
          <input aria-label="Roll from" type="number" min="1" className="input input-bordered input-xs w-24" value={v.min} onChange={(e) => setV({ ...v, min: e.target.value })} />
          <input aria-label="Roll to" type="number" min="1" className="input input-bordered input-xs w-24" value={v.max} onChange={(e) => setV({ ...v, max: e.target.value })} />
          <button className="btn btn-primary btn-xs" disabled={save.isPending} onClick={() => save.mutate({ rollMin: Number(v.min), rollMax: Number(v.max) })}>Save</button>
          <button className="btn btn-ghost btn-xs" onClick={() => setEdit(false)}>Cancel</button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <span>Roll {part.rollMin}–{part.rollMax} · {part.students} student(s)</span>
          <button className="btn btn-ghost btn-xs" onClick={() => setEdit(true)}>Edit range</button>
          <button className="btn btn-ghost btn-xs" onClick={onSplit}>Split into parts</button>
        </div>
      )}
      <Err e={save.error} />
    </div>
  );
}

/** A section has one roll range. Parts appear only if the admin chooses to split the section. */
function SectionCard({ s, parts, onDone }) {
  const [split, setSplit] = useState(parts.length > 1);
  return (
    <div className="ros-card p-5">
      <h3 className="font-bold">Section {s.name}</h3>
      {split ? (
        <>
          <p className="mt-1 text-xs opacity-70">This section is split into parts. Each part has its own roll range.</p>
          <ul className="mt-2 space-y-1 text-sm">{parts.map((p) => <PartRow key={p.id} p={p} onDone={onDone} />)}</ul>
          <AddPart section={s} onDone={onDone} />
        </>
      ) : parts.length === 0 ? (
        <SetRange section={s} onDone={onDone} />
      ) : (
        <SimpleRange part={parts[0]} onDone={onDone} onSplit={() => setSplit(true)} />
      )}
    </div>
  );
}

function Sections({ cohortId }) {
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [range, setRange] = useState({ min: '', max: '' });
  const [from, setFrom] = useState('');
  const { semesters, semesterId: semId } = useAcademic();
  const { data: sections = [] } = useQuery({ queryKey: ['structure', 'sections', semId], enabled: !!semId, queryFn: () => apiFetch(`/academic/sections?semesterId=${semId}&limit=50`) });
  const { data: ov } = useQuery({ queryKey: ['structure', 'overview', cohortId, semId], enabled: !!semId, queryFn: () => apiFetch(`/enrollment/overview?cohortId=${cohortId}&semesterId=${semId}`) });
  const refresh = () => { qc.invalidateQueries({ queryKey: ['structure'] }); qc.invalidateQueries({ queryKey: ['enrollment-overview'] }); };
  const addSection = useMutation({
    mutationFn: async () => {
      if (range.min && range.max) {
        const a = Number(range.min);
        const b = Number(range.max);
        if (a > b) throw new Error('Roll from cannot be larger than roll to');
        const clash = ov?.parts.find((p) => p.status === 'active' && a <= p.rollMax && p.rollMin <= b);
        if (clash) throw new Error(`Rolls ${a}–${b} overlap section ${clash.sectionName} (${clash.rollMin}–${clash.rollMax}). Nothing was created.`);
      } else if (range.min || range.max) {
        throw new Error('Fill both roll from and roll to, or leave both empty');
      }
      const sec = await post('/academic/sections', { semesterId: semId, name: name.trim() });
      // Optional: give the section its own roll range. It becomes one part you can split later.
      if (range.min && range.max) await post('/academic/parts', { sectionId: sec._id, name: 'All', rollMin: Number(range.min), rollMax: Number(range.max) });
    },
    onSuccess: () => { setName(''); setRange({ min: '', max: '' }); refresh(); },
    onSettled: refresh,
  });
  const fix = useMutation({ mutationFn: () => post('/enrollment/assign', { cohortId, semesterId: semId, mode: 'all' }), onSuccess: refresh });
  const copy = useMutation({
    mutationFn: async () => {
      const [src, srcParts] = await Promise.all([apiFetch(`/academic/sections?semesterId=${from}&limit=100`), apiFetch(`/academic/parts?semesterId=${from}&limit=100`)]);
      const have = new Map(sections.map((x) => [x.name, x._id]));
      for (const sec of src) {
        const id = have.get(sec.name) ?? (await post('/academic/sections', { semesterId: semId, name: sec.name }))._id;
        for (const p of srcParts.filter((x) => x.sectionId === sec._id && x.status === 'active')) {
          try { await post('/academic/parts', { sectionId: id, name: p.name, rollMin: p.rollMin, rollMax: p.rollMax }); } catch { /* already there or overlaps: skip it */ }
        }
      }
    },
    onSuccess: () => { setFrom(''); refresh(); },
  });
  const w = ov?.warnings;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline gap-3">
        <h2 className="text-xl font-bold">Semester {semesters.find((x) => x._id === semId)?.number}</h2>
        {ov && <span className="text-sm opacity-75">{ov.totals.students} students · {ov.totals.unassigned} waiting for a section</span>}
      </div>
      {w && w.gaps.length > 0 && <p className="rounded bg-warning px-3 py-2 text-sm text-warning-content">No part covers rolls {w.gaps.map((g) => `${g.from}–${g.to}`).join(', ')}.</p>}
      {w && w.uncovered.length > 0 && <p className="rounded bg-warning px-3 py-2 text-sm text-warning-content">{w.uncovered.length} student(s) have a roll that no part covers yet.</p>}
      {w && w.misplaced.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded bg-warning px-3 py-2 text-sm text-warning-content">
          {w.misplaced.length} student(s) sit in a part that no longer matches their roll.
          <button className="btn btn-secondary btn-xs" disabled={fix.isPending} onClick={() => fix.mutate()}>Place them again automatically</button>
          <span className="opacity-80">Students you moved by hand stay where they are.</span>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <input aria-label="New section name" className="input input-bordered input-sm w-40" placeholder="Section name, e.g. A" value={name} onChange={(e) => setName(e.target.value)} />
        <input aria-label="Roll from (optional)" type="number" min="1" className="input input-bordered input-sm w-28" placeholder="Roll from" value={range.min} onChange={(e) => setRange({ ...range, min: e.target.value })} />
        <input aria-label="Roll to (optional)" type="number" min="1" className="input input-bordered input-sm w-28" placeholder="Roll to" value={range.max} onChange={(e) => setRange({ ...range, max: e.target.value })} />
        <button className="btn btn-primary btn-sm" disabled={addSection.isPending || !name.trim()} onClick={() => addSection.mutate()}>Add section</button>
      </div>
      <Err e={addSection.error} />
      {semesters.length > 1 && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <label htmlFor="copyFrom">Ranges differ each semester. Start from another one:</label>
          <select id="copyFrom" className="select select-bordered select-sm" value={from} onChange={(e) => setFrom(e.target.value)}>
            <option value="">Choose a semester…</option>
            {semesters.filter((x) => x._id !== semId).map((x) => <option key={x._id} value={x._id}>Semester {x.number}</option>)}
          </select>
          <button className="btn btn-secondary btn-sm" disabled={!from || copy.isPending} onClick={() => copy.mutate()}>Copy sections and parts</button>
          <Err e={copy.error} />
        </div>
      )}
      {sections.length === 0 && <p className="ros-card p-4">No sections in this semester yet.</p>}
      {sections.map((s) => <SectionCard key={s._id} s={s} parts={ov?.parts.filter((p) => p.sectionId === s._id) ?? []} onDone={refresh} />)}
    </div>
  );
}

export default function Structure() {
  const { cohortId } = useAcademic();
  return (
    <section aria-labelledby="st-title" className="space-y-6">
      <div>
        <h1 id="st-title" className="text-3xl font-extrabold tracking-tight">Sections and parts</h1>
        <p className="mt-1 max-w-prose opacity-75">Choose the cohort and semester at the top. Give each section the roll range you use in that semester. Use parts only if you split one section into smaller groups. A student goes where their class roll fits, and two ranges in one semester cannot overlap.</p>
      </div>
      <NewCohort />
      {cohortId && <Progress cohortId={cohortId} />}
      {cohortId ? <Sections cohortId={cohortId} /> : <p className="ros-card p-5">Create a cohort first.</p>}
    </section>
  );
}
