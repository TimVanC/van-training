import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../utils/supabaseClient';

function ResetPassword(): React.JSX.Element {
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    setError(null);

    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    if (password.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }

    setLoading(true);
    const { error: updateError } = await supabase.auth.updateUser({ password });
    setLoading(false);

    if (updateError) {
      setError(updateError.message);
      return;
    }

    navigate('/');
  }

  return (
    <div className="page">
      <div className="auth-card">
        <h1>Set New Password</h1>
        <form onSubmit={handleSubmit} className="input-group">
          <label className="input-label">
            New Password
            <input
              className="input-field"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              disabled={loading}
            />
          </label>
          <label className="input-label">
            Confirm Password
            <input
              className="input-field"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
              disabled={loading}
            />
          </label>
          <button className="auth-submit-button" type="submit" disabled={loading}>
            {loading ? 'Saving...' : 'Save New Password'}
          </button>
        </form>
        {error ? <p className="auth-error">{error}</p> : null}
      </div>
    </div>
  );
}

export default ResetPassword;
