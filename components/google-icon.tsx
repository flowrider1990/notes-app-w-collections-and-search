/**
 * Google's four-colour "G". Inlined because `lucide-react` only ships brand-neutral
 * icons, and Google's sign-in branding requires the mark to keep its own colours.
 *
 * Sizing is left to the button's `[&_svg]:size-4` rule so it matches other icons.
 */
export function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path
        fill="#4285F4"
        d="M23.52 12.27c0-.85-.08-1.67-.22-2.45H12v4.63h6.44a5.51 5.51 0 0 1-2.39 3.62v3.01h3.86c2.26-2.09 3.61-5.16 3.61-8.81z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.24 0 5.96-1.08 7.91-2.92l-3.86-3c-1.07.72-2.44 1.15-4.05 1.15-3.13 0-5.78-2.11-6.73-4.95H1.29v3.1A11.99 11.99 0 0 0 12 24z"
      />
      <path
        fill="#FBBC05"
        d="M5.27 14.28a7.2 7.2 0 0 1 0-4.56v-3.1H1.29a11.99 11.99 0 0 0 0 10.76l3.98-3.1z"
      />
      <path
        fill="#EA4335"
        d="M12 4.77c1.76 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.7 0 3.99 2.47 1.29 6.62l3.98 3.1C6.22 6.88 8.87 4.77 12 4.77z"
      />
    </svg>
  );
}
