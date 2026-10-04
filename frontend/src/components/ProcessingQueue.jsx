import { AlertCircle, CheckCircle2, Clock, FileText, Loader2 } from 'lucide-react'
import { describeFailure } from '../lib/errors'
import { isActive } from '../hooks/queries'

const STATUS = {
  pending: { icon: Clock, text: 'Waiting in queue', tone: 'border-slate-200 bg-slate-50 text-slate-700', iconTone: 'text-slate-500' },
  processing: { icon: Loader2, text: 'Reading pages and organizing events…', tone: 'border-teal-200 bg-teal-50 text-teal-800', iconTone: 'text-teal-700', spin: true },
  completed: { icon: CheckCircle2, text: 'Added to timeline', tone: 'border-green-200 bg-green-50 text-green-800', iconTone: 'text-green-700' },
  failed: { icon: AlertCircle, text: 'Could not process', tone: 'border-red-200 bg-red-50 text-red-800', iconTone: 'text-red-700' },
}

export default function ProcessingQueue({ records, isLoading }) {
  if (isLoading) return <div className="h-24 animate-pulse rounded-xl bg-slate-200/70 motion-reduce:animate-none" />
  if (!records?.length) return null
  const active = records.some(isActive)

  return (
    <section>
      <h2 className="font-serif text-xl font-medium text-slate-900">Documents</h2>
      {active && (
        <p className="mb-3 mt-1 text-sm leading-relaxed text-slate-600" aria-live="polite">
          Reading scans and analyzing text can take a minute or more per document. You can leave this page; new events will appear in the timeline.
        </p>
      )}
      <ul className="mt-3 space-y-3">
        {records.map((r) => {
          const s = STATUS[r.status]
          const Icon = s.icon
          return (
            <li key={r.id} className={`rounded-xl border p-3 shadow-sm sm:px-4 ${s.tone}`}>
              <div className="flex min-w-0 flex-wrap items-center gap-2.5 text-sm">
                <FileText aria-hidden="true" className={`size-4 shrink-0 ${s.iconTone}`} />
                <span className="min-w-0 flex-1 truncate">{r.original_filename}</span>
                <span role="status" className={`flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold ${s.tone}`}>
                  <Icon aria-hidden="true" className={`size-3.5 ${s.spin ? 'animate-spin motion-reduce:animate-none' : ''}`} /> {s.text}
                </span>
              </div>
              {r.status === 'processing' && (
                <div className="mt-3 h-1 overflow-hidden rounded-full bg-teal-100">
                  <div className="h-full w-1/3 animate-pulse bg-teal-600 motion-reduce:animate-none" />
                </div>
              )}
              {r.status === 'failed' && <FailureNote message={r.error_message} />}
            </li>
          )
        })}
      </ul>
    </section>
  )
}

function FailureNote({ message }) {
  const { title, hint } = describeFailure(message)
  return (
    <div role="alert" className="mt-3 rounded-lg border border-red-200 bg-white/70 p-3 text-sm text-red-800">
      <p className="font-medium">{title}</p>
      <p>{hint}</p>
    </div>
  )
}
