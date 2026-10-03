import { z } from "zod";

/** Every request body that crosses the network is parsed here first. */

export const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export const BreakIdSchema = z
  .string()
  .min(2)
  .max(64)
  .regex(/^[a-z0-9-]+$/, "break id must be lowercase letters, digits and hyphens");

export const CreateSessionSchema = z.object({
  breakId: BreakIdSchema,
  /** ISO-8601 UTC instant of the planned hour. */
  plannedFor: z.string().min(10).max(40),
  status: z.enum(["planned", "committed", "skipped", "ridden"]).default("planned"),
  note: z.string().trim().max(600).nullish(),
  idempotencyKey: z.string().trim().min(8).max(120).nullish(),
});

export const UpdateSessionSchema = z
  .object({
    status: z.enum(["planned", "committed", "skipped", "ridden"]).optional(),
    call: z.enum(["in", "out"]).nullish(),
    confidence: z.number().int().min(1).max(5).nullish(),
    note: z.string().trim().max(600).nullish(),
    embedding: z.string().max(4000).nullish(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: "no updatable fields supplied" });

export const RideSchema = z.object({
  durationSec: z.number().int().min(0).max(86_400),
  longestRideSec: z.number().int().min(0).max(86_400),
  topSpeedKmh: z.number().min(0).max(250),
  completed: z.boolean(),
});

export const EngineQuerySchema = z.object({
  breakId: BreakIdSchema,
  /** Local calendar date, YYYY-MM-DD. */
  date: z.string().regex(ISO_DATE).optional(),
  /** Hour index 0..23 within the local day. */
  hour: z.coerce.number().int().min(0).max(23).default(0),
  /** What-if tide height in metres. Never written back to live data. */
  tideM: z.coerce.number().min(-1).max(8).optional(),
});

export const ListQuerySchema = z.object({
  status: z.enum(["planned", "committed", "skipped", "ridden"]).optional(),
  breakId: BreakIdSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).max(10_000).default(0),
});

export type CreateSessionInput = z.infer<typeof CreateSessionSchema>;
export type UpdateSessionInput = z.infer<typeof UpdateSessionSchema>;
export type RideInput = z.infer<typeof RideSchema>;
export type EngineQuery = z.infer<typeof EngineQuerySchema>;
export type ListQuery = z.infer<typeof ListQuerySchema>;

export function firstIssue(error: z.ZodError): string {
  const issue = error.issues[0];
  if (!issue) return "request failed validation";
  const path = issue.path.join(".");
  return path ? `${path}: ${issue.message}` : issue.message;
}