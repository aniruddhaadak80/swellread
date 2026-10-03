import type { SqlExecutor } from "@/lib/db/client";
import { BREAKS } from "@/lib/live/breaks";

/**
 * Idempotent first-run seeding.
 *
 * Only reference data is seeded. No session rows exist before a visitor creates
 * one, so seeded records can never collide with user-created ones.
 */
export async function seedBreaks(executor: SqlExecutor): Promise<void> {
  for (const surfBreak of BREAKS) {
    // The conflict target is written with the same parameter placeholders as the
    // insert, rather than through `excluded`. Both are valid, and reusing the
    // placeholders keeps this statement to one parameterisation style.
    const sql =
      `insert into breaks (
         id, name, region, country, lat, lon, timezone, break_type,
         orientation_deg, reef_slope, depth_at_break_m,
         tide_station_id, tide_station_name, tide_station_distance_km, blurb
       ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
       on conflict (id) do update set
         name = $2,
         region = $3,
         country = $4,
         lat = $5,
         lon = $6,
         timezone = $7,
         break_type = $8,
         orientation_deg = $9,
         reef_slope = $10,
         depth_at_break_m = $11,
         tide_station_id = $12,
         tide_station_name = $13,
         tide_station_distance_km = $14,
         blurb = $15`;
    try {
      await executor.query(sql, [
        surfBreak.id,
        surfBreak.name,
        surfBreak.region,
        surfBreak.country,
        surfBreak.lat,
        surfBreak.lon,
        surfBreak.timezone,
        surfBreak.breakType,
        surfBreak.orientationDeg,
        surfBreak.reefSlope,
        surfBreak.depthAtBreakM,
        surfBreak.tideStationId,
        surfBreak.tideStationName,
        surfBreak.tideStationDistanceKm,
        surfBreak.blurb,
      ]);
    } catch (error) {
      // Re-throw with the statement that actually failed. Server log only.
      throw new Error(
        `seeding ${surfBreak.id} failed on: ${sql} :: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}