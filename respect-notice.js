(function () {
  function showRespectNotice() {
    var params = new URLSearchParams(window.location.search);
    var isOverlay = params.get('overlay') === 'true';

    if (isOverlay || !document.body) return;

    var bar = document.createElement('div');

    bar.id = 'respectNotice';
    bar.textContent =
      'Please be respectful — keep it kind and on-topic.';

    bar.style.display = 'flex';
    bar.style.alignItems = 'center';
    bar.style.justifyContent = 'center';
    bar.style.gap = '8px';
    bar.style.padding = '8px 16px';
    bar.style.background = '#fff8e6';
    bar.style.borderBottom = '1px solid #f0d38a';
    bar.style.color = '#7a5b12';
    bar.style.fontSize = '13px';
    bar.style.textAlign = 'center';
    bar.style.boxSizing = 'border-box';
    bar.style.width = '100%';
    bar.style.position = 'relative';
    bar.style.zIndex = '100000';

    document.body.prepend(bar);
  }

  if (document.readyState === 'loading') {
    document.addEventListener(
      'DOMContentLoaded',
      showRespectNotice,
      { once: true }
    );
  } else {
    showRespectNotice();
  }
})();
