/**
 * Targeting: Property Detail Pages only.
 * Includes the visitor when the PDP details bar is present on a
 * /houses-for-rent/ URL.
 */
(() => {
    if (!/\/houses-for-rent\/[^/]+/.test(window.location.pathname)) {
        setTargeting(false);
        return;
    }
    Kameleoon.API.Core.runWhenElementPresent('section.static-details-bar .max-width__wrapper > .button-group', () => {
        setTargeting(true);
    });
})();
