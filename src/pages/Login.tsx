import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '../utils/supabaseClient';

function Login(): React.JSX.Element {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleLogin(e: React.FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });

    setLoading(false);
    if (signInError) {
      setError(signInError.message);
      return;
    }

    navigate('/');
  }

  return (
    <div className="page">
      <h1>Login</h1>
      <form onSubmit={handleLogin} className="input-group">
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
        <button className="nav-button" type="submit" disabled={loading}>
          Login
        </button>
      </form>
      {error ? <p>{error}</p> : null}
      <p>
        Need an account? <Link to="/signup">Sign up</Link>
      </p>
    </div>
  );
}

export default Login;
