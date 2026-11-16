import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useSearchParams } from 'react-router-dom';
import AuthCard, { Field } from '../components/AuthCard';
import { apiFetch } from '../services/api';

export default function ResetPassword() {
  const token = useSearchParams()[0].get('token') ?? '';
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');
  const { register, handleSubmit, getValues, formState: { errors, isSubmitting } } = useForm();
  const onSubmit = async ({ password }) => {
    setError('');
    try { await apiFetch('/auth/reset-password', { method: 'POST', body: { token, password } }); setDone(true); }
    catch (e) { setError(e.details?.[0]?.message ?? e.message); }
  };
  const login = <Link className="link font-semibold" to="/login">Go to log in</Link>;
  if (done) return <AuthCard title="Password updated" footer={login}><p>You can now log in with your new password. Any other devices were logged out.</p></AuthCard>;
  if (!token) return <AuthCard title="Link problem" footer={<Link className="link font-semibold" to="/forgot-password">Ask for a new link</Link>}><p>This reset link is incomplete.</p></AuthCard>;
  return (
    <AuthCard title="Set a new password" subtitle="Also used when you accept an invitation." footer={login}>
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
        {error && <div role="alert" className="alert alert-error text-sm">{error}</div>}
        <Field label="New password" hint="At least 8 characters." error={errors.password && 'At least 8 characters'}>
          <input type="password" className="input input-bordered" autoComplete="new-password" {...register('password', { required: true, minLength: 8 })} />
        </Field>
        <Field label="Repeat password" error={errors.again && 'Passwords do not match'}>
          <input type="password" className="input input-bordered" autoComplete="new-password" {...register('again', { validate: (v) => v === getValues('password') })} />
        </Field>
        <button className="btn btn-primary w-full" disabled={isSubmitting}>Save password</button>
      </form>
    </AuthCard>
  );
}
