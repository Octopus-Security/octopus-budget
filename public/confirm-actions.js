// Themed confirmation for links and forms carrying data-confirm="message".
// Replaces inline onclick/onsubmit handlers that used the native browser dialog.
// Optional: data-confirm-label (button text), data-confirm-danger="0" to opt out
// of the red styling (default is danger; the label defaults to "Confirm").
(function () {
  function opts(el) {
    return {
      title: el.getAttribute('data-confirm-title') || 'Are you sure?',
      body: el.getAttribute('data-confirm'),
      confirmLabel: el.getAttribute('data-confirm-label') || 'Confirm',
      danger: el.getAttribute('data-confirm-danger') !== '0',
    };
  }
  document.addEventListener('click', async function (e) {
    const a = e.target.closest && e.target.closest('a[data-confirm]');
    if (!a || a.dataset.confirmed) return;
    e.preventDefault();
    if (await oDialog.confirm(opts(a))) location.href = a.href;
  });
  document.addEventListener('submit', async function (e) {
    const f = e.target;
    if (!f.matches || !f.matches('form[data-confirm]') || f.dataset.confirmed) return;
    e.preventDefault();
    if (await oDialog.confirm(opts(f))) { f.dataset.confirmed = '1'; f.submit(); }
  });
})();
