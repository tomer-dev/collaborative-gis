import { COPY, LIMITS, ROUTES } from '@cgis/shared/constants';
import { useMutation } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import type { FormEvent, InputHTMLAttributes } from 'react';
import { z } from 'zod';
import { authErrorMessage, signIn, signUp } from '../../lib/auth';
import { Banner, Button, Field, Input, Panel } from '../../ui';
import { focusRing } from '../../ui/focus';

export type AuthMode = 'login' | 'register';

type FieldName = 'name' | 'email' | 'password';

type FieldSpec = {
  name: FieldName;
  label: string;
  hint?: string;
  input: Pick<
    InputHTMLAttributes<HTMLInputElement>,
    'type' | 'autoComplete' | 'autoCapitalize' | 'spellCheck' | 'minLength' | 'maxLength'
  >;
};

const NAME: FieldSpec = {
  name: 'name',
  label: COPY.AUTH.NAME_LABEL,
  input: { type: 'text', autoComplete: 'name', maxLength: LIMITS.USER_NAME_MAX },
};
const EMAIL: FieldSpec = {
  name: 'email',
  label: COPY.AUTH.EMAIL_LABEL,
  input: { type: 'email', autoComplete: 'email', autoCapitalize: 'none', spellCheck: false },
};
// Sign-in checks a password; only sign-up sets one, so only it carries the length rule.
const CURRENT_PASSWORD: FieldSpec = {
  name: 'password',
  label: COPY.AUTH.PASSWORD_LABEL,
  input: { type: 'password', autoComplete: 'current-password' },
};
const NEW_PASSWORD: FieldSpec = {
  name: 'password',
  label: COPY.AUTH.PASSWORD_LABEL,
  hint: COPY.AUTH.PASSWORD_HINT,
  input: { type: 'password', autoComplete: 'new-password', minLength: LIMITS.PASSWORD_MIN },
};

// The submitted FormData entries, parsed with the same rules as the native required/minlength
// (which block the submit first). Email format is left to type="email" and the server.
const SignInForm = z.object({
  email: z.string().min(1),
  password: z.string().min(1),
});
const SignUpForm = z.object({
  name: z.string().trim().min(1).max(LIMITS.USER_NAME_MAX),
  email: z.string().min(1),
  password: z.string().min(LIMITS.PASSWORD_MIN),
});

type ModeSpec = {
  title: string;
  fields: readonly FieldSpec[];
  submitLabel: string;
  pendingLabel: string;
  errorTitle: string;
  /** Parses the form's entries and makes the call; a parse failure rejects like a failed call. */
  submit: (form: FormData) => Promise<void>;
  switchPrompt: string;
  switchLabel: string;
  switchTo: typeof ROUTES.APP.LOGIN | typeof ROUTES.APP.REGISTER;
};

const MODES: Record<AuthMode, ModeSpec> = {
  login: {
    title: COPY.AUTH.LOGIN_TITLE,
    fields: [EMAIL, CURRENT_PASSWORD],
    submitLabel: COPY.AUTH.LOGIN_SUBMIT,
    pendingLabel: COPY.AUTH.LOGIN_PENDING,
    errorTitle: COPY.AUTH.LOGIN_ERROR_TITLE,
    submit: (form) => signIn(SignInForm.parse(Object.fromEntries(form))),
    switchPrompt: COPY.AUTH.LOGIN_SWITCH_PROMPT,
    switchLabel: COPY.AUTH.LOGIN_SWITCH_LINK,
    switchTo: ROUTES.APP.REGISTER,
  },
  register: {
    title: COPY.AUTH.REGISTER_TITLE,
    fields: [NAME, EMAIL, NEW_PASSWORD],
    submitLabel: COPY.AUTH.REGISTER_SUBMIT,
    pendingLabel: COPY.AUTH.REGISTER_PENDING,
    errorTitle: COPY.AUTH.REGISTER_ERROR_TITLE,
    submit: (form) => signUp(SignUpForm.parse(Object.fromEntries(form))),
    switchPrompt: COPY.AUTH.REGISTER_SWITCH_PROMPT,
    switchLabel: COPY.AUTH.REGISTER_SWITCH_LINK,
    switchTo: ROUTES.APP.LOGIN,
  },
};

/**
 * Sign-in or sign-up card; `mode` picks the fields, copy and call from MODES. Success needs no
 * handler: Better Auth refetches its session, `AppRouterProvider` re-runs the guards, and the
 * /login and /register guard sends the now signed-in user to the map.
 */
export function AuthForm({ mode }: { mode: AuthMode }) {
  const spec = MODES[mode];
  const auth = useMutation({ mutationFn: spec.submit });

  // Uncontrolled inputs: the browser holds the values and validates them before this runs.
  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    auth.mutate(new FormData(event.currentTarget));
  }

  return (
    <div className="flex h-full items-start justify-center overflow-y-auto px-4 py-12">
      <Panel
        as="section"
        variant="floating"
        title={spec.title}
        footer={
          <p className="text-sm text-fg-muted">
            {spec.switchPrompt}{' '}
            <Link
              to={spec.switchTo}
              className={`rounded-sm font-medium text-primary underline-offset-4 hover:underline ${focusRing}`}
            >
              {spec.switchLabel}
            </Link>
          </p>
        }
      >
        <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
          {auth.isError ? (
            <Banner tone="danger" title={spec.errorTitle}>
              {authErrorMessage(auth.error)}
            </Banner>
          ) : null}
          {spec.fields.map((field) => (
            <Field key={field.name} label={field.label} hint={field.hint} required>
              <Input {...field.input} name={field.name} />
            </Field>
          ))}
          <Button type="submit" disabled={auth.isPending}>
            {auth.isPending ? spec.pendingLabel : spec.submitLabel}
          </Button>
        </form>
      </Panel>
    </div>
  );
}
