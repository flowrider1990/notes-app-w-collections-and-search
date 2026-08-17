import { BackLink } from "@/components/back-link";
import { ForgotPasswordForm } from "@/components/forgot-password-form";

export default function Page() {
  return (
    <div className="flex min-h-svh w-full items-center justify-center p-6 md:p-10">
      <div className="flex w-full max-w-sm flex-col gap-4">
        <BackLink href="/auth/login" label="Back to sign in" />
        <ForgotPasswordForm />
      </div>
    </div>
  );
}
