import { NextResponse, type NextRequest } from "next/server";
import { OWNER_COOKIE } from "@/lib/session/owner";

/**
 * Mints the anonymous owner cookie before any route runs, so both server
 * components and route handlers see the same rider id.
 */
export function middleware(request: NextRequest) {
  const existing = request.cookies.get(OWNER_COOKIE)?.value;
  if (existing && /^[0-9a-f-]{36}$/i.test(existing)) {
    return NextResponse.next();
  }
  const response = NextResponse.next();
  response.cookies.set(OWNER_COOKIE, crypto.randomUUID(), {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
    secure: process.env.NODE_ENV === "production",
  });
  return response;
}

export const config = {
  // Skip the bundled model files and ordinary static assets: they never need a
  // rider cookie, and the 20 MB model should not be routed through middleware.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|models/|og.png|icon.svg|opengraph-image|robots.txt|sitemap.xml|.*\\.(?:svg|png|jpg|jpeg|webp|gif|onnx|json|txt|md|webmanifest)$).*)",
  ],
};