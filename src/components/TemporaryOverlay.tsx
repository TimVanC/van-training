interface TemporaryOverlayProps {
  message: string;
  visible: boolean;
}

function TemporaryOverlay({ message, visible }: TemporaryOverlayProps): React.JSX.Element | null {
  if (!visible) return null;

  return (
    <div className="overlay">
      <p className="overlay-message">{message}</p>
    </div>
  );
}

export default TemporaryOverlay;
