"use client";

import { useState } from "react";
import { Github } from "lucide-react";

import { GoogleIcon } from "@/components/google-icon";
import { Button } from "@/components/ui/button";
import { signInWithProvider, type OAuthProvider } from "@/lib/db/auth-browser";

/**
 * The social sign-in buttons, with the divider that separates them from the
 * email-and-password form above.
 *
 * Shared by the sign-in and sign-up forms because there is nothing to distinguish:
 * OAuth has no separate registration step, so the first time someone arrives through
 * a provider the account is created, and every time after that the same call signs
 * them in. Only the wording differs, which is what `verb` is for.
 *
 * Owns its own pending and error state. Both buttons disable while either redirect is
 * in flight, and neither clears its pending state on success — the browser is on its
 * way to the provider, and resetting the label would flash it back mid-navigation.
 */
export function OAuthButtons({ verb }: { verb: "Sign in" | "Sign up" }) {
  const [pending, setPending] = useState<OAuthProvider | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function start(provider: OAuthProvider) {
    setPending(provider);
    setError(null);

    try {
      await signInWithProvider(provider);
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : "An error occurred");
      setPending(null);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-3 text-xs text-muted-foreground">
        <span className="h-px flex-1 bg-border" />
        or
        <span className="h-px flex-1 bg-border" />
      </div>

      {/* Explicit types: these render inside a form, where a bare button submits
          the email and password instead. */}
      <Button
        type="button"
        variant="outline"
        className="w-full"
        disabled={pending !== null}
        onClick={() => start("google")}
      >
        <GoogleIcon />
        {pending === "google" ? "Redirecting to Google…" : `${verb} with Google`}
      </Button>

      <Button
        type="button"
        variant="outline"
        className="w-full"
        disabled={pending !== null}
        onClick={() => start("github")}
      >
        {/* GitHub's mark is monochrome by design, so lucide's icon is the real thing
            rather than an approximation — unlike Google's, which needs its four
            colours and so lives in its own component. */}
        <Github size={16} aria-hidden />
        {pending === "github" ? "Redirecting to GitHub…" : `${verb} with GitHub`}
      </Button>

      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
