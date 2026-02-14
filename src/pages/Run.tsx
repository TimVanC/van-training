import EnduranceForm from '../components/EnduranceForm';
import { formatSecondsToMinSec } from '../utils/format';

function calculatePace(distance: number, totalSeconds: number): number {
  return totalSeconds / distance;
}

function formatPace(metric: number): string {
  return formatSecondsToMinSec(metric) + ' /mi';
}

function Run(): React.JSX.Element {
  return (
    <EnduranceForm
      activityType="Run"
      title="Run"
      distanceUnit="miles"
      metricLabel="Pace"
      calculateMetric={calculatePace}
      formatMetric={formatPace}
    />
  );
}

export default Run;
