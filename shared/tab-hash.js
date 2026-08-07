/* Activate the tab named by the URL fragment, if there is one.
 *
 * The tab panels are click-driven — a fragment alone only scrolls, leaving the
 * default panel active, so a PWA shortcut to #tab-sleep would look like it
 * worked and land on the wrong tab. Clicking the button reuses the real
 * handler rather than duplicating the .active toggling.
 *
 * Tolerates both `#tab-sleep` and a bare `#sleep`: a shortcut URL is easy to
 * mistype once and hard to notice. CSS.escape because location.hash is
 * interpolated into a selector. */
export function activateTabFromHash() {
  const fromHash = location.hash.replace('#', '');
  if (!fromHash) return;
  const tab = CSS.escape(fromHash.replace(/^tab-/, ''));
  const btn = document.querySelector(`.tab-btn[data-tab="${tab}"]`);
  if (btn) btn.click();
}
