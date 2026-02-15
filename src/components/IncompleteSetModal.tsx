interface IncompleteSetModalProps {
  visible: boolean;
  onDiscard: () => void;
  onGoBack: () => void;
}

function IncompleteSetModal({ visible, onDiscard, onGoBack }: IncompleteSetModalProps): React.JSX.Element {
  if (!visible) return <></>;

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="incomplete-set-title">
      <div className="modal-card">
        <h2 id="incomplete-set-title" className="modal-title">Incomplete Set</h2>
        <p className="modal-message">You entered part of a set. Do you want to discard it?</p>
        <div className="modal-actions">
          <button className="nav-button" onClick={onDiscard}>Discard and Finish</button>
          <button className="nav-button" onClick={onGoBack}>Go Back</button>
        </div>
      </div>
    </div>
  );
}

export default IncompleteSetModal;
