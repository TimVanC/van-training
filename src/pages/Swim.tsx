import EnduranceForm from '../components/EnduranceForm';
import { formatSecondsToMinSec } from '../utils/format';

function calculatePacePer100(distance: number, totalSeconds: number): number {
  return (totalSeconds / distance) * 100;
}

function formatPacePer100(metric: number): string {
  return formatSecondsToMinSec(metric) + ' /100yd';
}

function Swim(): React.JSX.Element {
  return (
    <EnduranceForm
      activityType="Swim"
      title="Swim"
      distanceUnit="yards"
      metricLabel="Pace"
      calculateMetric={calculatePacePer100}
      formatMetric={formatPacePer100}
    />
  );
}

export default Swim;
