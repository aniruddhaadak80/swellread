"use client";

import dynamic from "next/dynamic";
import type { LabConditions } from "@/components/lab/WaveLab";

/**
 * three.js touches `window` on import, so the scene is only ever loaded in the
 * browser. The skeleton keeps the layout stable while it arrives.
 */
const WaveLab = dynamic(() => import("@/components/lab/WaveLab").then((module) => module.WaveLab), {
  ssr: false,
  loading: () => (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
      <div className="border border-rule bg-paper">
        <div className="border-b border-rule px-4 py-2">
          <span className="label">Live surface</span>
        </div>
        <div className="h-[420px] w-full animate-pulse bg-abyss-deep" />
        <div className="border-t border-rule px-4 py-4">
          <div className="h-10 w-40 bg-glass-deep" />
        </div>
      </div>
      <div className="border border-rule bg-paper px-4 py-4">
        <div className="h-40 w-full animate-pulse bg-glass-deep" />
      </div>
    </div>
  ),
});

export function WaveLabLoader(props: { conditions: LabConditions; sessionId: string | null }) {
  return <WaveLab {...props} />;
}