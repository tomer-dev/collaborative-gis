import { LIMITS } from './limits.ts';
import { WS } from './ws.ts';

/** Unit conversion for copy that states a millisecond constant in seconds. */
const MS_PER_SECOND = 1000;

/** User-facing text in the SPA, grouped by screen. */
export const COPY = {
  APP: {
    NAME: 'Collaborative GIS',
    /** Top-bar link to the reviewer guide (ROUTES.APP.GUIDE), on every page. */
    GUIDE: 'Guide',
  },
  CONNECTION: {
    /** Banner while `degraded`: the socket keeps retrying with backoff. */
    DEGRADED_TITLE: 'Reconnecting…',
    /** The local draft stays in memory and is resent after the next join. */
    DEGRADED_DETAIL: 'Live updates are paused. Your drawing is kept.',
    /** Banner while `offline`: the saved areas are polled every `WS.OFFLINE_POLL_MS`. */
    OFFLINE_TITLE: 'Offline',
    /** States the poll interval from `WS.OFFLINE_POLL_MS`. */
    OFFLINE_DETAIL: `Showing the last saved areas; polling every ${WS.OFFLINE_POLL_MS / MS_PER_SECOND} s. Your drawing is kept.`,
    /** The offline banner's button: connect now. */
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
  /** The framed page the router shows for a path no route matches (apps/web NotFound). */
  NOT_FOUND: {
    TITLE: 'Page not found',
    BODY: 'There is nothing at this address.',
    /** Links to ROUTES.APP.MAP; a signed-out visitor is sent on to /login by the route guard. */
    LINK: 'Go to the map',
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
  /**
   * Saved areas on /map: the save dialog, the area panel (the areas in view, the selected area and
   * its history) and the conflict dialog (D4).
   */
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
    /** Delete asks once, inline: this question, then Yes (deletes) or No (back to Delete). */
    DELETE_CONFIRM: 'Delete?',
    DELETE_YES: 'Yes',
    DELETE_NO: 'No',
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
    /**
     * A 429 from the per-user budget (`RATE_LIMIT`): `waitMs` is the response's
     * `details.retryAfterMs` (else the whole window), stated in whole seconds, rounded up.
     */
    RATE_LIMITED: (waitMs: number) =>
      `Too many changes in a short time. Try again in ${Math.max(1, Math.ceil(waitMs / MS_PER_SECOND))} s.`,
    /** The area panel: its title, also the name of the list of the areas in the viewport. */
    LIST_TITLE: 'Areas in view',
    /** While the viewport's first answer is on its way (not "no areas"). */
    LIST_LOADING: 'Loading areas…',
    /** The viewport's first load failed: the list cannot say whether there are areas. */
    LIST_ERROR_TITLE: 'Could not load the areas',
    /** Loads the viewport's areas again. */
    LIST_RETRY: 'Retry',
    LIST_EMPTY: 'No saved areas in view.',
    /** Phone width only: the area panel's header button that unfolds the list (it starts folded). */
    LIST_SHOW: 'Show the list',
    /** The same button once the list is unfolded. */
    LIST_HIDE: 'Hide the list',
    HISTORY_TITLE: 'History',
    HISTORY_LOADING: 'Loading history…',
    HISTORY_ERROR_TITLE: 'Could not load the history',
    VERSION_LABEL: (version: number) => `Version ${version}`,
    /** In place of the revert button on the version the area is at now. */
    VERSION_CURRENT: 'Current',
    /** Who saved a version: a user id prefix (`LIMITS.USER_ID_PREFIX`). */
    VERSION_BY: (who: string) => `by ${who}`,
    REVERT: 'Revert to this version',
    REVERT_PENDING: 'Reverting…',
    REVERT_ERROR_TITLE: 'Could not revert the area',
    /** 409: someone deleted the area; a revert never brings it back. */
    REVERT_DELETED: 'This area has been deleted, so it cannot be reverted.',
    /** 404: the area or that version is gone; the lists and the history refetch. */
    REVERT_MISSING: 'That version is no longer available. The history has been refreshed.',
  },
} as const;
