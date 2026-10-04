import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { errorMessage } from '../lib/api'
import { useUpdateEvent } from '../hooks/queries'
import { TYPES, TYPE_KEYS } from './eventMeta'

/** Inline form for correcting an AI-extracted event (category, date, text, provider). */
export default function EventEditor({ ev, patientId, onDone }) {
  const [form, setForm] = useState({
    event_type: ev.event_type, event_date: ev.event_date, title: ev.title ?? '',
    description: ev.description, provider: ev.provider ?? '',
  })
  const update = useUpdateEvent(patientId)
  const set = (patch) => setForm((f) => ({ ...f, ...patch }))
  const field = 'w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400 focus-visible:border-teal-500 focus-visible:ring-4 focus-visible:ring-teal-100'

  const submit = (e) => {
    e.preventDefault()
    const next = {
      event_type: form.event_type, event_date: form.event_date,
      title: form.title.trim() || null, description: form.description.trim(),
      provider: form.provider.trim() || null,
    }
    // send only what changed
    const patch = Object.fromEntries(Object.entries(next).filter(([k, v]) => v !== (ev[k] ?? null)))
    if (Object.keys(patch).length === 0) return onDone()
    update.mutate({ id: ev.id, patch }, { onSuccess: onDone })
  }

  return (
    <form onSubmit={submit} className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-3 sm:p-4" aria-label="Edit event">
      <div role="radiogroup" aria-label="Category" className="flex flex-wrap gap-1.5">
        {TYPE_KEYS.map((k) => (
          <button
            type="button" key={k} role="radio" aria-checked={form.event_type === k}
            onClick={() => set({ event_type: k })}
            className={`min-h-9 rounded-full border px-3 py-1 text-sm transition-colors focus-visible:ring-4 focus-visible:ring-teal-100 ${
              form.event_type === k ? `${TYPES[k].chip} font-medium` : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'
            }`}
          >{TYPES[k].label}</button>
        ))}
      </div>
      <input type="date" required aria-label="Date" value={form.event_date} onChange={(e) => set({ event_date: e.target.value })} className={field} />
      <input aria-label="Title" maxLength={255} placeholder="Title" value={form.title} onChange={(e) => set({ title: e.target.value })} className={field} />
      <textarea required aria-label="Description" rows={3} placeholder="Description" value={form.description} onChange={(e) => set({ description: e.target.value })} className={field} />
      <input aria-label="Provider" maxLength={255} placeholder="Provider (optional)" value={form.provider} onChange={(e) => set({ provider: e.target.value })} className={field} />
      {update.isError && <p role="alert" className="text-sm text-red-700">{errorMessage(update.error)}</p>}
      <div className="flex gap-2">
        <button disabled={update.isPending} className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-teal-700 px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-teal-800 disabled:opacity-60">
          {update.isPending && <Loader2 className="size-4 animate-spin motion-reduce:animate-none" />} Save
        </button>
        <button type="button" onClick={onDone} disabled={update.isPending} className="min-h-10 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-100 disabled:opacity-60">
          Cancel
        </button>
      </div>
    </form>
  )
}
