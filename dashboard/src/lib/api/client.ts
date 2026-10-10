import createClient from "openapi-fetch";

import type { components, paths } from "./schema";

/** Typed client for the FastAPI backend, routed through the authenticated Next proxy. */
export const api = createClient<paths>({ baseUrl: "/api/backend" });

export type Schemas = components["schemas"];
export type Location = Schemas["LocationRead"];
export type LocationListItem = Schemas["LocationListItem"];
export type LocationType = Schemas["LocationType"];
export type Tag = Schemas["TagRead"];
export type Relation = Schemas["RelationRead"];
export type ChatMessage = Schemas["MessageDebugRead"];
export type ChatSession = Schemas["SessionRead"];
export type Suggestion = Schemas["Suggestion"];
export type User = Schemas["UserRead"];

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/** Unwrap an openapi-fetch result: return data, or throw a readable error. */
export function unwrap<T>(result: { data?: T; error?: unknown; response: Response }): T {
  // 204 No Content (deletes) is a success with no body.
  if (result.response.status === 204) return undefined as T;
  if (result.error !== undefined || result.data === undefined) {
    throw new ApiError(errorMessage(result.error), result.response.status);
  }
  return result.data;
}

export function errorMessage(error: unknown): string {
  if (error && typeof error === "object" && "detail" in error) {
    const detail = (error as { detail: unknown }).detail;
    if (typeof detail === "string") return detail;
    if (Array.isArray(detail)) {
      return detail
        .map((d) => `${(d.loc ?? []).slice(1).join(".")}: ${d.msg}`)
        .join("; ");
    }
  }
  if (error instanceof Error) return error.message;
  return "Something went wrong";
}
