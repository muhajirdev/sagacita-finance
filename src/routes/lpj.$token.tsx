import { createFileRoute, useRouter } from '@tanstack/react-router'
import { useState } from 'react'

import { rp } from '#/lib/format'
import { getLpjPublic, submitLpjPublic } from '#/server/lpj'

/** Public LPJ page: the person holding a cash advance fills what they spent, with a receipt per item. No login; the token is the key. */
export const Route = createFileRoute('/lpj/$token')({
  head: () => ({ meta: [{ title: 'LPJ · Sagacita' }, { name: 'robots', content: 'noindex' }, { name: 'referrer', content: 'no-referrer' }] }),
  loader: ({ params }) => getLpjPublic({ data: { token: params.token } }),
  component: LpjPage,
})

type Row = { key: number; date: string; description: string; amount: string; accountId: number | null; documentId: number | null; filename: string | null; uploading: boolean }

const today = () => new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10)
let nextKey = 1
const blank = (): Row => ({ key: nextKey++, date: today(), description: '', amount: '', accountId: null, documentId: null, filename: null, uploading: false })

/** Phone photos are often 4-8 MB: shrink to a 1600 px JPEG before upload. PDFs go as they are. */
async function shrink(file: File): Promise<Blob> {
  if (!file.type.startsWith('image/') || file.size < 800_000) return file
  try {
    const img = await createImageBitmap(file)
    const scale = Math.min(1, 1600 / Math.max(img.width, img.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(img.width * scale)
    canvas.height = Math.round(img.height * scale)
    canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height)
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', 0.8))
    return blob ?? file
  } catch {
    return file
  }
}

function LpjPage() {
  const data = Route.useLoaderData()
  const { token } = Route.useParams()
  const router = useRouter()
  const [rows, setRows] = useState<Row[]>(() =>
    data?.items.length
      ? data.items.map((i) => ({ ...blank(), date: i.date, description: i.description, amount: String(i.amount), accountId: i.accountId ?? null, documentId: i.documentId ?? null, filename: i.documentId ? 'Struk sudah diunggah' : null }))
      : [blank()],
  )
  const [note, setNote] = useState(data?.note ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState(!data?.submittedAt)

  if (!data)
    return (
      <Shell>
        <div className="card p-6 text-center">
          <h1 className="text-lg font-semibold">Link tidak valid</h1>
          <p className="mt-1 text-sm text-muted">Minta link LPJ yang baru ke tim finance.</p>
        </div>
      </Shell>
    )

  const { advance } = data
  const spent = rows.reduce((a, r) => a + (Number(r.amount) || 0), 0)
  const diff = spent - advance.amount
  const set = (key: number, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)))

  const upload = async (key: number, file: File | undefined) => {
    if (!file) return
    set(key, { uploading: true })
    const body = new FormData()
    const blob = await shrink(file)
    body.set('file', blob, blob === file ? file.name : file.name.replace(/\.\w+$/, '') + '.jpg')
    const res = await fetch(`/lpj-receipt/${token}`, { method: 'POST', body })
    if (!res.ok) {
      setError(await res.text())
      return set(key, { uploading: false })
    }
    const doc = (await res.json()) as { id: number; filename: string }
    set(key, { uploading: false, documentId: doc.id, filename: file.name })
  }

  const submit = async () => {
    setError('')
    const items = rows.filter((r) => r.description.trim() || Number(r.amount))
    if (!items.length) return setError('Tambahkan minimal satu item.')
    if (items.some((r) => !r.description.trim() || !(Number(r.amount) > 0))) return setError('Setiap item perlu keterangan dan jumlah.')
    if (items.some((r) => !r.accountId)) return setError('Pilih akun (COA) untuk setiap item.')
    if (items.some((r) => r.uploading)) return setError('Tunggu sampai struk selesai diunggah.')
    setBusy(true)
    try {
      await submitLpjPublic({
        data: {
          token,
          note: note || undefined,
          items: items.map((r) => ({ date: r.date, description: r.description.trim(), amount: Math.round(Number(r.amount)), accountId: r.accountId, documentId: r.documentId })),
        },
      })
      await router.invalidate()
      setEditing(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Shell>
      <div className="card space-y-1 p-5">
        <div className="text-[12px] font-medium uppercase tracking-wide text-muted">LPJ uang muka{advance.number ? ` · ${advance.number}` : ''}</div>
        <div className="text-2xl font-semibold">{rp(advance.amount)}</div>
        <div className="text-sm">{advance.person ?? '—'}</div>
        <div className="text-sm text-muted">{advance.project}</div>
        {advance.description && <div className="text-sm text-muted">{advance.description}</div>}
        {advance.lpjDue && !advance.settled && <div className={`text-sm ${advance.lpjDue < today() ? 'text-bad' : 'text-muted'}`}>Batas LPJ {advance.lpjDue}</div>}
      </div>

      {advance.settled ? (
        <div className="card mt-4 p-5 text-center">
          <span className="pill-good">Selesai</span>
          <p className="mt-2 text-sm text-muted">LPJ ini sudah diselesaikan oleh finance. Link ini sudah ditutup.</p>
        </div>
      ) : !editing ? (
        <div className="card mt-4 space-y-3 p-5">
          <span className="pill-warn">LPJ terkirim, menunggu review finance</span>
          <ul className="divide-y divide-line text-sm">
            {data.items.map((i, n) => (
              <li key={n} className="flex justify-between gap-3 py-2">
                <span>
                  {i.description}
                  <span className="block text-[12px] text-muted">
                    {i.date}
                    {i.accountId ? ' · ' + (data.accounts.find((a) => a.id === i.accountId)?.code ?? '') : ''}
                    {i.documentId ? ' · struk ✓' : ' · tanpa struk'}
                  </span>
                </span>
                <span className="num whitespace-nowrap">{rp(i.amount)}</span>
              </li>
            ))}
          </ul>
          <Summary spent={data.items.reduce((a, i) => a + i.amount, 0)} advance={advance.amount} />
          <button className="btn-ghost" onClick={() => setEditing(true)}>
            Ubah
          </button>
        </div>
      ) : (
        <div className="mt-4 space-y-3">
          {rows.map((r, n) => (
            <div key={r.key} className="card space-y-2 p-4">
              <div className="flex items-center justify-between text-[12px] font-medium text-muted">
                <span>Item {n + 1}</span>
                {rows.length > 1 && (
                  <button className="text-bad" onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))}>
                    Hapus
                  </button>
                )}
              </div>
              <input className="input" placeholder="Keterangan (mis. Konsumsi meeting klien)" value={r.description} onChange={(e) => set(r.key, { description: e.target.value })} />
              <select
                className={`input ${r.accountId ? '' : 'text-muted'}`}
                value={r.accountId ?? ''}
                onChange={(e) => set(r.key, { accountId: e.target.value ? Number(e.target.value) : null })}
              >
                <option value="">Pilih akun (COA)</option>
                {data.accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.code} {a.name}
                  </option>
                ))}
              </select>
              <div className="grid grid-cols-2 gap-2">
                <input className="input" type="date" value={r.date} onChange={(e) => set(r.key, { date: e.target.value })} />
                <input
                  className="input"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  placeholder="Jumlah (Rp)"
                  value={r.amount}
                  onChange={(e) => set(r.key, { amount: e.target.value })}
                />
              </div>
              <label className="flex cursor-pointer items-center gap-2 rounded-xl border border-dashed border-line-2 px-3 py-2.5 text-sm">
                <span className={r.documentId ? 'text-good' : 'text-accent'}>{r.uploading ? 'Mengunggah…' : r.documentId ? '✓ ' + (r.filename ?? 'Struk') : '📷 Foto / PDF struk'}</span>
                <input type="file" accept="image/*,application/pdf" className="hidden" onChange={(e) => upload(r.key, e.target.files?.[0])} />
              </label>
            </div>
          ))}
          <button className="btn-ghost w-full justify-center py-2" onClick={() => setRows((rs) => [...rs, blank()])}>
            + Tambah item
          </button>
          <textarea className="input min-h-16" placeholder="Catatan (opsional)" value={note} onChange={(e) => setNote(e.target.value)} />
          <div className="card p-4">
            <Summary spent={spent} advance={advance.amount} />
          </div>
          {error && <p className="text-sm text-bad">{error}</p>}
          <button className="btn w-full py-3 text-[15px]" disabled={busy} onClick={submit}>
            {busy ? 'Mengirim…' : 'Kirim LPJ'}
          </button>
          <p className="text-center text-[12px] text-muted">
            {diff > 0 ? `Lebih ${rp(diff)}: finance akan membayar selisihnya.` : diff < 0 ? `Sisa ${rp(-diff)}: dikembalikan ke kantor.` : ''}
          </p>
        </div>
      )}
    </Shell>
  )
}

function Summary({ spent, advance }: { spent: number; advance: number }) {
  const diff = spent - advance
  return (
    <dl className="space-y-1 text-sm">
      <div className="flex justify-between">
        <dt className="text-muted">Uang muka</dt>
        <dd className="num">{rp(advance)}</dd>
      </div>
      <div className="flex justify-between">
        <dt className="text-muted">Total terpakai</dt>
        <dd className="num">{rp(spent)}</dd>
      </div>
      <div className="flex justify-between font-medium">
        <dt>{diff > 0 ? 'Kurang (dibayar ke Anda)' : diff < 0 ? 'Sisa (dikembalikan)' : 'Selisih'}</dt>
        <dd className={`num ${diff > 0 ? 'text-warn' : diff < 0 ? 'text-good' : ''}`}>{rp(Math.abs(diff))}</dd>
      </div>
    </dl>
  )
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-canvas px-4 py-6">
      <div className="mx-auto max-w-md">
        <div className="mb-4 text-sm font-semibold">Sagacita Finance</div>
        {children}
      </div>
    </div>
  )
}
