"use client";

import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";

import { Button } from "@/components/ui/button";
import { signOut } from "@/lib/db/auth-browser";

/**
 * Signs out and returns to the login page. Lives in the workspace header, which is
 * the only place in the app a signed-in user ever is.
 */
export function LogoutButton() {
  const router = useRouter();

  async function logout() {
    // Navigating either way. `signOut` clears the browser's session before it
    // reports a failure, so a network error still leaves no credentials here — and
    // if a session somehow survived, the proxy sends the user straight back in.
    try {
      await signOut();
    } catch {
      // Nothing useful to say: there is no state to preserve and no retry that
      // would help. The redirect below is the honest outcome either way.
    }

    router.push("/auth/login");
  }

  return (
    <Button type="button" variant="ghost" size="sm" onClick={logout}>
      <LogOut size={16} aria-hidden />
      Sign out
    </Button>
  );
}
