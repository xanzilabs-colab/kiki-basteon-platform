import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });
  const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { cookies: { getAll: () => request.cookies.getAll(), setAll: (items: { name: string; value: string; options?: Record<string, unknown> }[]) => { items.forEach(({ name, value }) => request.cookies.set(name, value)); response = NextResponse.next({ request }); items.forEach(({ name, value, options }) => response.cookies.set(name, value, options)); } } });
  const { data: { user } } = await supabase.auth.getUser();
  const { pathname } = request.nextUrl;
  const publicRoute = pathname === "/login" || pathname === "/signup";
  if (!user && !publicRoute && !pathname.startsWith("/api/")) return NextResponse.redirect(new URL("/login", request.url));
  if (user && publicRoute) return NextResponse.redirect(new URL("/", request.url));
  if (user && (pathname.startsWith("/admin") || pathname.startsWith("/responder") || pathname.startsWith("/account"))) {
    const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
    const role = profile?.role;
    if (pathname.startsWith("/admin") && role !== "admin") return NextResponse.redirect(new URL(role === "user" ? "/account" : "/responder", request.url));
    if (pathname.startsWith("/responder") && role === "user") return NextResponse.redirect(new URL("/account", request.url));
    if (pathname.startsWith("/account") && role && role !== "user") return NextResponse.redirect(new URL(role === "admin" ? "/admin" : "/responder", request.url));
  }
  return response;
}
export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };