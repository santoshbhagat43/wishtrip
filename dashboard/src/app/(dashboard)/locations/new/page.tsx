"use client";

import { useMutation } from "@tanstack/react-query";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";

import {
  LocationForm,
  emptyLocation,
  validateLocationForm,
  type LocationFormErrors,
  type LocationFormValue,
} from "@/components/location/location-form";
import { Button } from "@/components/ui/button";
import { ErrorNote, PageHeader } from "@/components/ui/card";
import { api, unwrap, type LocationType } from "@/lib/api/client";

function NewLocation() {
  const router = useRouter();
  const params = useSearchParams();
  const [value, setValue] = useState<LocationFormValue>(() => ({
    ...emptyLocation((params.get("type") as LocationType) || "attraction"),
    parent_id: params.get("parent_id"),
  }));
  const [fieldErrors, setFieldErrors] = useState<LocationFormErrors>({});
  const [focusDetailsKey, setFocusDetailsKey] = useState(0);
  const create = useMutation({
    mutationFn: async () => unwrap(await api.POST("/admin/locations", { body: value })),
    onSuccess: (loc) => router.replace(`/locations/${loc.id}`),
  });
  return (
    <form
      className="mx-auto max-w-4xl"
      onSubmit={(e) => {
        e.preventDefault();
        const errors = validateLocationForm(value);
        if (Object.keys(errors).length > 0) {
          setFieldErrors(errors);
          setFocusDetailsKey((k) => k + 1);
          return;
        }
        setFieldErrors({});
        create.mutate();
      }}
    >
      <PageHeader
        title="New location"
        description="Start with the basics; you can add media and relationships after saving."
        action={<Button type="submit" variant="accent" disabled={create.isPending}>{create.isPending ? "Saving…" : "Create"}</Button>}
      />
      <div className="mb-4"><ErrorNote error={create.error} /></div>
      <LocationForm
        value={value}
        onChange={setValue}
        isNew
        focusDetailsKey={focusDetailsKey}
        fieldErrors={fieldErrors}
        onClearFieldError={(field) => setFieldErrors((prev) => {
          if (!prev[field]) return prev;
          const next = { ...prev };
          delete next[field];
          return next;
        })}
      />
    </form>
  );
}

export default function NewLocationPage() {
  return (
    <Suspense>
      <NewLocation />
    </Suspense>
  );
}
