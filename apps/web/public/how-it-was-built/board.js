/* global document, window, location */
// The project board map on guide/index.html and how-it-was-built/index.html: hover, tap or
// focus on a ticket draws its own links and fills the caption. Without this script the map,
// the chain and the ticket lists still read in full.
(function () {
  var source = document.getElementById('build-map');
  var svg = document.getElementById('map');
  if (!source || !svg) return;
  var data = JSON.parse(source.textContent);
  var layer = document.getElementById('links');
  var cap = document.getElementById('map-cap');
  var idle = cap.textContent;
  var byId = {};
  data.tickets.forEach(function (t) {
    byId[t.id] = t;
  });
  function box(id) {
    return svg.querySelector('a[data-id="' + id + '"]');
  }
  function center(a) {
    var r = a.querySelector('rect');
    var x = Number(r.getAttribute('x')) + r.getAttribute('width') / 2;
    var y = Number(r.getAttribute('y')) + r.getAttribute('height') / 2;
    return [x, y];
  }
  function clear() {
    layer.textContent = '';
    svg.querySelectorAll('.lit, .sel').forEach(function (a) {
      a.classList.remove('lit', 'sel');
    });
  }
  function draw(from, ids, cls) {
    ids.forEach(function (id) {
      var to = box(id);
      if (!to) return;
      var path = document.createElementNS(svg.namespaceURI, 'path');
      path.setAttribute('d', 'M' + center(from).join(',') + ' L' + center(to).join(','));
      path.setAttribute('class', cls);
      layer.appendChild(path);
      to.classList.add('lit');
    });
  }
  function when(ts) {
    return ts ? ts.slice(0, 10) + ' ' + ts.slice(11, 16) : 'not recorded';
  }
  function show(a) {
    var t = byId[a.getAttribute('data-id')];
    if (!t) return;
    clear();
    a.classList.add('sel');
    draw(a, t.blockedBy, 'in');
    draw(a, t.blocks, 'out');
    draw(a, t.related, 'rel');
    var parts = [t.state, 'started ' + when(t.started), 'closed ' + when(t.closed)];
    if (t.prs.length) parts.push('PR #' + t.prs.join(', #'));
    if (t.blockedBy.length) parts.push('blocked by ' + t.blockedBy.join(', '));
    if (t.blocks.length) parts.push('blocks ' + t.blocks.join(', '));
    if (t.related.length) parts.push('related to ' + t.related.join(', '));
    var title = document.createElement('b');
    title.textContent = t.id + ' · ' + t.title;
    var entry = document.createElement('a');
    entry.href = a.getAttribute('href');
    entry.textContent = 'Its entry in the ticket lists';
    cap.textContent = '';
    cap.append(title, ' ' + t.summary + ' ' + parts.join(' · ') + '. ', entry);
  }
  function ticket(e) {
    return e.target.closest ? e.target.closest('a.tk') : null;
  }
  svg.addEventListener('mouseover', function (e) {
    if (ticket(e)) show(ticket(e));
  });
  svg.addEventListener('focusin', function (e) {
    if (ticket(e)) show(ticket(e));
  });
  // A pointer click or tap only shows the links; Enter (detail 0) follows the link to the lists.
  svg.addEventListener('click', function (e) {
    if (ticket(e) && e.detail) {
      e.preventDefault();
      show(ticket(e));
    }
  });
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    clear();
    cap.textContent = idle;
  });
  // A link to a ticket opens the epic block that holds it (the lists on how-it-was-built).
  function reveal() {
    var el = location.hash && document.getElementById(location.hash.slice(1));
    var block = el && el.closest('details');
    if (block && !block.open) {
      block.open = true;
      el.scrollIntoView();
    }
  }
  window.addEventListener('hashchange', reveal);
  reveal();
})();
