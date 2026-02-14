interface TemporaryOverlayProps {
  message: string;
  visible: boolean;
}

function TemporaryOverlay({ message, visible }: TemporaryOverlayProps): React.JSX.Element {
  return (
    <div className={`overlay ${visible ? 'overlay--visible' : ''}`}>
      <p className="overlay-message">{message}</p>
    </div>
  );
}

export default TemporaryOverlay;
