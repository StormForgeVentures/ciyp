/**
 * TanStack Query hooks over the admin API. Query keys include the acting tenant so switching
 * tenants (superadmin) refetches the right scope.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  apiGet,
  apiSend,
  getActingTenant,
  type Dashboard,
  type Me,
  type TeamRow,
  type TenantRow,
} from './api.js';

export function useMe() {
  return useQuery({ queryKey: ['me', getActingTenant()], queryFn: () => apiGet<Me>('/admin/me') });
}

export function useDashboard(enabled = true) {
  return useQuery({
    queryKey: ['dashboard', getActingTenant()],
    queryFn: () => apiGet<Dashboard>('/admin/dashboard'),
    enabled,
  });
}

export function useTenants(enabled: boolean) {
  return useQuery({
    queryKey: ['tenants'],
    queryFn: () => apiGet<{ tenants: TenantRow[] }>('/admin/tenants'),
    enabled,
  });
}

export function useTeam(enabled: boolean) {
  return useQuery({
    queryKey: ['team', getActingTenant()],
    queryFn: () => apiGet<{ team: TeamRow[] }>('/admin/team'),
    enabled,
  });
}

export function useCreateTenant() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { slug: string; displayName: string }) =>
      apiSend<{ tenant: TenantRow }>('POST', '/admin/tenants', v),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tenants'] }),
  });
}

export function useSetTenantStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: string; status: 'active' | 'paused' }) =>
      apiSend('PATCH', `/admin/tenants/${v.id}/status`, { status: v.status }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tenants'] }),
  });
}

export function useAddTeamMember() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { email: string; displayName: string }) =>
      apiSend<{ member: TeamRow }>('POST', '/admin/team', v),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['team'] }),
  });
}
