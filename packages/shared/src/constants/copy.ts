import { LIMITS } from './limits.ts';
import { WS } from './ws.ts';

/** Unit conversion for copy that states a millisecond constant in seconds. */
const MS_PER_SECOND = 1000;

/** User-facing text in the SPA, grouped by screen. */
export const COPY = {
  APP: {
    NAME: 'Collaborative GIS',
  },
  CONNECTION: {
    DEGRADED_TITLE: 'Reconnecting',
    DEGRADED_DETAIL: 'Live updates are paused. Your drawing is kept.',
    OFFLINE_TITLE: 'Offline',
    OFFLINE_DETAIL: `Live updates are off. Saved areas refresh every ${WS.OFFLINE_POLL_MS / MS_PER_SECOND} s.`,
    RETRY: 'Retry',
  },
  /** The base-layer switch on /map (LayerSwitch): the toolbar's name and its two toggles. */
  MAP: {
    BASE_LAYER_LABEL: 'Base map',
    /** OpenStreetMap on Web Mercator. */
    OSM_LABEL: 'Street map',
    /** govmap's aerial imagery on the EPSG:2039 grid. */
    AERIAL_LABEL: 'Aerial imagery',
  },
  PRESENCE: {
    TITLE: 'On this map',
    LABEL: 'People on this map',
  },
  AUTH: {
    LOGIN_TITLE: 'Sign in',
    LOGIN_SUBMIT: 'Sign in',
    LOGIN_PENDING: 'Signing in…',
    LOGIN_ERROR_TITLE: 'Could not sign in',
    LOGIN_SWITCH_PROMPT: 'No account yet?',
    LOGIN_SWITCH_LINK: 'Create one',
    REGISTER_TITLE: 'Create an account',
    REGISTER_SUBMIT: 'Create account',
    REGISTER_PENDING: 'Creating account…',
    REGISTER_ERROR_TITLE: 'Could not create the account',
    REGISTER_SWITCH_PROMPT: 'Already have an account?',
    REGISTER_SWITCH_LINK: 'Sign in',
    NAME_LABEL: 'Name',
    EMAIL_LABEL: 'Email',
    PASSWORD_LABEL: 'Password',
    PASSWORD_HINT: `At least ${LIMITS.PASSWORD_MIN} characters.`,
    /** Shown when a failed auth call carries no server message (network error, empty body). */
    ERROR_GENERIC: 'Something went wrong. Try again.',
    /** Shown once, while the first session check runs; later refetches keep the current screen. */
    SESSION_CHECKING: 'Checking your session…',
    SIGN_OUT: 'Sign out',
    SIGN_OUT_ERROR: 'Could not sign out. Try again.',
  },
  /** Saved areas on /map: the save dialog, the selected-area panel and the conflict dialog (D4). */
  AREAS: {
    SAVE_TITLE: 'Save area',
    NAME_LABEL: 'Name',
    NAME_HINT: `Up to ${LIMITS.AREA_NAME_MAX} characters.`,
    /** A name of only spaces passes `required` but not the schema's trim + min(1). */
    NAME_REQUIRED: 'Enter a name.',
    ESTIMATE_LABEL: 'Area (estimate)',
    AREA_LABEL: 'Area',
    SAVE_SUBMIT: 'Save',
    SAVE_PENDING: 'Saving…',
    SAVE_ERROR_TITLE: 'Could not save the area',
    SAVED_TITLE: 'Area saved',
    /** One line under the saved area when it differs from the estimate by more than MAP.AREA_DIFF_WARN_RATIO. */
    AREA_DIFF_NOTE: (saved: string, estimate: string) =>
      `The server measured ${saved}; the sketch estimate was ${estimate}.`,
    DONE: 'Done',
    CANCEL: 'Cancel',
    CLOSE: 'Close',
    RENAME_SUBMIT: 'Rename',
    RENAME_PENDING: 'Renaming…',
    RENAME_ERROR_TITLE: 'Could not rename the area',
    DELETE: 'Delete',
    DELETE_PENDING: 'Deleting…',
    DELETE_ERROR_TITLE: 'Could not delete the area',
    CONFLICT_TITLE: 'Someone else changed this area',
    CONFLICT_DESCRIPTION: 'Your edit started from an older version. Keep yours or load theirs.',
    CONFLICT_MINE_LABEL: 'Yours',
    CONFLICT_THEIRS_LABEL: 'Theirs',
    OVERWRITE: 'Overwrite with mine',
    LOAD_THEIRS: 'Load theirs',
    OVERWRITE_ERROR_TITLE: 'Could not overwrite the area',
    /** A failure without an API error body (network error, proxy page). */
    ERROR_GENERIC: 'Something went wrong. Try again.',
  },
} as const;
