import { useEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';
export function Modal({
  title,
  closeLabel,
  onClose,
  children,
  footer,
}: {
  title: string;
  closeLabel: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    dialog.current?.showModal();
    dialog.current
      ?.querySelector<HTMLElement>('[autofocus], .modal-content input, .modal-content select')
      ?.focus();
    return () => dialog.current?.close();
  }, []);
  return (
    <dialog
      ref={dialog}
      className="modal"
      aria-labelledby="modal-title"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <header>
        <h2 id="modal-title">{title}</h2>
        <button
          className="icon-button"
          title={closeLabel}
          aria-label={closeLabel}
          onClick={onClose}
        >
          <X size={18} />
        </button>
      </header>
      <div className="modal-content">{children}</div>
      {footer && <footer>{footer}</footer>}
    </dialog>
  );
}
