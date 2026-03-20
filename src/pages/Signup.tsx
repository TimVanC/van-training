import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

function Signup(): React.JSX.Element {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSignup(e: React.FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const res = await fetch('/api/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: email.trim(),
          password,
          invite_code: inviteCode.trim(),
        }),
      });

      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? 'Signup failed');
        setLoading(false);
        return;
      }

      navigate('/login');
    } catch {
      setError('Signup failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="page">
      <h1>Sign Up</h1>
      <form onSubmit={handleSignup} className="input-group">
        <label className="input-label">
          Email
          <input
            className="input-field"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            disabled={loading}
          />
        </label>
        <label className="input-label">
          Password
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
          Invite code
          <input
            className="input-field"
            type="text"
            value={inviteCode}
            onChange={(e) => setInviteCode(e.target.value)}
            required
            disabled={loading}
          />
        </label>
        <button className="nav-button" type="submit" disabled={loading}>
          Sign Up
        </button>
      </form>
      {error ? <p>{error}</p> : null}
      <p>
        Already have an account? <Link to="/login">Login</Link>
      </p>
    </div>
  );
}

export default Signup;
