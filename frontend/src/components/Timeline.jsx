import { useEffect, useState } from 'react'
import { AlertCircle, Building2, CalendarDays, Loader2, Pencil, Trash2 } from 'lucide-react'
import { errorMessage } from '../lib/api'
import { useDeleteEvent, useEvents } from '../hooks/queries'
import EventEditor from './EventEditor'
import FilterBar, { DEFAULT_FILTERS } from './FilterBar'
import SummaryPanel from './SummaryPanel'
import { TYPES, TYPE_KEYS, fmtDate, fmtMonth } from './eventMeta'

function useDebounced(value, ms = 350) {
  const [v, setV] = useState(value)
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t) }, [value, ms])
  return v
}

/** Items arrive already sorted by the API; keep that order and split into month groups. */
function groupByMonth(items) {
  const groups = []
  for (const ev of items) {
    const key = ev.event_date.slice(0, 7)
    const last = groups[groups.length - 1]
    if (last?.key === key) last.items.push(ev)
    else groups.push({ key, items: [ev] })
  }
  return groups
}

function EventRow({ ev, patientId, flashing }) {
  const [mode, setMode] = useState('view') // view | edit | delete
  const del = useDeleteEvent(patientId)
  const t = TYPES[ev.event_type]
  const Icon = t.icon
  const iconBtn = 'rounded-lg p-2 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900 focus-visible:ring-4 focus-visible:ring-teal-100'
  return (
    <li id={`event-${ev.id}`} className="relative pb-5 pl-7 sm:pl-9">
      <span className={`absolute -left-3 top-5 grid size-6 place-items-center rounded-full text-white ring-4 ring-slate-50 ${t.dot}`}>
        <Icon aria-hidden="true" className="size-3.5" />
      </span>
      <div className={`rounded-xl border border-slate-200 bg-white p-3 shadow-sm transition-colors hover:border-slate-300 hover:shadow-md sm:p-4 ${flashing ? 'bg-amber-50 ring-2 ring-amber-200' : ''}`}>
        {mode === 'edit' ? (
          <EventEditor ev={ev} patientId={patientId} onDone={() => setMode('view')} />
        ) : (
          <>
            <div className="flex flex-wrap items-start gap-2">
              <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                <time className="text-sm font-semibold tabular-nums text-slate-700">{fmtDate(ev.event_date)}</time>
                <span className={`rounded-full border px-2.5 py-1 text-xs font-medium ${t.chip}`}>{t.label}</span>
              </div>
              <span className="ml-auto flex shrink-0 gap-1">
                <button aria-label={`Edit ${ev.title ?? t.label}`} title="Edit event" onClick={() => setMode('edit')} className={iconBtn}>
                  <Pencil aria-hidden="true" className="size-4" />
                </button>
                <button aria-label={`Delete ${ev.title ?? t.label}`} title="Delete event" onClick={() => setMode('delete')} className={iconBtn}>
                  <Trash2 aria-hidden="true" className="size-4" />
                </button>
              </span>
            </div>
            <h3 className="mt-1 font-serif text-lg font-medium leading-snug text-slate-900">{ev.title ?? t.label}</h3>
            <p className="mt-1 max-w-prose text-sm leading-relaxed text-slate-700">{ev.description}</p>
            {(ev.provider || ev.source_page) && (
              <p className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
                {ev.provider && <span className="flex items-center gap-1"><Building2 aria-hidden="true" className="size-3.5" />{ev.provider}</span>}
                {ev.source_page && <span>Page {ev.source_page} of source</span>}
              </p>
            )}
            {mode === 'delete' && (
              <div role="alert" className="mt-3 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-900">
                <p>Delete this event? This can’t be undone.</p>
                {del.isError && <p className="mt-1">{errorMessage(del.error)}</p>}
                <div className="mt-2 flex gap-2">
                  <button
                    onClick={() => del.mutate(ev.id)} disabled={del.isPending}
                    className="inline-flex min-h-9 items-center gap-1 rounded-lg bg-red-700 px-3 py-1.5 font-medium text-white transition-colors hover:bg-red-800 disabled:opacity-60"
                  >
                    {del.isPending && <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" />} Delete
                  </button>
                  <button onClick={() => { del.reset(); setMode('view') }} className="min-h-9 rounded-lg border border-red-300 bg-white px-3 py-1.5 font-medium transition-colors hover:bg-red-100">
                    Keep
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </li>
  )
}

export default function Timeline({ patientId, activeCount }) {
  const [filters, setFilters] = useState(DEFAULT_FILTERS)
  const [flash, setFlash] = useState([])
  useEffect(() => setFilters(DEFAULT_FILTERS), [patientId])

  const dq = useDebounced(filters.q.trim())
  const noneOn = filters.enabled.length === 0
  const badRange = !!(filters.from && filters.to && filters.from > filters.to)
  const events = useEvents(
    patientId,
    {
      event_type: filters.enabled.length === TYPE_KEYS.length ? undefined : filters.enabled,
      q: dq.length >= 2 ? dq : undefined, // backend requires 2+ characters
      date_from: filters.from || undefined,
      date_to: filters.to || undefined,
      order: filters.order,
    },
    !noneOn && !badRange,
  )

  const items = events.data?.pages.flatMap((p) => p.items) ?? []
  const total = events.data?.pages[0]?.total ?? 0
  const filtered = !!(dq || filters.from || filters.to || filters.enabled.length !== TYPE_KEYS.length)

  const jumpTo = (ids) => {
    setFlash(ids)
    document.getElementById(`event-${ids.find((id) => document.getElementById(`event-${id}`))}`)
      ?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    setTimeout(() => setFlash([]), 2500)
  }

  let body
  if (noneOn) body = <Empty title="All categories are off" text="Turn on at least one category to see events." />
  else if (badRange) body = <Empty title="Check the date range" text="The start date is after the end date." />
  else if (events.isLoading) {
    body = (
      <div className="space-y-6">
        {[0, 1, 2, 3].map((i) => <div key={i} className="h-20 animate-pulse rounded-xl bg-slate-200/70 motion-reduce:animate-none" />)}
      </div>
    )
  } else if (events.isError) {
    body = <p role="alert" className="flex items-center gap-2 text-sm text-red-700"><AlertCircle className="size-4" />{errorMessage(events.error)}</p>
  } else if (items.length === 0) {
    body = <Empty title="No events found" text={filtered ? 'Try removing a filter.' : 'Upload records to build this patient’s timeline.'} />
  } else {
    body = (
      <>
        <p className="mb-3 text-sm text-slate-500" aria-live="polite">
          Showing {items.length} of {total} {total === 1 ? 'event' : 'events'}
        </p>
        <div className={events.isPlaceholderData ? 'opacity-60' : ''}>
          {groupByMonth(items).map((g) => (
            <section key={g.key} aria-label={fmtMonth(g.key)}>
              <h2 className="sticky top-0 z-10 bg-slate-50/95 py-3 font-serif text-lg font-medium text-slate-900 backdrop-blur sm:text-xl">
                {fmtMonth(g.key)}
                <span className="ml-2 font-sans text-sm font-normal text-slate-500">
                  {g.items.length} {g.items.length === 1 ? 'event' : 'events'}
                </span>
              </h2>
              <ol className="ml-3 mt-1 border-l-2 border-slate-200">
                {g.items.map((ev) => <EventRow key={ev.id} ev={ev} patientId={patientId} flashing={flash.includes(ev.id)} />)}
              </ol>
            </section>
          ))}
        </div>
        {events.hasNextPage && (
          <button
            onClick={() => events.fetchNextPage()} disabled={events.isFetchingNextPage}
            className="mt-4 inline-flex min-h-10 items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm transition-colors hover:border-teal-300 hover:text-teal-800 disabled:opacity-60"
          >
            {events.isFetchingNextPage && <Loader2 className="size-4 animate-spin motion-reduce:animate-none" />}
            Load more
          </button>
        )}
      </>
    )
  }

  return (
    <div>
      {activeCount > 0 && (
        <p className="mb-5 flex items-center gap-2 rounded-xl border border-teal-200 bg-teal-50 px-4 py-3 text-sm text-teal-900" aria-live="polite">
          <Loader2 className="size-4 animate-spin motion-reduce:animate-none" />
          {activeCount} {activeCount === 1 ? 'document is' : 'documents are'} still being analyzed. New events will appear here.
        </p>
      )}
      <SummaryPanel patientId={patientId} from={filters.from} to={filters.to} disabled={badRange} onJump={jumpTo} />
      <FilterBar value={filters} onChange={setFilters} />
      {body}
    </div>
  )
}

function Empty({ title, text }) {
  return (
    <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-4 py-12 text-center shadow-sm sm:py-16">
      <span className="mx-auto mb-4 grid size-12 place-items-center rounded-2xl bg-slate-100 text-slate-600">
        <CalendarDays aria-hidden="true" className="size-6" />
      </span>
      <h2 className="font-serif text-xl font-medium text-slate-900">{title}</h2>
      <p className="mx-auto mt-1 max-w-md text-sm leading-relaxed text-slate-600">{text}</p>
    </div>
  )
}
