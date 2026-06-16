import { useNavigate } from 'react-router-dom';
import { supabase } from '../utils/supabaseClient';

function Settings(): React.JSX.Element {
  const navigate = useNavigate();

  async function handleLogout(): Promise<void> {
    await supabase.auth.signOut();
    navigate('/login', { replace: true });
  }

  return (
    <div className="page">
      <h1>Settings</h1>
      <div className="button-list">
        <button type="button" className="nav-button nav-button--danger" onClick={handleLogout}>
          Log Out
        </button>
      </div>
    </div>
  );
}

export default Settings;
