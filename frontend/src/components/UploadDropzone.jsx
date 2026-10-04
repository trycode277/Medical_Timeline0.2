import { useRef, useState } from 'react'
import { AlertCircle, CheckCircle2, FileText, Loader2, UploadCloud, X } from 'lucide-react'
import { errorMessage } from '../lib/api'
import { useUploadRecords } from '../hooks/queries'

const ACCEPT = ['application/pdf', 'image/png', 'image/jpeg', 'image/tiff', 'image/webp']
const MAX_MB = 25
const MAX_FILES = 20
const size = (b) => (b > 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.ceil(b / 1e3)} KB`)

// File signatures (same checks the server makes) catch renamed or corrupted files before upload
const SIGNATURES = {
  'application/pdf': [[0x25, 0x50, 0x44, 0x46, 0x2d]],
  'image/png': [[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]],
  'image/jpeg': [[0xff, 0xd8, 0xff]],
  'image/tiff': [[0x49, 0x49, 0x2a, 0x00], [0x4d, 0x4d, 0x00, 0x2a]],
  'image/webp': [[0x52, 0x49, 0x46, 0x46]],
}
async function looksValid(file) {
  const head = new Uint8Array(await file.slice(0, 8).arrayBuffer())
  return SIGNATURES[file.type].some((sig) => sig.every((byte, i) => head[i] === byte))
}

export default function UploadDropzone({ patientId }) {
  const [files, setFiles] = useState([])
  const [rejected, setRejected] = useState([])
  const [dragging, setDragging] = useState(false)
  const [progress, setProgress] = useState(0)
  const inputRef = useRef(null)
  const upload = useUploadRecords()

  const addFiles = async (list) => {
    const ok = [], bad = []
    for (const f of Array.from(list)) {
      if (!ACCEPT.includes(f.type)) bad.push(`${f.name}: use PDF, PNG, JPG, TIFF or WebP`)
      else if (f.size === 0) bad.push(`${f.name}: the file is empty`)
      else if (f.size > MAX_MB * 1024 * 1024) bad.push(`${f.name}: larger than ${MAX_MB} MB`)
      else if (!(await looksValid(f))) bad.push(`${f.name}: the file looks corrupted or is not a real ${f.type.split('/')[1].toUpperCase()}`)
      else ok.push(f)
    }
    upload.reset()
    setFiles((prev) => [...prev, ...ok].slice(0, MAX_FILES))
    setRejected(bad)
  }

  const submit = () =>
    upload.mutate(
      { patientId, files, onProgress: setProgress },
      { onSuccess: () => { setFiles([]); setProgress(0) } },
    )

  return (
    <section>
      <div
        onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => { e.preventDefault(); setDragging(false); addFiles(e.dataTransfer.files) }}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && inputRef.current?.click()}
        role="button" tabIndex={0} aria-label="Choose or drop medical record files to upload"
        aria-describedby="upload-support"
        className={`cursor-pointer rounded-2xl border-2 border-dashed px-4 py-10 text-center transition-colors focus-visible:ring-4 focus-visible:ring-teal-100 sm:px-6 sm:py-12 ${
          dragging ? 'border-teal-500 bg-teal-50' : 'border-slate-300 bg-white hover:border-teal-400 hover:bg-teal-50/30'
        }`}
      >
        <span className="mx-auto mb-4 grid size-12 place-items-center rounded-2xl bg-teal-50 text-teal-700">
          <UploadCloud aria-hidden="true" className="size-6" />
        </span>
        <p className="font-serif text-xl font-medium text-slate-900">Upload medical records</p>
        <p className="mt-1 text-sm text-slate-600">Drop files here, or <span className="font-semibold text-teal-700">browse your device</span></p>
        <p id="upload-support" className="mt-3 text-xs leading-relaxed text-slate-500">PDF, PNG, JPG, TIFF or WebP · Up to {MAX_MB} MB per file · {MAX_FILES} files at a time</p>
        <input
          ref={inputRef} type="file" multiple hidden accept={ACCEPT.join(',')}
          onChange={(e) => { addFiles(e.target.files); e.target.value = '' }}
        />
      </div>

      {rejected.length > 0 && (
        <ul role="alert" className="mt-3 space-y-1 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          <li className="font-medium">These files were not added:</li>
          {rejected.map((r) => <li key={r} className="flex gap-1"><AlertCircle className="mt-0.5 size-4 shrink-0" />{r}</li>)}
        </ul>
      )}

      {upload.isSuccess && files.length === 0 && (
        <p role="status" className="mt-3 flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
          <CheckCircle2 className="size-4" />
          Uploaded {upload.data.length} {upload.data.length === 1 ? 'file' : 'files'}. Analysis has started; progress appears below.
        </p>
      )}

      {files.length > 0 && (
        <div className="mt-4">
          <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white shadow-sm">
            {files.map((f, i) => (
              <li key={`${f.name}-${i}`} className="flex items-center gap-3 px-3 py-2 text-sm">
                <FileText className="size-4 shrink-0 text-ink/60" />
                <span className="min-w-0 flex-1 truncate">{f.name}</span>
                <span className="text-ink/60">{size(f.size)}</span>
                <button
                  aria-label={`Remove ${f.name}`} disabled={upload.isPending}
                  onClick={() => setFiles((p) => p.filter((_, j) => j !== i))}
                  className="rounded-lg p-1.5 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900 disabled:opacity-40"
                ><X className="size-4" /></button>
              </li>
            ))}
          </ul>

          {upload.isPending && (
            <div className="mt-3 rounded-xl border border-slate-200 bg-white p-3" aria-live="polite">
              <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
                <div className="h-full bg-teal-600 transition-all" style={{ width: `${progress}%` }} />
              </div>
              <p className="mt-2 text-sm text-slate-600">
                {progress < 100 ? `Uploading… ${progress}%` : 'Saving files…'}
              </p>
            </div>
          )}

          {upload.isError && (
            <div role="alert" className="mt-3 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-900">
              <p className="flex items-center gap-2 font-medium"><AlertCircle className="size-4" /> Upload failed</p>
              <p className="mt-1">{errorMessage(upload.error)}</p>
              <p className="mt-1 text-red-800">Your files are still selected. Fix the problem or remove the file, then try again.</p>
            </div>
          )}

          <button
            onClick={submit} disabled={upload.isPending}
            className="mt-3 inline-flex min-h-10 items-center gap-2 rounded-lg bg-teal-700 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-teal-800 focus-visible:ring-4 focus-visible:ring-teal-100 disabled:opacity-60"
          >
            {upload.isPending && <Loader2 className="size-4 animate-spin motion-reduce:animate-none" />}
            {upload.isPending ? 'Uploading…' : upload.isError ? 'Retry upload' : `Upload ${files.length} ${files.length === 1 ? 'file' : 'files'}`}
          </button>
        </div>
      )}
    </section>
  )
}
