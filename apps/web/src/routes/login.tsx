import { createFileRoute } from '@tanstack/react-router';
import { AppFrame } from './-components/AppFrame';
import { AuthForm } from './-components/AuthForm';
import { redirectSignedIn } from './-components/redirectSignedIn';

export const Route = createFileRoute('/login')({
  beforeLoad: redirectSignedIn,
  component: LoginRoute,
});

// Renders under the root with the minimal header (app name and the guide link).
function LoginRoute() {
  return (
    <AppFrame>
      <AuthForm mode="login" />
    </AppFrame>
  );
}
