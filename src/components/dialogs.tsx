/**
 * App-wide dialogs, toasts and select, built on Base UI.
 * Use `ui.confirm`, `ui.prompt`, `ui.toast` and `ui.error` instead of the browser's
 * confirm(), prompt() and alert(). `<DialogHost />` is mounted once in the app layout.
 */
import { AlertDialog } from '@base-ui/react/alert-dialog'
import { Dialog } from '@base-ui/react/dialog'
import { Select as BaseSelect } from '@base-ui/react/select'
import { Toast } from '@base-ui/react/toast'
import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'

// ---------- Modal (forms) ----------

const backdrop = 'm-backdrop fixed inset-0 z-40 bg-black/25'
const popup = 'm-dialog card fixed left-1/2 top-1/2 z-50 max-h-[90vh] w-[calc(100vw-32px)] overflow-y-auto p-6 outline-none'

export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  return (
    <Dialog.Root open onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Backdrop className={backdrop} />
        <Dialog.Popup className={`${popup} ${wide ? 'max-w-2xl' : 'max-w-lg'}`}>
          <div className="mb-4 flex items-center justify-between">
            <Dialog.Title className="text-[17px] font-semibold">{title}</Dialog.Title>
            <Dialog.Close className="grid size-7 place-items-center rounded-full text-[18px] leading-none text-muted hover:bg-canvas hover:text-ink">
              ×
            </Dialog.Close>
          </div>
          {children}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

// ---------- imperative confirm / prompt ----------

export type PromptField = {
  name: string
  label: string
  type?: 'text' | 'number' | 'date' | 'password'
  defaultValue?: string
  required?: boolean
  min?: number
  minLength?: number
  hint?: string
}

type Request =
  | { kind: 'confirm'; title: string; message?: string; confirmLabel: string; danger: boolean; resolve: (v: boolean) => void }
  | {
      kind: 'prompt'
      title: string
      message?: string
      fields: PromptField[]
      submitLabel: string
      resolve: (v: Record<string, string> | null) => void
    }

let current: Request | null = null
const listeners = new Set<(r: Request | null) => void>()
const show = (r: Request | null) => {
  current = r
  listeners.forEach((l) => l(r))
}

const toastManager = Toast.createToastManager()

const message = (e: unknown) => (e instanceof Error ? e.message : String(e))

export const ui = {
  confirm(title: string, opts: { message?: string; confirmLabel?: string; danger?: boolean } = {}) {
    return new Promise<boolean>((resolve) =>
      show({
        kind: 'confirm',
        title,
        message: opts.message,
        confirmLabel: opts.confirmLabel ?? 'Confirm',
        danger: opts.danger ?? false,
        resolve,
      }),
    )
  },
  /** Ask for one or more values. Resolves to the values by field name, or null when cancelled. */
  prompt(title: string, fields: PromptField[], opts: { message?: string; submitLabel?: string } = {}) {
    return new Promise<Record<string, string> | null>((resolve) =>
      show({ kind: 'prompt', title, message: opts.message, fields, submitLabel: opts.submitLabel ?? 'Save', resolve }),
    )
  },
  toast(title: string, tone: 'good' | 'bad' | 'warn' | 'info' = 'good') {
    toastManager.add({ title, type: tone, timeout: tone === 'bad' || tone === 'warn' ? 7000 : 3500 })
  },
  error(e: unknown) {
    ui.toast(message(e), 'bad')
  },
  /** Run an action, show its error as a toast. Returns true when it worked. */
  async run(fn: () => Promise<unknown>, done?: string) {
    try {
      await fn()
      if (done) ui.toast(done)
      return true
    } catch (e) {
      ui.error(e)
      return false
    }
  },
}

function ConfirmView({ r, close }: { r: Extract<Request, { kind: 'confirm' }>; close: (v: boolean) => void }) {
  return (
    <AlertDialog.Root open onOpenChange={(open) => !open && close(false)}>
      <AlertDialog.Portal>
        <AlertDialog.Backdrop className={backdrop} />
        <AlertDialog.Popup className={`${popup} max-w-sm`}>
          <AlertDialog.Title className="text-[17px] font-semibold">{r.title}</AlertDialog.Title>
          {r.message && <AlertDialog.Description className="mt-2 text-[14px] text-ink-2">{r.message}</AlertDialog.Description>}
          <div className="mt-6 flex justify-end gap-2">
            <AlertDialog.Close className="btn-ghost py-2">Cancel</AlertDialog.Close>
            <button className={r.danger ? 'btn bg-bad hover:bg-bad/85' : 'btn'} onClick={() => close(true)} autoFocus>
              {r.confirmLabel}
            </button>
          </div>
        </AlertDialog.Popup>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  )
}

function PromptView({ r, close }: { r: Extract<Request, { kind: 'prompt' }>; close: (v: Record<string, string> | null) => void }) {
  return (
    <Modal title={r.title} onClose={() => close(null)}>
      <form
        className="grid gap-4"
        onSubmit={(e) => {
          e.preventDefault()
          const f = new FormData(e.currentTarget)
          close(Object.fromEntries(r.fields.map((x) => [x.name, String(f.get(x.name) ?? '')])))
        }}
      >
        {r.message && <p className="text-[14px] text-ink-2">{r.message}</p>}
        {r.fields.map((x, i) => (
          <label key={x.name} className="field">
            {x.label}
            <input
              className="input"
              name={x.name}
              type={x.type ?? 'text'}
              defaultValue={x.defaultValue}
              required={x.required ?? true}
              min={x.min}
              minLength={x.minLength}
              autoFocus={i === 0}
            />
            {x.hint && <span className="font-normal text-muted">{x.hint}</span>}
          </label>
        ))}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-ghost py-2" onClick={() => close(null)}>
            Cancel
          </button>
          <button className="btn">{r.submitLabel}</button>
        </div>
      </form>
    </Modal>
  )
}

const TONE: Record<string, string> = { good: 'bg-good', bad: 'bg-bad', warn: 'bg-warn', info: 'bg-accent' }

function Toasts() {
  const { toasts } = Toast.useToastManager()
  return toasts.map((t) => (
    <Toast.Root
      key={t.id}
      toast={t}
      className="pointer-events-auto flex w-[min(380px,calc(100vw-32px))] items-start gap-3 rounded-2xl bg-ink/95 px-4 py-3 text-[13px] text-white shadow-lg backdrop-blur m-toast"
    >
      <span className={`mt-1.5 size-2 shrink-0 rounded-full ${TONE[t.type ?? 'good'] ?? 'bg-good'}`} />
      <Toast.Title className="flex-1 leading-snug" />
      <Toast.Close className="text-white/60 hover:text-white">×</Toast.Close>
    </Toast.Root>
  ))
}

export function DialogHost() {
  const [r, setR] = useState<Request | null>(current)
  useEffect(() => {
    listeners.add(setR)
    return () => void listeners.delete(setR)
  }, [])
  return (
    <Toast.Provider toastManager={toastManager}>
      {r?.kind === 'confirm' && (
        <ConfirmView
          r={r}
          close={(v) => {
            show(null)
            r.resolve(v)
          }}
        />
      )}
      {r?.kind === 'prompt' && (
        <PromptView
          r={r}
          close={(v) => {
            show(null)
            r.resolve(v)
          }}
        />
      )}
      <Toast.Portal>
        <Toast.Viewport className="pointer-events-none fixed bottom-4 left-1/2 z-[60] flex -translate-x-1/2 flex-col items-center gap-2">
          <Toasts />
        </Toast.Viewport>
      </Toast.Portal>
    </Toast.Provider>
  )
}

// ---------- Select ----------

export type Option = { value: string; label: ReactNode }

export function Select({
  name,
  value,
  defaultValue,
  onChange,
  options,
  className = '',
  required,
  placeholder,
}: {
  name?: string
  value?: string
  defaultValue?: string
  onChange?: (v: string) => void
  options: readonly Option[] | readonly string[]
  className?: string
  required?: boolean
  placeholder?: string
}) {
  const items: Option[] = options.map((o) => (typeof o === 'string' ? { value: o, label: o } : o))
  return (
    <BaseSelect.Root
      name={name}
      items={items}
      required={required}
      {...(value !== undefined ? { value } : { defaultValue: defaultValue ?? items[0]?.value ?? null })}
      onValueChange={(v) => v != null && onChange?.(String(v))}
      modal={false}
    >
      <BaseSelect.Trigger
        className={`input flex items-center justify-between gap-2 text-left data-[popup-open]:border-accent ${className}`}
      >
        <BaseSelect.Value className="truncate" placeholder={placeholder} />
        <BaseSelect.Icon className="shrink-0 text-muted">
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M2.5 4 5 1.5 7.5 4M2.5 6 5 8.5 7.5 6" />
          </svg>
        </BaseSelect.Icon>
      </BaseSelect.Trigger>
      <BaseSelect.Portal>
        <BaseSelect.Positioner className="z-[70] outline-none" sideOffset={6} alignItemWithTrigger={false}>
          <BaseSelect.Popup className="m-popover max-h-[min(320px,var(--available-height))] min-w-[var(--anchor-width)] overflow-y-auto rounded-xl border border-line bg-surface/95 p-1 shadow-xl backdrop-blur outline-none">
            <BaseSelect.List>
              {items.map((o) => (
                <BaseSelect.Item
                  key={o.value}
                  value={o.value}
                  className="flex cursor-default items-center gap-2 rounded-lg px-2.5 py-1.5 text-[14px] text-ink outline-none select-none data-[highlighted]:bg-accent data-[highlighted]:text-white"
                >
                  <span className="w-3 text-[12px]">
                    <BaseSelect.ItemIndicator>✓</BaseSelect.ItemIndicator>
                  </span>
                  <BaseSelect.ItemText className="whitespace-nowrap">{o.label}</BaseSelect.ItemText>
                </BaseSelect.Item>
              ))}
            </BaseSelect.List>
          </BaseSelect.Popup>
        </BaseSelect.Positioner>
      </BaseSelect.Portal>
    </BaseSelect.Root>
  )
}
