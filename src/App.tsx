import { Routes, Route } from 'react-router-dom';
import ActivitySelection from './pages/ActivitySelection';
import SplitSelection from './pages/SplitSelection';
import DaySelection from './pages/DaySelection';
import ExerciseList from './pages/ExerciseList';
import Run from './pages/Run';
import Bike from './pages/Bike';
import Swim from './pages/Swim';

function App(): React.JSX.Element {
  return (
    <Routes>
      <Route path="/" element={<ActivitySelection />} />
      <Route path="/lift" element={<SplitSelection />} />
      <Route path="/lift/:splitName" element={<DaySelection />} />
      <Route path="/lift/:splitName/:dayName" element={<ExerciseList />} />
      <Route path="/run" element={<Run />} />
      <Route path="/bike" element={<Bike />} />
      <Route path="/swim" element={<Swim />} />
    </Routes>
  );
}

export default App;
