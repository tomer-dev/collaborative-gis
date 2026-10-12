import { createFileRoute } from '@tanstack/react-router';
import type { FormEvent } from 'react';
import { AppFrame } from './-components/AppFrame';

export const Route = createFileRoute('/login')({
  component: LoginRoute,
});

// Placeholder until T12 submits to Better Auth; stops the browser from putting the fields in the URL.
function ignoreSubmit(event: FormEvent<HTMLFormElement>) {
  event.preventDefault();
}

// Renders under the root with the minimal header (app name only).
function LoginRoute() {
  return (
    <AppFrame>
      <section className="mx-auto flex w-full max-w-sm flex-col gap-4 px-4 py-8">
        <h2 className="text-2xl font-semibold">Sign in</h2>
        <form className="flex flex-col gap-3" onSubmit={ignoreSubmit}>
          <label className="flex flex-col gap-1 text-sm">
            Email
            <input
              type="email"
              name="email"
              autoComplete="email"
              required
              className="rounded border border-current/30 px-3 py-2"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Password
            <input
              type="password"
              name="password"
              autoComplete="current-password"
              required
              className="rounded border border-current/30 px-3 py-2"
            />
          </label>
          <button
            type="submit"
            className="rounded border border-current/30 px-3 py-2 font-medium focus-visible:outline-2 focus-visible:outline-offset-2"
          >
            Sign in
          </button>
        </form>
      </section>
    </AppFrame>
  );
}
