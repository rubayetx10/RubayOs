import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link } from 'react-router-dom';
import AuthCard, { Field } from '../components/AuthCard';
import { apiFetch } from '../services/api';

export default function ForgotPassword() {
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm();
  const onSubmit = async ({ identifier }) => {
    setError('');
    try { await apiFetch('/auth/forgot-password', { method: 'POST', body: { identifier: identifier.trim() } }); setSent(true); }
    catch (e) { setError(e.message); }
  };
  const back = <Link className="link font-semibold" to="/login">Back to log in</Link>;
  if (sent) return <AuthCard title="Check your email" footer={back}><p>If an account exists, we sent a reset link to its email. The link works once and expires in 30 minutes.</p></AuthCard>;
  return (
    <AuthCard title="Forgot password" subtitle="Enter your registration number or email." footer={back}>
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
        {error && <div role="alert" className="alert alert-error text-sm">{error}</div>}
        <Field label="Registration number or email" error={errors.identifier && 'Required'}>
          <input className="input input-bordered" autoComplete="username" {...register('identifier', { required: true, minLength: 3 })} />
        </Field>
        <button className="btn btn-primary w-full" disabled={isSubmitting}>Send reset link</button>
      </form>
    </AuthCard>
  );
}
