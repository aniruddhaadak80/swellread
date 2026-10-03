export const site = {
  name: "Swellread",
  tagline: "Read the water before you paddle out.",
  description:
    "Swellread turns today's real swell, wind and verified tide into one explainable verdict per break: which hours will actually peel, and whether the drive is worth it.",
  url: process.env.NEXT_PUBLIC_SITE_URL ?? "https://swellread.vercel.app",
  repository: "https://github.com/aniruddhaadak80/swellread",
  repositorySlug: "aniruddhaadak80/swellread",
  license: "MIT",
  author: "Aniruddha Adak",
  nav: [
    { href: "/breaks", label: "Breaks" },
    { href: "/sessions", label: "Sessions" },
    { href: "/lab", label: "Wave lab" },
    { href: "/agent", label: "Agent" },
    { href: "/export", label: "Brief" },
    { href: "/method", label: "Method" },
    { href: "/settings", label: "Settings" },
  ],
  engineVersion: "swellread-engine/2026.10.1",
} as const;

export type NavItem = (typeof site.nav)[number];

export const githubDisplayLabel = "Star on GitHub";