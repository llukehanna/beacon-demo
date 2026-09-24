/**
 * Drop-in replacements for the four OSDK React hooks the pages use, backed
 * by TanStack Query and the /api endpoints. Same names and the same return
 * fields, so page code only changes its import lines. Every successful
 * action invalidates all queries, matching OSDK's refresh-after-edit behavior.
 */
import React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ObjectOf, ObjectTypeName } from "../../shared/schema";
import { type ActionResponse, type ObjectQuery, fetchLinks, fetchObjects, postAction } from "./api";
import type { ActionToken, ObjectTypeToken } from "./ontology";
import { type WireObject, normalizeError, toLinkMap } from "./wire";

export interface ObjectsOptions extends ObjectQuery {
  /** Accepted for call-site compatibility; the API returns every matching row. */
  pageSize?: number;
  autoFetchMore?: boolean;
  enabled?: boolean;
}

export function useOsdkObjects<N extends ObjectTypeName>(
  type: ObjectTypeToken<N>,
  opts: ObjectsOptions = {},
) {
  const { where, orderBy } = opts;
  const q = useQuery({
    queryKey: ["objects", type.apiName, where ?? null, orderBy ?? null],
    queryFn: () => fetchObjects(type.apiName, { where, orderBy }) as Promise<ObjectOf<N>[]>,
    enabled: opts.enabled ?? true,
  });
  return {
    data: q.data,
    isLoading: q.isLoading,
    error: normalizeError(q.error),
    hasMore: false,
    fetchMore: undefined,
  };
}

export function useOsdkAction(action: ActionToken) {
  const qc = useQueryClient();
  const m = useMutation({
    mutationFn: (params: Record<string, unknown>) => postAction(action.apiName, params),
    // Returning the promise makes applyAction resolve only after the
    // refetch lands, so `.then(refresh)` callers see fresh data.
    onSuccess: () => qc.invalidateQueries(),
  });
  return {
    applyAction: (params: Record<string, unknown>): Promise<ActionResponse> =>
      m.mutateAsync(params),
    isPending: m.isPending,
    error: normalizeError(m.error),
  };
}

export function useLinks(
  source: WireObject | readonly WireObject[] | null | undefined,
  linkName: string,
  _opts?: { pageSize?: number; $select?: unknown },
) {
  const sources: readonly WireObject[] =
    source == null ? [] : Array.isArray(source) ? source : [source as WireObject];
  const type = sources[0]?.$apiName;
  const pks = sources.map((s) => s.$primaryKey);
  const q = useQuery({
    queryKey: ["links", type ?? null, linkName, pks],
    queryFn: () => fetchLinks(type as string, linkName, pks),
    enabled: type !== undefined && pks.length > 0,
  });
  const linkedObjectsBySourcePrimaryKey = React.useMemo(() => toLinkMap(q.data), [q.data]);
  return {
    linkedObjectsBySourcePrimaryKey,
    hasMore: false,
    isLoading: q.isLoading,
    error: normalizeError(q.error),
  };
}

export function useObservableClient() {
  const qc = useQueryClient();
  return React.useMemo(
    () => ({
      invalidateObjects: (_obj?: unknown) => qc.invalidateQueries({ queryKey: ["objects"] }),
    }),
    [qc],
  );
}
