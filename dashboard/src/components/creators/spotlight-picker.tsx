"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, ErrorNote, Spinner } from "@/components/ui/card";
import { api, unwrap } from "@/lib/api/client";

/** Choose the creator trip in the spotlight on the public Creator trips page. The trip's creator
 *  is shown with it. With nothing chosen the page falls back to the creator with the most trips. */
export function SpotlightPicker() {
  const queryClient = useQueryClient();
  const state = useQuery({
    queryKey: ["spotlight"],
    queryFn: async () => unwrap(await api.GET("/spotlight")),
  });
  const choose = useMutation({
    mutationFn: async ({ id, on }: { id: string; on: boolean }) =>
      unwrap(await api.PUT("/spotlight/trips/{trip_id}", { params: { path: { trip_id: id } }, body: { on } })),
    onSuccess: (data) => queryClient.setQueryData(["spotlight"], data),
  });

  const data = state.data;
  const chosen = data?.trips.find((t) => t.spotlight);

  return (
    <Card className="mb-5">
      <CardHeader
        title="Creator in the spotlight"
        description="The creator trip featured at the top of the public Creator trips page. Its creator is shown with it."
      />
      {state.isLoading ? (
        <Spinner />
      ) : state.error || !data ? (
        <div className="p-4">
          <ErrorNote error={state.error ?? "Couldn't load the spotlight."} />
        </div>
      ) : data.trips.length === 0 ? (
        <p className="m-0 px-5 py-4 text-sm text-muted">
          No creator trip is published yet. Once an approved creator with a handle publishes a trip, it can be featured here.
        </p>
      ) : (
        <>
          <p className="m-0 border-b border-border px-5 py-3 text-sm text-muted" aria-live="polite">
            {chosen ? (
              <>
                <strong className="text-text">Featured now:</strong> {chosen.title} by {chosen.creator_name}.
              </>
            ) : (
              <>
                <strong className="text-text">Nothing chosen.</strong> The page shows {data.automatic_creator ?? "no one"} for now, the
                creator with the most published trips.
              </>
            )}
          </p>
          {choose.error && (
            <div className="px-5 pt-3">
              <ErrorNote error={choose.error} />
            </div>
          )}
          <ul className="m-0 max-h-[340px] list-none divide-y divide-border overflow-y-auto p-0">
            {data.trips.map((t) => (
              <li key={t.trip_id} className="flex items-center gap-3 px-5 py-3" data-testid={`spotlight-${t.trip_id}`}>
                <span className="size-12 flex-none overflow-hidden rounded-xl bg-surface-2">
                  {t.cover_image_url && (
                    // eslint-disable-next-line @next/next/no-img-element -- backend media
                    <img src={t.cover_image_url} alt="" className="size-full object-cover" />
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{t.title}</span>
                  <span className="block truncate text-xs text-muted">
                    {t.creator_name}{t.creator_handle ? ` · @${t.creator_handle}` : ""} · {t.creator_trips} {t.creator_trips === 1 ? "trip" : "trips"} · {t.days}{" "}
                    {t.days === 1 ? "day" : "days"}, {t.stops} stops
                  </span>
                </span>
                {t.spotlight ? (
                  <span className="flex items-center gap-2">
                    <Badge tone="ok">In the spotlight</Badge>
                    <Button size="sm" variant="ghost" disabled={choose.isPending} onClick={() => choose.mutate({ id: t.trip_id, on: false })}>
                      Remove
                    </Button>
                  </span>
                ) : (
                  <Button size="sm" variant="secondary" disabled={choose.isPending} onClick={() => choose.mutate({ id: t.trip_id, on: true })}>
                    Feature
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </Card>
  );
}
