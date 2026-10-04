import { useState } from 'react'
import { Activity, History, Loader2, UploadCloud, UserPlus } from 'lucide-react'
import { errorMessage } from '../lib/api'
import { useCreatePatient } from '../hooks/queries'

function NewPatientForm({ onCreated }) {
  const [first, setFirst] = useState('')
  const [last, setLast] = useState('')
  const create = useCreatePatient()
  const input = 'w-full rounded-lg border border-white/15 bg-slate-800 px-3 py-2 text-sm text-white placeholder:text-slate-400 focus-visible:outline-white'

  const submit = (e) => {
    e.preventDefault()
    create.mutate(
      { first_name: first.trim(), last_name: last.trim() },
      { onSuccess: (p) => { setFirst(''); setLast(''); onCreated(p.id) } },
    )
  }
  return (
    <form onSubmit={submit} className="mt-3 space-y-2.5 rounded-xl border border-white/10 bg-white/5 p-3">
      <input required aria-label="Patient first name" className={input} placeholder="First name" value={first} onChange={(e) => setFirst(e.target.value)} />
      <input required aria-label="Patient last name" className={input} placeholder="Last name" value={last} onChange={(e) => setLast(e.target.value)} />
      {create.isError && <p className="text-xs text-red-300">{errorMessage(create.error)}</p>}
      <button disabled={create.isPending} className="w-full rounded-lg bg-teal-600 px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-teal-500 focus-visible:outline-white disabled:opacity-60">
        {create.isPending ? 'Adding…' : 'Add patient'}
      </button>
    </form>
  )
}

export default function Sidebar({ view, setView, patients, patientId, onSelectPatient, activeCount }) {
  const [adding, setAdding] = useState(false)
  const nav = [
    { id: 'timeline', label: 'Timeline', icon: History },
    { id: 'upload', label: 'Upload records', icon: UploadCloud },
  ]
  return (
    <aside className="flex flex-col gap-4 border-b border-slate-700 bg-slate-900 p-4 text-white sm:p-5 md:h-full md:w-64 md:shrink-0 md:gap-6 md:overflow-y-auto md:border-b-0 md:border-r md:border-slate-800">
      <div className="flex items-center gap-2.5 font-serif text-lg sm:text-xl">
        <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-teal-500/15">
          <Activity aria-hidden="true" className="size-5 text-teal-300" />
        </span>
        <span>Medical Timeline</span>
      </div>

      <div className="min-w-0">
        <label htmlFor="patient" className="text-xs font-semibold uppercase tracking-wider text-slate-300">Patient</label>
        <select
          id="patient" value={patientId} onChange={(e) => onSelectPatient(e.target.value)}
          className="mt-2 w-full rounded-lg border border-white/15 bg-slate-800 px-3 py-2.5 text-sm text-white focus-visible:outline-white"
        >
          {patients.length === 0 && <option value="">No patients yet</option>}
          {patients.map((p) => (
            <option key={p.id} value={p.id} className="text-ink">{p.last_name}, {p.first_name}</option>
          ))}
        </select>
        <button type="button" onClick={() => setAdding((v) => !v)} aria-expanded={adding} className="mt-2.5 inline-flex min-h-9 items-center gap-2 rounded-lg px-2.5 text-sm font-medium text-teal-300 transition-colors hover:bg-white/10 hover:text-teal-200">
          <UserPlus aria-hidden="true" className="size-4" /> {adding ? 'Cancel' : 'New patient'}
        </button>
        {adding && <NewPatientForm onCreated={(id) => { onSelectPatient(id); setAdding(false) }} />}
      </div>

      <nav aria-label="Main navigation" className="flex gap-1.5 md:flex-col">
        {nav.map(({ id, label, icon: Icon }) => (
          <button
            key={id} onClick={() => setView(id)} aria-current={view === id ? 'page' : undefined}
            className={`flex min-w-0 flex-1 items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-sm transition-colors md:flex-none ${
              view === id ? 'bg-teal-500/15 font-semibold text-teal-100 ring-1 ring-inset ring-teal-400/20' : 'text-slate-300 hover:bg-white/10 hover:text-white'
            }`}
          >
            <Icon aria-hidden="true" className="size-4 shrink-0" /> <span className="truncate">{label}</span>
            {id === 'upload' && activeCount > 0 && (
              <span className="ml-auto flex shrink-0 items-center gap-1 rounded-full bg-teal-300/15 px-2 py-0.5 text-xs font-medium text-teal-200">
                <Loader2 aria-hidden="true" className="size-3 animate-spin motion-reduce:animate-none" /> {activeCount}
              </span>
            )}
          </button>
        ))}
      </nav>
    </aside>
  )
}
