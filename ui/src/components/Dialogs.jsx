export function SaveNameDialog({
  open,
  dialog,
  inputRef,
  onClose,
  onChangeValue,
  onSubmit,
}) {
  if (!open) return null;

  return (
    <div class="name-dialog-overlay" onClick={() => onClose(null)}>
      <div class="name-dialog" onClick={(e) => e.stopPropagation()}>
        <div class="name-dialog-head">
          <h3>{dialog.title}</h3>
        </div>
        <div class="name-dialog-body">
          <label for="save-name-input">Name</label>
          <input
            id="save-name-input"
            ref={inputRef}
            value={dialog.value}
            onInput={(e) => onChangeValue(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                onSubmit();
              }
            }}
            placeholder={dialog.placeholder}
          />
        </div>
        <div class="name-dialog-actions">
          <button class="btn secondary" onClick={() => onClose(null)}>Cancel</button>
          <button class="btn" onClick={onSubmit}>{dialog.confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}

export function ConfirmDialog({
  open,
  dialog,
  onClose,
}) {
  if (!open) return null;

  return (
    <div class="confirm-dialog-overlay" onClick={() => onClose(false)}>
      <div class="confirm-dialog" onClick={(e) => e.stopPropagation()}>
        <div class="confirm-dialog-head">
          <h3>{dialog.title}</h3>
        </div>
        <div class="confirm-dialog-body">
          <p>{dialog.message}</p>
        </div>
        <div class="confirm-dialog-actions">
          <button class="btn secondary" onClick={() => onClose(false)}>Cancel</button>
          <button
            class={`btn ${dialog.danger ? 'danger' : ''}`}
            onClick={() => onClose(true)}
          >
            {dialog.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

export function NoticeDialog({
  open,
  dialog,
  onClose,
}) {
  if (!open) return null;

  return (
    <div class="notice-dialog-overlay" onClick={onClose}>
      <div class={`notice-dialog ${dialog.tone}`} onClick={(e) => e.stopPropagation()}>
        <div class="notice-dialog-head">
          <h3>{dialog.title}</h3>
        </div>
        <div class="notice-dialog-body">
          <p>{dialog.message}</p>
        </div>
        <div class="notice-dialog-actions">
          <button class="btn" onClick={onClose}>OK</button>
        </div>
      </div>
    </div>
  );
}
