import EnduranceForm from '../components/EnduranceForm';

function calculateSpeed(distance: number, totalSeconds: number): number {
  return distance / (totalSeconds / 3600);
}

function formatSpeed(metric: number): string {
  return metric.toFixed(1) + ' mph';
}

function Bike(): React.JSX.Element {
  return (
    <EnduranceForm
      activityType="Bike"
      title="Bike"
      distanceUnit="miles"
      metricLabel="Avg Speed"
      calculateMetric={calculateSpeed}
      formatMetric={formatSpeed}
    />
  );
}

export default Bike;
