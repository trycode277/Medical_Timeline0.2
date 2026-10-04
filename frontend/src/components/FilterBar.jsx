import { Search, X } from 'lucide-react'
import { TYPES, TYPE_KEYS } from './eventMeta'

export const DEFAULT_FILTERS = { q: '', from: '', to: '', order: 'desc', enabled: [...TYPE_KEYS] }

export default function FilterBar({ value, onChange }) {
  const { q, from, to, order, enabled } = value
  const set = (patch) => onChange({ ...value, ...patch })
  const toggle = (k) => set({ enabled: enabled.includes(k) ? enabled.filter((x) => x !== k) : [...enabled, k] })
  const dirty = q || from || to || enabled.length !== TYPE_KEYS.length
  const field = 'min-h-10 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 transition-colors placeholder:text-slate-400 focus-visible:border-teal-500 focus-visible:ring-4 focus-visible:ring-teal-100'

  return (
    <div className="mb-6 space-y-4">
      <div className="flex flex-wrap gap-2" role="group" aria-label="Event categories">
        {TYPE_KEYS.map((k) => {
          const t = TYPES[k]
          const on = enabled.includes(k)
          const Icon = t.icon
          return (
            <button
              key={k} onClick={() => toggle(k)} aria-pressed={on}
              className={`flex min-h-9 items-center gap-1.5 rounded-full border px-3 py-1 text-sm transition-colors focus-visible:ring-4 focus-visible:ring-teal-100 ${
                on ? `${t.chip} font-medium` : 'border-slate-200 bg-white text-slate-500 hover:bg-slate-50'
              }`}
            >
              <Icon className="size-3.5" /> {t.plural}
            </button>
          )
        })}
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        <div className="relative min-w-0 flex-1 sm:min-w-48">
          <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-3 size-4 text-slate-400" />
          <input
            value={q} onChange={(e) => set({ q: e.target.value })} aria-label="Search events"
            placeholder="Search events by keyword" className={`${field} w-full pl-9 pr-9`}
          />
          {q && (
            <button aria-label="Clear search" onClick={() => set({ q: '' })} className="absolute right-1.5 top-1.5 rounded-md p-1 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900">
              <X className="size-4" />
            </button>
          )}
        </div>
        <input type="date" aria-label="From date" value={from} onChange={(e) => set({ from: e.target.value })} className={`${field} w-full sm:w-auto`} />
        <input type="date" aria-label="To date" value={to} onChange={(e) => set({ to: e.target.value })} className={`${field} w-full sm:w-auto`} />
        <select aria-label="Sort order" value={order} onChange={(e) => set({ order: e.target.value })} className={`${field} w-full sm:w-auto`}>
          <option value="desc">Newest first</option>
          <option value="asc">Oldest first</option>
        </select>
        {dirty && (
          <button onClick={() => onChange(DEFAULT_FILTERS)} className="min-h-10 rounded-lg px-2 text-left text-sm font-medium text-teal-800 underline underline-offset-2 transition-colors hover:bg-teal-50 focus-visible:ring-4 focus-visible:ring-teal-100">
            Clear filters
          </button>
        )}
      </div>
    </div>
  )
}
