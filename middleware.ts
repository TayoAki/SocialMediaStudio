import { NextResponse, type NextRequest } from "next/server";

/** Only exposes the pathname to server layouts for nav highlighting. Not used for authorization. */
export function middleware(req: NextRequest) {
  const h = new Headers(req.headers);
  h.set("x-pathname", req.nextUrl.pathname);
  return NextResponse.next({ request: { headers: h } });
}
export const config = { matcher: ["/((?!_next|api|favicon).*)"] };
