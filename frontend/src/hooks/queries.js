import { useEffect, useRef } from 'react'
import {
  keepPreviousData, useInfiniteQuery, useMutation, useQuery, useQueryClient,
} from '@tanstack/react-query'
import * as api from '../lib/api'

export const isActive = (r) => r.status === 'pending' || r.status === 'processing'
const PAGE_SIZE = 25

export const usePatients = () => useQuery({ queryKey: ['patients'], queryFn: api.getPatients })

export function useCreatePatient() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: api.createPatient,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['patients'] }),
  })
}

/**
 * Records for a patient. Polls every 2.5s only while something is pending/processing,
 * and refreshes the timeline when a document finishes, so new events appear on their own.
 */
export function useRecords(patientId) {
  const qc = useQueryClient()
  const query = useQuery({
    queryKey: ['records', patientId],
    queryFn: () => api.getRecords(patientId),
    enabled: !!patientId,
    refetchInterval: (q) => (q.state.data?.some(isActive) ? 2500 : false),
  })

  const active = query.data?.filter(isActive).length ?? 0
  const prev = useRef(0)
  useEffect(() => {
    if (prev.current > active) {
      qc.invalidateQueries({ queryKey: ['events', patientId] })
      qc.invalidateQueries({ queryKey: ['summary', patientId] })
    }
    prev.current = active
  }, [active, patientId, qc])

  return query
}

export function useUploadRecords() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: api.uploadRecords,
    onSuccess: (_, { patientId }) => qc.invalidateQueries({ queryKey: ['records', patientId] }),
  })
}

export const useEvents = (patientId, filters, enabled = true) =>
  useInfiniteQuery({
    queryKey: ['events', patientId, filters],
    enabled: !!patientId && enabled,
    initialPageParam: 0,
    queryFn: ({ pageParam }) =>
      api.getEvents({ patient_id: patientId, ...filters, limit: PAGE_SIZE, offset: pageParam }),
    getNextPageParam: (last) =>
      last.offset + last.items.length < last.total ? last.offset + PAGE_SIZE : undefined,
    placeholderData: keepPreviousData, // no flicker while filters change
  })

/** AI summary for the selected date range. Cached client- and server-side; no retries (LLM call). */
export const useSummary = (patientId, { from, to }, enabled = true) =>
  useQuery({
    queryKey: ['summary', patientId, from, to],
    enabled: !!patientId && enabled,
    staleTime: 10 * 60_000,
    retry: false,
    queryFn: () => api.getSummary(patientId, { date_from: from || undefined, date_to: to || undefined }),
  })

function useEventMutation(patientId, mutationFn) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['events', patientId] })
      qc.invalidateQueries({ queryKey: ['summary', patientId] }) // summary reflects the correction
    },
  })
}

export const useUpdateEvent = (patientId) => useEventMutation(patientId, ({ id, patch }) => api.updateEvent(id, patch))
export const useDeleteEvent = (patientId) => useEventMutation(patientId, (id) => api.deleteEvent(id))
