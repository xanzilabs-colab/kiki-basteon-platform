"use client";

import { createContext, useCallback, useContext, useRef, useState, type FormEvent, type ReactNode } from "react";

type ConfirmOptions = {
  title?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
};

type PromptOptions = {
  title?: string;
  inputLabel?: string;
  placeholder?: string;
  submitLabel?: string;
  inputType?: "text" | "password";
  inputMode?: "text" | "numeric";
  maxLength?: number;
};

type DialogRequest =
  | {
      id: number;
      kind: "confirm";
      title: string;
      message: string;
      confirmLabel: string;
      cancelLabel: string;
      danger: boolean;
      resolve: (value: boolean) => void;
    }
  | {
      id: number;
      kind: "prompt";
      title: string;
      message: string;
      inputLabel: string;
      placeholder: string;
      submitLabel: string;
      inputType: "text" | "password";
      inputMode: "text" | "numeric";
      maxLength?: number;
      initialValue: string;
      resolve: (value: string | null) => void;
    };

type AppDialogContextValue = {
  confirm: (message: string, options?: ConfirmOptions) => Promise<boolean>;
  prompt: (message: string, initialValue?: string, options?: PromptOptions) => Promise<string | null>;
};

const AppDialogContext = createContext<AppDialogContextValue | null>(null);

export function AppDialogProvider({ children }: { children: ReactNode }) {
  const [active, setActive] = useState<DialogRequest | null>(null);
  const activeRef = useRef<DialogRequest | null>(null);
  const queue = useRef<DialogRequest[]>([]);
  const nextId = useRef(0);

  const enqueue = useCallback((request: DialogRequest) => {
    if (activeRef.current) {
      queue.current.push(request);
      return;
    }
    activeRef.current = request;
    setActive(request);
  }, []);

  const finish = useCallback((value: boolean | string | null) => {
    const request = activeRef.current;
    if (!request) return;
    if (request.kind === "confirm" && typeof value === "boolean") request.resolve(value);
    if (request.kind === "prompt" && (typeof value === "string" || value === null)) request.resolve(value);
    const next = queue.current.shift() ?? null;
    activeRef.current = next;
    setActive(next);
  }, []);

  const confirm = useCallback((message: string, options: ConfirmOptions = {}) => new Promise<boolean>((resolve) => {
    enqueue({
      id: ++nextId.current,
      kind: "confirm",
      title: options.title ?? "Please confirm",
      message,
      confirmLabel: options.confirmLabel ?? "Confirm",
      cancelLabel: options.cancelLabel ?? "Cancel",
      danger: options.danger ?? false,
      resolve,
    });
  }), [enqueue]);

  const prompt = useCallback((message: string, initialValue = "", options: PromptOptions = {}) => new Promise<string | null>((resolve) => {
    enqueue({
      id: ++nextId.current,
      kind: "prompt",
      title: options.title ?? "Enter a value",
      message,
      inputLabel: options.inputLabel ?? "Value",
      placeholder: options.placeholder ?? "",
      submitLabel: options.submitLabel ?? "Save",
      inputType: options.inputType ?? "text",
      inputMode: options.inputMode ?? "text",
      maxLength: options.maxLength,
      initialValue,
      resolve,
    });
  }), [enqueue]);

  const submitPrompt = (event: FormEvent<HTMLFormElement>, value: string) => {
    event.preventDefault();
    finish(value);
  };

  return (
    <AppDialogContext.Provider value={{ confirm, prompt }}>
      {children}
      {active && (
        <DialogSurface
          key={active.id}
          request={active}
          onCancel={() => finish(active.kind === "confirm" ? false : null)}
          onConfirm={() => finish(true)}
          onSubmit={(event, value) => submitPrompt(event, value)}
        />
      )}
    </AppDialogContext.Provider>
  );
}

export function useAppDialog() {
  const context = useContext(AppDialogContext);
  if (!context) throw new Error("useAppDialog must be used inside AppDialogProvider.");
  return context;
}

function DialogSurface({
  request,
  onCancel,
  onConfirm,
  onSubmit,
}: {
  request: DialogRequest;
  onCancel: () => void;
  onConfirm: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>, value: string) => void;
}) {
  const [value, setValue] = useState(request.kind === "prompt" ? request.initialValue : "");
  const titleId = `app-dialog-title-${request.id}`;
  const messageId = `app-dialog-message-${request.id}`;

  return (
    <div
      className="fixed inset-0 z-[10000] grid place-items-center bg-slate-950/70 p-4 backdrop-blur-sm"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <section
        className="w-full max-w-md rounded-2xl border border-white/15 bg-[#151d1b] p-5 text-white shadow-2xl"
        role={request.kind === "confirm" ? "alertdialog" : "dialog"}
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={messageId}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            onCancel();
          }
        }}
      >
        <h2 id={titleId} className="text-lg font-semibold">{request.title}</h2>
        <p id={messageId} className="mt-2 text-sm leading-relaxed text-white/75">{request.message}</p>
        {request.kind === "prompt" ? (
          <form className="mt-5 space-y-4" onSubmit={(event) => onSubmit(event, value)}>
            <label className="block space-y-1.5 text-sm">
              <span>{request.inputLabel}</span>
              <input
                className="input w-full"
                autoFocus
                value={value}
                placeholder={request.placeholder}
                type={request.inputType}
                inputMode={request.inputMode}
                maxLength={request.maxLength}
                autoComplete={request.inputType === "password" ? "current-password" : "off"}
                onChange={(event) => setValue(event.target.value)}
              />
            </label>
            <div className="flex justify-end gap-2">
              <button type="button" className="btn" onClick={onCancel}>Cancel</button>
              <button type="submit" className="btn btn-primary">{request.submitLabel}</button>
            </div>
          </form>
        ) : (
          <div className="mt-5 flex justify-end gap-2">
            <button type="button" className="btn" autoFocus onClick={onCancel}>{request.cancelLabel}</button>
            <button
              type="button"
              className={request.danger ? "btn btn-danger" : "btn btn-primary"}
              onClick={onConfirm}
            >
              {request.confirmLabel}
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
