import createClient from "openapi-fetch";

import type { components, paths } from "./schema";

/** Typed client for the backend — always through this site's own /api/wt gateway. */
export const api = createClient<paths>({ baseUrl: "/api/wt" });

export type Schemas = components["schemas"];
export type Place = Schemas["PublicLocation"];
export type ChatMessage = Schemas["MessageRead"];

export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export function errorMessage(error: unknown): string {
  if (error && typeof error === "object" && "detail" in error) {
    const detail = (error as { detail: unknown }).detail;
    if (typeof detail === "string") return detail;
    if (Array.isArray(detail)) return detail.map((d) => d.msg).join("; ");
  }
  if (error instanceof Error) return error.message;
  return "Something went wrong";
}

export function unwrap<T>(result: { data?: T; error?: unknown; response: Response }): T {
  if (result.response.status === 204) return undefined as T;
  if (result.error !== undefined || result.data === undefined) {
    throw new ApiError(errorMessage(result.error), result.response.status);
  }
  return result.data;
}
