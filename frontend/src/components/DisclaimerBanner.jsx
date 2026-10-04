import { ShieldAlert } from 'lucide-react'

// Permanent by design: no dismiss control, always rendered above everything else.
export default function DisclaimerBanner() {
  return (
    <div role="note" className="flex shrink-0 items-start gap-2.5 border-b border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium leading-relaxed text-amber-900 sm:px-6">
      <ShieldAlert aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-amber-700" />
      <p className="mx-auto w-full max-w-6xl">
        This tool organizes records for informational review only and does not provide medical diagnoses or treatment recommendations.
      </p>
    </div>
  )
}
