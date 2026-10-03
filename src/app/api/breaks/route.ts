import { NextResponse } from "next/server";
import { listBreaks } from "@/lib/live/breaks";

export const dynamic = "force-dynamic";

/** The curated catalogue. No upstream call: these are this project's own records. */
export async function GET() {
  return NextResponse.json({
    count: listBreaks().length,
    attribution:
      "Coordinates describe real coastlines. Orientation, reef slope and take-off depth are this project's own editorial estimates, and a tide station is only listed when NOAA CO-OPS publishes predictions for it.",
    breaks: listBreaks(),
  });
}