import axios from 'axios'

export const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL ?? '/api',
  timeout: 30_000,
  paramsSerializer: { indexes: null }, // event_type=a&event_type=b (FastAPI list format)
})

/** Human-readable message from a FastAPI/axios error (timeouts, size limits, gateway errors included). */
export function errorMessage(err) {
  const status = err?.response?.status
  const detail = err?.response?.data?.detail
  if (typeof detail === 'string') return detail
  if (Array.isArray(detail)) return detail.map((d) => d.msg).join('; ')
  if (err?.code === 'ECONNABORTED' || err?.code === 'ETIMEDOUT') return 'The request took too long. Please try again in a moment.'
  if (err?.code === 'ERR_NETWORK') return 'Cannot reach the server. Check your connection and that the backend is running.'
  if (status === 413) return 'That upload is too large. Try fewer or smaller files.'
  if (status === 502 || status === 503 || status === 504) return 'The server is busy or temporarily unavailable. Please try again shortly.'
  if (status >= 500) return 'The server ran into a problem. Please try again.'
  return err?.message ?? 'Something went wrong.'
}

export const getPatients = () => api.get('/patients').then((r) => r.data)
export const createPatient = (body) => api.post('/patients', body).then((r) => r.data)

/** POST /records/upload -> 202 with one record per file (processing continues server-side). */
export function uploadRecords({ patientId, files, onProgress }) {
  const form = new FormData()
  form.append('patient_id', patientId)
  files.forEach((f) => form.append('files', f))
  return api
    .post('/records/upload', form, {
      timeout: 0, // large files on slow links
      onUploadProgress: (e) => e.total && onProgress?.(Math.round((e.loaded * 100) / e.total)),
    })
    .then((r) => r.data)
}

export const getRecords = (patientId) =>
  api.get('/records', { params: { patient_id: patientId, limit: 50 } }).then((r) => r.data)

/** GET /events -> { items, total, limit, offset } */
export const getEvents = (params) => api.get('/events', { params }).then((r) => r.data)

/** GET /patients/:id/summary -> { overview, key_points, category_counts, event_count, ... } */
export const getSummary = (patientId, params) =>
  api.get(`/patients/${patientId}/summary`, { params, timeout: 90_000 }).then((r) => r.data)

/** PATCH /events/:id (partial update) and DELETE /events/:id */
export const updateEvent = (id, patch) => api.patch(`/events/${id}`, patch).then((r) => r.data)
export const deleteEvent = (id) => api.delete(`/events/${id}`)
