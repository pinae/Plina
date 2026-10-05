/** Leaving the app for another page (e.g. the single sign-on's logout);
 *  a module of its own so tests can stand in for the browser. */
export function goTo(url: string) {
    window.location.assign(url);
}
