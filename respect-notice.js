(function () {
  var params = new URLSearchParams(window.location.search);
  var isOverlay = params.get('overlay') === 'true';

  if (isOverlay) return;

  function createNotice() {
    var bar = document.createElement('p');

    bar.id = 'respectNotice';
    bar.textContent =
      'Please be respectful — keep it kind and on-topic.';

    bar.style.display = 'flex';
    bar.style.alignItems = 'center';
    bar.style.justifyContent = 'center';
    bar.style.gap = '8px';

    bar.style.margin = '0';
    bar.style.padding = '8px 16px';
    bar.style.background = '#fff8e6';
    bar.style.borderBottom = '1px solid #f0d38a';
    bar.style.color = '#7a5b12';
    bar.style.fontSize = '13px';
    bar.style.lineHeight = 'normal';
    bar.style.textAlign = 'center';
    bar.style.boxSizing = 'border-box';

    document.body.prepend(bar);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', createNotice, {
      once: true
    });
  } else {
    createNotice();
  }
})();
