import { ClipboardList, FlaskConical, Pill, Stethoscope, Syringe } from 'lucide-react'

// Visits blue, tests green, diagnoses red, treatments purple, medications orange
export const TYPES = {
  visit: { label: 'Visit', plural: 'Visits', icon: Stethoscope, dot: 'bg-blue-600', chip: 'border-blue-200 bg-blue-50 text-blue-800' },
  test: { label: 'Test', plural: 'Tests', icon: FlaskConical, dot: 'bg-green-600', chip: 'border-green-200 bg-green-50 text-green-800' },
  diagnosis: { label: 'Diagnosis', plural: 'Diagnoses', icon: ClipboardList, dot: 'bg-rose-600', chip: 'border-rose-200 bg-rose-50 text-rose-800' },
  treatment: { label: 'Treatment', plural: 'Treatments', icon: Syringe, dot: 'bg-purple-600', chip: 'border-purple-200 bg-purple-50 text-purple-800' },
  medication: { label: 'Medication', plural: 'Medications', icon: Pill, dot: 'bg-orange-500', chip: 'border-orange-200 bg-orange-50 text-orange-800' },
}
export const TYPE_KEYS = Object.keys(TYPES)

export const fmtDate = (iso) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })

export const fmtMonth = (key) =>
  new Date(`${key}-01T00:00:00`).toLocaleDateString(undefined, { year: 'numeric', month: 'long' })
