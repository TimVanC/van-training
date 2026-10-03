import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { postCoachJson } from '../utils/coachApi';
import { supabase } from '../utils/supabaseClient';

/** Account card in Settings: who is signed in, data export, log out, and account deletion. */
function AccountSettings({ email }: { email: string | null }): React.JSX.Element {
  const navigate = useNavigate();
  const [exporting, setExporting] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function handleLogout(): Promise<void> {
    await supabase.auth.signOut();
    navigate('/login', { replace: true });
  }

  async function handleExport(): Promise<void> {
    setMessage(null);
    setExporting(true);
    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      const response = await fetch('/api/exportData', { headers: token ? { Authorization: `Bearer ${token}` } : {} });
      if (!response.ok) throw new Error('export failed');
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement('a');
      link.href = url;
      link.download = `van-training-export-${new Date().toISOString().slice(0, 10)}.json`;
      link.click();
      URL.revokeObjectURL(url);
    } catch {
      setMessage("Couldn't build your export. Try again.");
    }
    setExporting(false);
  }

  async function handleDelete(): Promise<void> {
    setMessage(null);
    setDeleting(true);
    const result = await postCoachJson<{ deleted: boolean }>('/api/deleteAccount', { confirmEmail: confirmText });
    if (!result.ok) {
      setDeleting(false);
      setMessage(result.error);
      return;
    }
    // Clear what this device remembers about the account, then drop the session.
    try {
      localStorage.clear();
    } catch {
      // Nothing to clear.
    }
    await supabase.auth.signOut();
    navigate('/login', { replace: true });
  }

  const emailMatches = email !== null && confirmText.trim().toLowerCase() === email.toLowerCase();

  return (
    <section className="settings-card">
      <h2 className="settings-card-title">Account</h2>
      {email && <p className="settings-note">{email}</p>}
      <button type="button" className="settings-btn" onClick={() => void handleExport()} disabled={exporting}>
        {exporting ? 'Preparing your data…' : 'Download my data'}
      </button>
      <button type="button" className="settings-btn settings-btn--danger" onClick={() => void handleLogout()}>
        Log out
      </button>

      {!confirming ? (
        <button type="button" className="settings-link-btn" onClick={() => setConfirming(true)}>
          Delete account
        </button>
      ) : (
        <div className="settings-delete">
          <p className="settings-note">
            This permanently deletes your account, your splits and every workout you've logged. It can't be undone. Type your email
            to confirm.
          </p>
          <input
            className="input-field settings-delete-input"
            type="email"
            autoComplete="off"
            placeholder="Your email"
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            disabled={deleting}
            aria-label="Type your email to confirm"
          />
          <div className="settings-delete-actions">
            <button
              type="button"
              className="settings-btn"
              onClick={() => {
                setConfirming(false);
                setConfirmText('');
                setMessage(null);
              }}
              disabled={deleting}
            >
              Keep my account
            </button>
            <button
              type="button"
              className="settings-btn settings-btn--danger"
              onClick={() => void handleDelete()}
              disabled={!emailMatches || deleting}
            >
              {deleting ? 'Deleting…' : 'Delete everything'}
            </button>
          </div>
        </div>
      )}
      {message && <p className="ob-error">{message}</p>}
    </section>
  );
}

export default AccountSettings;
