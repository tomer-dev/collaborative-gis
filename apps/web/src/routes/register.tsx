import { createFileRoute } from '@tanstack/react-router';
import { AppFrame } from './-components/AppFrame';
import { AuthForm } from './-components/AuthForm';
import { redirectSignedIn } from './-components/redirectSignedIn';

export const Route = createFileRoute('/register')({
  beforeLoad: redirectSignedIn,
  component: RegisterRoute,
});

// Renders under the root with the minimal header (app name and the guide link).
function RegisterRoute() {
  return (
    <AppFrame>
      <AuthForm mode="register" />
    </AppFrame>
  );
}
