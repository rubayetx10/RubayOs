import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import AuthCard, { Field } from '../components/AuthCard';
import { useAuth } from '../context/AuthContext';
import { apiFetch } from '../services/api';

export default function Register() {
  const { register: signUp } = useAuth();
  const nav = useNavigate();
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const { data: depts = [] } = useQuery({ queryKey: ['departments'], queryFn: () => apiFetch('/public/departments') });
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm();

  const onSubmit = async (v) => {
    setError('');
    try {
      const d = await signUp({ departmentId: v.departmentId, name: v.name.trim(), registrationNo: v.registrationNo.trim(), classRoll: v.classRoll, email: v.email.trim(), password: v.password });
      if (d.status === 'active') nav('/dashboard', { replace: true });
      else setPending(true);
    } catch (e) {
      setError(e.details?.[0]?.message ? `${e.message}: ${e.details[0].message}` : e.message);
    }
  };

  if (pending) {
    return (
      <AuthCard title="Request received" footer={<Link className="link font-semibold" to="/login">Back to log in</Link>}>
        <p>Your details did not match the class list exactly, so an admin will check them. You can log in once they approve your account.</p>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title="Create your account"
      subtitle="Use the same name, registration number and class roll as your class list."
      footer={<>Already registered? <Link className="link font-semibold" to="/login">Log in</Link></>}
    >
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
        {error && <div role="alert" className="alert alert-error text-sm">{error}</div>}
        <Field label="Department" error={errors.departmentId && 'Choose your department'}>
          <select className="select select-bordered" {...register('departmentId', { required: true })} defaultValue="">
            <option value="" disabled>Select…</option>
            {depts.map((d) => <option key={d.id} value={d.id}>{d.name} ({d.collegeName})</option>)}
          </select>
        </Field>
        <Field label="Full name" error={errors.name && 'Enter your name'}>
          <input className="input input-bordered" autoComplete="name" {...register('name', { required: true, minLength: 2 })} />
        </Field>
        <Field label="NU registration number" error={errors.registrationNo && '4 to 25 letters or digits'}>
          <input className="input input-bordered" inputMode="numeric" {...register('registrationNo', { required: true, pattern: /^[A-Za-z0-9-]{4,25}$/ })} />
        </Field>
        <Field label="Class roll" error={errors.classRoll && 'Enter your class roll as a number'}>
          <input type="number" min="1" className="input input-bordered" {...register('classRoll', { required: true, valueAsNumber: true, min: 1 })} />
        </Field>
        <Field label="Email" hint="Used to reset your password." error={errors.email && 'Enter a valid email'}>
          <input type="email" className="input input-bordered" autoComplete="email" {...register('email', { required: true })} />
        </Field>
        <Field label="Password" hint="At least 8 characters." error={errors.password && 'At least 8 characters'}>
          <input type="password" className="input input-bordered" autoComplete="new-password" {...register('password', { required: true, minLength: 8 })} />
        </Field>
        <button className="btn btn-primary w-full" disabled={isSubmitting}>{isSubmitting ? 'Creating…' : 'Create account'}</button>
      </form>
    </AuthCard>
  );
}
