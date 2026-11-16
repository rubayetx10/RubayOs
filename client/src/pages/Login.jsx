import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import AuthCard, { Field } from '../components/AuthCard';
import { useAuth } from '../context/AuthContext';

export default function Login() {
  const { login } = useAuth();
  const nav = useNavigate();
  const from = useLocation().state?.from ?? '/dashboard';
  const [error, setError] = useState('');
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm();

  const onSubmit = async ({ identifier, password }) => {
    setError('');
    try {
      await login(identifier.trim(), password);
      nav(from, { replace: true });
    } catch (e) {
      setError(e.message);
    }
  };

  return (
    <AuthCard
      title="Welcome back"
      subtitle="Log in with your NU registration number or email."
      footer={<>New student? <Link className="link font-semibold" to="/register">Create an account</Link></>}
    >
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
        {error && <div role="alert" className="alert alert-error text-sm">{error}</div>}
        <Field label="Registration number or email" error={errors.identifier && 'Required'}>
          <input className="input input-bordered" autoComplete="username" aria-invalid={!!errors.identifier} {...register('identifier', { required: true })} />
        </Field>
        <Field label="Password" error={errors.password && 'Required'}>
          <input type="password" className="input input-bordered" autoComplete="current-password" aria-invalid={!!errors.password} {...register('password', { required: true })} />
        </Field>
        <button className="btn btn-primary w-full" disabled={isSubmitting}>{isSubmitting ? 'Logging in…' : 'Log in'}</button>
        <p className="text-center text-sm"><Link className="link" to="/forgot-password">Forgot password?</Link></p>
      </form>
    </AuthCard>
  );
}
