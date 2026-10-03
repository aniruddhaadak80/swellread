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
    await executor.query(
      `insert into breaks (
         id, name, region, country, lat, lon, timezone, break_type,
         orientation_deg, reef_slope, depth_at_break_m,
         tide_station_id, tide_station_name, tide_station_distance_km, blurb
       ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
       on conflict (id) do update set
         name = excluded.name,
         region = excluded.region,
         country = excluded.country,
         lat = excluded.lat,
         lon = excluded.lon,
         timezone = excluded.timezone,
         break_type = excluded.break_type,
         orientation_deg = excluded.orientation_deg,
         reef_slope = excluded.reef_slope,
         depth_at_break_m = excluded.depth_at_break_m,
         tide_station_id = excluded.tide_station_id,
         tide_station_name = excluded.tide_station_name,
         tide_station_distance_km = excluded.tide_station_distance_km,
         blurb = excluded.blurb`,
      [
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
      ],
    );
  }
}