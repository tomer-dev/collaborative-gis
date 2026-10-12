import { COPY, LIMITS } from '@cgis/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useState, type FormEvent, type InputHTMLAttributes } from 'react';
import { authErrorMessage, signIn, signUp } from '../../lib/auth';
import { setSession, type SessionUser } from '../../lib/session';
import { Banner, Button, Field, Input, Panel } from '../../ui';
import { focusRing } from '../../ui/focus';

export type AuthMode = 'login' | 'register';

type FieldName = 'name' | 'email' | 'password';
type Values = Record<FieldName, string>;

type FieldSpec = {
  name: FieldName;
  label: string;
  hint?: string;
  input: Pick<
    InputHTMLAttributes<HTMLInputElement>,
    'type' | 'autoComplete' | 'autoCapitalize' | 'spellCheck' | 'minLength'
  >;
};

const NAME: FieldSpec = {
  name: 'name',
  label: COPY.AUTH.NAME_LABEL,
  input: { type: 'text', autoComplete: 'name' },
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

type ModeSpec = {
  title: string;
  fields: readonly FieldSpec[];
  submitLabel: string;
  pendingLabel: string;
  errorTitle: string;
  submit: (values: Values) => Promise<SessionUser>;
  switchPrompt: string;
  switchLabel: string;
  switchTo: '/login' | '/register';
};

const MODES: Record<AuthMode, ModeSpec> = {
  login: {
    title: COPY.AUTH.LOGIN_TITLE,
    fields: [EMAIL, CURRENT_PASSWORD],
    submitLabel: COPY.AUTH.LOGIN_SUBMIT,
    pendingLabel: COPY.AUTH.LOGIN_PENDING,
    errorTitle: COPY.AUTH.LOGIN_ERROR_TITLE,
    submit: signIn,
    switchPrompt: COPY.AUTH.LOGIN_SWITCH_PROMPT,
    switchLabel: COPY.AUTH.LOGIN_SWITCH_LINK,
    switchTo: '/register',
  },
  register: {
    title: COPY.AUTH.REGISTER_TITLE,
    fields: [NAME, EMAIL, NEW_PASSWORD],
    submitLabel: COPY.AUTH.REGISTER_SUBMIT,
    pendingLabel: COPY.AUTH.REGISTER_PENDING,
    errorTitle: COPY.AUTH.REGISTER_ERROR_TITLE,
    submit: signUp,
    switchPrompt: COPY.AUTH.REGISTER_SWITCH_PROMPT,
    switchLabel: COPY.AUTH.REGISTER_SWITCH_LINK,
    switchTo: '/login',
  },
};

const EMPTY: Values = { name: '', email: '', password: '' };

/**
 * Sign-in or sign-up card; `mode` picks the fields, copy and call from MODES. On success it
 * stores the returned user in the session query and nothing else: the /login and /register
 * guard then sends the now signed-in user to /map.
 */
export function AuthForm({ mode }: { mode: AuthMode }) {
  const spec = MODES[mode];
  const queryClient = useQueryClient();
  const [values, setValues] = useState<Values>(EMPTY);
  const auth = useMutation({
    mutationFn: spec.submit,
    onSuccess: (user) => setSession(queryClient, user),
  });

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    auth.mutate(values);
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
              <Input
                {...field.input}
                name={field.name}
                value={values[field.name]}
                onChange={(event) =>
                  setValues((current) => ({ ...current, [field.name]: event.target.value }))
                }
              />
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
