"use client";

import { cn } from "@/lib/utils";
import { AFTER_SIGN_IN_PATH } from "@/lib/auth-redirect";
import {
  signInWithPassword,
  signInWithProvider,
  type OAuthProvider,
} from "@/lib/db/auth-browser";
import { Button } from "@/components/ui/button";
import { GoogleIcon } from "@/components/google-icon";
import { Github } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function LoginForm({
  className,
  ...props
}: React.ComponentPropsWithoutRef<"div">) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  /** Which sign-in is in flight, so only that button changes its label. */
  const [pending, setPending] = useState<"password" | OAuthProvider | null>(
    null,
  );
  const router = useRouter();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setPending("password");
    setError(null);

    try {
      await signInWithPassword(email, password);
      router.push(AFTER_SIGN_IN_PATH);
    } catch (error: unknown) {
      setError(error instanceof Error ? error.message : "An error occurred");
    } finally {
      setPending(null);
    }
  };

  const handleOAuthLogin = async (provider: OAuthProvider) => {
    setPending(provider);
    setError(null);

    try {
      await signInWithProvider(provider);
      // No success branch: the call navigates to the provider. The button stays in
      // its pending state until the browser leaves, so clearing it here would only
      // flash the original label back at the user mid-redirect.
    } catch (error: unknown) {
      setError(error instanceof Error ? error.message : "An error occurred");
      setPending(null);
    }
  };

  return (
    <div className={cn("flex flex-col gap-6", className)} {...props}>
      <Card>
        <CardHeader>
          <CardTitle className="text-2xl">Login</CardTitle>
          <CardDescription>
            Enter your email below to login to your account
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleLogin}>
            <div className="flex flex-col gap-6">
              <div className="grid gap-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="m@example.com"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
              <div className="grid gap-2">
                <div className="flex items-center">
                  <Label htmlFor="password">Password</Label>
                  <Link
                    href="/auth/forgot-password"
                    className="ml-auto inline-block text-sm underline-offset-4 hover:underline"
                  >
                    Forgot your password?
                  </Link>
                </div>
                <Input
                  id="password"
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
              {error && <p className="text-sm text-red-500">{error}</p>}
              <Button
                type="submit"
                className="w-full"
                disabled={pending !== null}
              >
                {pending === "password" ? "Logging in..." : "Login"}
              </Button>

              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                <span className="h-px flex-1 bg-border" />
                or
                <span className="h-px flex-1 bg-border" />
              </div>

              {/* Inside the form, so both need an explicit type: a bare button
                  submits the email and password instead. */}
              <Button
                type="button"
                variant="outline"
                className="w-full"
                disabled={pending !== null}
                onClick={() => handleOAuthLogin("google")}
              >
                <GoogleIcon />
                {pending === "google"
                  ? "Redirecting to Google…"
                  : "Sign in with Google"}
              </Button>

              <Button
                type="button"
                variant="outline"
                className="w-full"
                disabled={pending !== null}
                onClick={() => handleOAuthLogin("github")}
              >
                {/* GitHub's mark is monochrome by design, so lucide's icon is the
                    real thing rather than an approximation — unlike Google's, which
                    needs its four colours and lives in its own component. */}
                <Github size={16} aria-hidden />
                {pending === "github"
                  ? "Redirecting to GitHub…"
                  : "Sign in with GitHub"}
              </Button>
            </div>
            <div className="mt-4 text-center text-sm">
              Don&apos;t have an account?{" "}
              <Link
                href="/auth/sign-up"
                className="underline underline-offset-4"
              >
                Sign up
              </Link>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
