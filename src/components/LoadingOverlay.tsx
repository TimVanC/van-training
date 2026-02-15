interface LoadingOverlayProps {
  visible: boolean;
}

function LoadingOverlay({ visible }: LoadingOverlayProps): React.JSX.Element {
  if (!visible) return <></>;

  return (
    <div className="loading-overlay" aria-hidden="true">
      <div className="loading-overlay-box">
        <div className="loading-spinner" />
      </div>
    </div>
  );
}

export default LoadingOverlay;
