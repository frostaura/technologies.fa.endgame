import { appName } from "@endgame/appkit";

/**
 * The app's name: the platform's, written into every page it serves, so the header, the tab and the platform's own
 * sign-in page all say the same — and a rename in Endgame needs no rebuild. "Notes" is what tests and a local `vite`
 * show; set it to the app's name too (and `index.html`'s <title>, which shows before the script runs). Never write the
 * app's name anywhere else: every place that shows it reads `APP_NAME`.
 */
export const APP_NAME = appName("Notes");
