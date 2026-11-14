import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../../services/api';

export function useHealth() {
  return useQuery({
    queryKey: ['health'],
    queryFn: ({ signal }) => apiFetch('/health', { signal }),
    retry: false,
    refetchInterval: 30_000,
  });
}
