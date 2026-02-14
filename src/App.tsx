import { Routes, Route } from 'react-router-dom';
import ActivitySelection from './pages/ActivitySelection';
import LiftContainer from './pages/LiftContainer';
import Run from './pages/Run';
import Bike from './pages/Bike';
import Swim from './pages/Swim';

function App(): React.JSX.Element {
  return (
    <Routes>
      <Route path="/" element={<ActivitySelection />} />
      <Route path="/lift/*" element={<LiftContainer />} />
      <Route path="/run" element={<Run />} />
      <Route path="/bike" element={<Bike />} />
      <Route path="/swim" element={<Swim />} />
    </Routes>
  );
}

export default App;
