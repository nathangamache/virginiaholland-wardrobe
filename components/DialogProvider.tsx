'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import { X } from 'lucide-react';

/**
 * Replaces window.confirm() and window.alert() with custom in-app modals.
 *
 * Usage anywhere inside the app tree:
 *
 *   const { confirm, alert } = useDialog();
 *
 *   const ok = await confirm({
 *     title: 'Remove this piece?',
 *     body: 'This deletes it from your closet permanently.',
 *     confirmLabel: 'Remove',
 *     danger: true,
 *   });
 *   if (ok) doRemoval();
 *
 *   await alert({
 *     title: 'Logged',
 *     body: 'Outfit saved. Add a mirror photo on the Outfits tab anytime.',
 *   });
 *
 * Both methods return Promises that resolve after the user dismisses the
 * modal. confirm() resolves to true/false; alert() resolves to undefined.
 *
 * Modals stack visually only if their backdrops were independent — our
 * implementation shows one at a time. If two are queued in code, the second
 * waits until the first resolves.
 */

interface ConfirmOpts {
  title: string;
  body?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  // When true, the confirm button is styled red — use for destructive actions
  danger?: boolean;
}

interface AlertOpts {
  title: string;
  body?: string;
  ctaLabel?: string;
}

interface DialogContextValue {
  confirm: (opts: ConfirmOpts) => Promise<boolean>;
  alert: (opts: AlertOpts) => Promise<void>;
}

const DialogContext = createContext<DialogContextValue | null>(null);

interface OpenConfirm {
  kind: 'confirm';
  opts: ConfirmOpts;
  resolve: (v: boolean) => void;
}

interface OpenAlert {
  kind: 'alert';
  opts: AlertOpts;
  resolve: () => void;
}

type OpenState = OpenConfirm | OpenAlert | null;

export function DialogProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState<OpenState>(null);
  // Queue of dialogs requested while another is open. We process them
  // one at a time so the UI never has overlapping modals.
  const queueRef = useRef<OpenState[]>([]);

  const showNext = useCallback(() => {
    const next = queueRef.current.shift();
    setOpen(next ?? null);
  }, []);

  const enqueue = useCallback(
    (state: NonNullable<OpenState>) => {
      // If something is already showing, queue this one
      // eslint-disable-next-line react-hooks/exhaustive-deps
      if (open) {
        queueRef.current.push(state);
      } else {
        setOpen(state);
      }
    },
    [open]
  );

  const confirm = useCallback(
    (opts: ConfirmOpts) =>
      new Promise<boolean>((resolve) => {
        enqueue({ kind: 'confirm', opts, resolve });
      }),
    [enqueue]
  );

  const alert = useCallback(
    (opts: AlertOpts) =>
      new Promise<void>((resolve) => {
        enqueue({ kind: 'alert', opts, resolve });
      }),
    [enqueue]
  );

  function handleClose(result: boolean) {
    if (!open) return;
    if (open.kind === 'confirm') {
      open.resolve(result);
    } else {
      open.resolve();
    }
    showNext();
  }

  // Esc-to-cancel for keyboard users on desktop
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') handleClose(false);
      if (e.key === 'Enter') handleClose(true);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return (
    <DialogContext.Provider value={{ confirm, alert }}>
      {children}
      {open && (
        <DialogModal
          state={open}
          onConfirm={() => handleClose(true)}
          onCancel={() => handleClose(false)}
        />
      )}
    </DialogContext.Provider>
  );
}

export function useDialog(): DialogContextValue {
  const ctx = useContext(DialogContext);
  if (!ctx) {
    throw new Error('useDialog must be used inside <DialogProvider>');
  }
  return ctx;
}

// ---------------------------------------------------------------------------

function DialogModal({
  state,
  onConfirm,
  onCancel,
}: {
  state: NonNullable<OpenState>;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const isConfirm = state.kind === 'confirm';
  const opts = state.opts;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/40 backdrop-blur-[2px] animate-fade-up"
      onClick={onCancel}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="bg-white max-w-sm w-full p-6 shadow-xl relative"
        style={{ borderRadius: '4px' }}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onCancel}
          className="absolute top-3 right-3 w-8 h-8 flex items-center justify-center text-ink-400 hover:text-pink-700 transition-colors"
          aria-label="Close"
        >
          <X className="w-4 h-4" strokeWidth={1.5} />
        </button>

        <div className="eyebrow mb-2">{isConfirm ? 'Confirm' : 'Heads up'}</div>
        <div className="wordmark italic text-2xl text-ink-900 mb-3 pr-8 leading-tight">
          {opts.title}
        </div>
        {opts.body && (
          <p className="text-sm text-ink-700 leading-relaxed mb-6">{opts.body}</p>
        )}

        <div className="flex gap-2 justify-end">
          {isConfirm && (
            <button onClick={onCancel} className="btn-ghost py-2 px-4 text-sm">
              {(opts as ConfirmOpts).cancelLabel ?? 'Cancel'}
            </button>
          )}
          <button
            onClick={onConfirm}
            autoFocus
            className={
              isConfirm && (opts as ConfirmOpts).danger
                ? 'btn py-2 px-4 text-sm'
                : 'btn py-2 px-4 text-sm'
            }
            style={
              isConfirm && (opts as ConfirmOpts).danger
                ? { backgroundColor: '#9a1040' }
                : undefined
            }
          >
            {isConfirm
              ? (opts as ConfirmOpts).confirmLabel ?? 'OK'
              : (opts as AlertOpts).ctaLabel ?? 'OK'}
          </button>
        </div>
      </div>
    </div>
  );
}
