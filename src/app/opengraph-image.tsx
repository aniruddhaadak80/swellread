import { ImageResponse } from "next/og";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt =
  "Swellread: today's real swell, wind and verified tide turned into one explainable verdict per break.";

/** Social card. Drawn with primitives so it needs no font files at build time. */
export default async function OpengraphImage() {
  const hour = 24;
  const bar = (i: number, height: number, fill: string) => {
    const width = 26;
    const gap = 8;
    const x = 60 + i * (width + gap);
    return (
      <div
        key={i}
        style={{
          position: "absolute",
          left: x,
          bottom: 150,
          width,
          height,
          background: fill,
          opacity: i === 13 ? 1 : 0.55,
          outline: i === 13 ? "3px solid #c2410c" : "none",
        }}
      />
    );
  };
  const heights = [26, 34, 44, 58, 72, 88, 104, 116, 122, 110, 96, 82, 96, 128, 132, 118, 100, 86, 74, 62, 52, 44, 38, 32];

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: "#eef2f0",
          padding: 56,
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ fontSize: 22, letterSpacing: 6, color: "#6b868c", textTransform: "uppercase" }}>
            NOAA CO-OPS · Open-Meteo · deterministic engine
          </div>
          <div style={{ fontSize: 76, fontWeight: 800, color: "#0a2f36", marginTop: 18, lineHeight: 1.02 }}>
            Read the water before you paddle out.
          </div>
          <div style={{ fontSize: 28, color: "#3d5c63", marginTop: 20 }}>
            Which hours will actually peel — and is the drive worth it?
          </div>
        </div>

        <div style={{ position: "relative", height: 150, width: "100%", display: "flex" }}>
          {Array.from({ length: hour }).map((_, i) => bar(i, heights[i], i > 8 && i < 18 ? "#0f766e" : "#164e63"))}
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ fontSize: 34, fontWeight: 800, color: "#0a2f36" }}>Swellread</div>
          <div style={{ fontSize: 22, color: "#c2410c", letterSpacing: 3, textTransform: "uppercase" }}>
            Open source · MIT
          </div>
        </div>
      </div>
    ),
    size,
  );
}