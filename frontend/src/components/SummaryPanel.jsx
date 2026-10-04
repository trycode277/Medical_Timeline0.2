import { AlertCircle, Loader2, Sparkles } from 'lucide-react'
import { errorMessage } from '../lib/api'
import { useSummary } from '../hooks/queries'
import { TYPES, fmtDate } from './eventMeta'

export default function SummaryPanel({ patientId, from, to, disabled, onJump }) {
  const s = useSummary(patientId, { from, to }, !disabled)
  const d = s.data
  const range = from || to
    ? `${from ? fmtDate(from) : 'Earliest record'} to ${to ? fmtDate(to) : 'latest record'}`
    : 'All dates'

  return (
    <section aria-labelledby="summary-title" className="mb-6 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:mb-8 sm:p-6">
      <div className="flex items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-teal-50 text-teal-700">
          <Sparkles aria-hidden="true" className="size-5" />
        </span>
        <div>
          <h2 id="summary-title" className="font-serif text-xl font-medium text-slate-900">Summary of records</h2>
          <p className="text-sm text-slate-500">{range}</p>
        </div>
      </div>

      <div className="mt-3" aria-live="polite" aria-busy={s.isFetching}>
        {disabled ? (
          <p className="text-sm text-ink/70">Fix the date range to see a summary.</p>
        ) : s.isLoading ? (
          <div>
            <p className="mb-3 flex items-center gap-2 text-sm text-brand">
              <Loader2 className="size-4 animate-spin motion-reduce:animate-none" /> Generating summary…
            </p>
            {[100, 92, 60].map((w) => (
              <div key={w} style={{ width: `${w}%` }} className="mb-2 h-3 animate-pulse rounded bg-line/70 motion-reduce:animate-none" />
            ))}
          </div>
        ) : s.isError ? (
          <div role="alert" className="text-sm text-red-700">
            <p className="flex items-start gap-2"><AlertCircle className="mt-0.5 size-4 shrink-0" />{errorMessage(s.error)}</p>
            <button onClick={() => s.refetch()} className="mt-2 text-brand underline underline-offset-2">Try again</button>
          </div>
        ) : d ? (
          <>
            <p className="mt-4 max-w-prose leading-7 text-slate-700">{d.overview}</p>
            {d.key_points.length > 0 && (
              <ul className="mt-3 space-y-2">
                {d.key_points.map((p) => (
                  <li key={p.text} className="flex gap-2 text-sm leading-relaxed text-slate-700">
                    <span className="mt-2 size-1.5 shrink-0 rounded-full bg-teal-600" />
                    <span>
                      {p.text}{' '}
                      <button onClick={() => onJump(p.event_ids)} className="text-brand underline underline-offset-2">
                        Show in timeline
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {d.event_count > 0 && (
              <>
                <div className="mt-4 flex flex-wrap gap-2" aria-label="Event counts by category">
                  {Object.entries(d.category_counts).map(([k, n]) => TYPES[k] && (
                    <span key={k} className={`rounded-full border px-3 py-1 text-xs font-medium ${TYPES[k].chip}`}>
                      {n} {(n === 1 ? TYPES[k].label : TYPES[k].plural).toLowerCase()}
                    </span>
                  ))}
                </div>
                <p className="mt-3 text-xs text-ink/60">
                  Generated automatically from {d.summarized_count} of {d.event_count} recorded events
                  {d.truncated ? ' (most recent shown)' : ''}. It restates the records and may contain errors; check the source documents.
                </p>
              </>
            )}
          </>
        ) : null}
      </div>
    </section>
  )
}
