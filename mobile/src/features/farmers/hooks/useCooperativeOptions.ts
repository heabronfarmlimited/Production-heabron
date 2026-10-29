/**
 * Cooperative picker options for the Add Farmer screen.
 *
 * `AddFarmerView` read its cooperative id from route arguments with a
 * force-cast (`ModalRoute.of(context)!.settings.arguments! as String`), so
 * reaching the screen from anywhere except a cooperative's details page threw.
 * `cooperativeId: uuid.required()` is non-negotiable server-side, so the screen
 * offers a picker when no id was passed in.
 *
 * NOTE — only `{ id, name }` is read, so this does not depend on the
 * cooperatives module's model; modules stay independent.
 */
import { useQuery } from '@tanstack/react-query';

import { api } from '../../../core/api/client';
import { LIMITS, type Option } from '../../../core/api/domainConstants';
import { endpoints } from '../../../core/api/endpoints';
import { qk } from '../../../core/api/queryClient';
import { obj, str } from '../model/primitives';

/** Fetches up to one page of cooperatives as `{ label: name, value: id }`. */
async function fetchCooperativeOptions(): Promise<Option[]> {
  const page = await api.getPaginated<unknown>(endpoints.cooperatives, {
    page: 1,
    pageSize: LIMITS.pageSize.max,
  });

  return page.items
    .map((raw) => {
      const c = obj(raw);
      return { label: str(c.name), value: str(c.id) };
    })
    .filter((option) => option.value.length > 0)
    .map((option) => ({
      // A cooperative with no name would otherwise render as a blank row.
      label: option.label.length > 0 ? option.label : option.value,
      value: option.value,
    }));
}

export function useCooperativeOptions(enabled = true) {
  const query = useQuery<Option[]>({
    queryKey: [...qk.cooperatives({ picker: true })],
    queryFn: fetchCooperativeOptions,
    enabled,
    // The list changes rarely and this is only a picker.
    staleTime: 5 * 60_000,
  });

  return {
    options: query.data ?? [],
    isLoading: query.isLoading,
    error: query.error,
  };
}
