import { COPY, ROUTES } from '@cgis/shared/constants';
import { Link } from '@tanstack/react-router';
import { Panel } from '../../ui';
import { focusRing } from '../../ui/focus';
import { AppFrame } from './AppFrame';

/**
 * The router's `defaultNotFoundComponent`: an unknown path keeps the app frame (header, theme
 * surface) and offers one way back, the map. The server's SPA fallback serves index.html for any
 * unknown path, so this is what a mistyped URL lands on.
 */
export function NotFound() {
  return (
    <AppFrame>
      <div className="flex h-full items-start justify-center overflow-y-auto px-4 py-12">
        <Panel as="section" variant="floating" title={COPY.NOT_FOUND.TITLE}>
          <p className="text-sm text-fg-muted">{COPY.NOT_FOUND.BODY}</p>
          <Link
            to={ROUTES.APP.MAP}
            className={`mt-4 inline-block rounded-sm font-medium text-primary underline-offset-4 hover:underline ${focusRing}`}
          >
            {COPY.NOT_FOUND.LINK}
          </Link>
        </Panel>
      </div>
    </AppFrame>
  );
}
