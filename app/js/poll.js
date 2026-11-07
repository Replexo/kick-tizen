/* Chat polls, as on kick.com: the channel's running poll (question, options, votes, time left)
   sits above the chat, or in the top right corner with the chat hidden. It comes from
   /api/v2/channels/<slug>/polls when the stream opens, then from the chat socket
   (PollUpdateEvent on every vote, PollDeleteEvent). After the time is up the results stay for
   30 s. Up (from the video or the toolbar) moves into the card: up/down pick an option (signed
   in) or the × at the top, OK votes or closes it, Back leaves. A closed poll stays away until
   the channel starts another one. */
(function (K) {
  'use strict';

  var SITE = 'https://kick.com';
  var RESULT_MS = 30000;
  var slug = null, poll = null, gen = 0, tick = null, error = '', sending = null, inside = null, closed = null;

  function box() { return K.$('poll'); }
  function now() { return Date.now(); }
  function open() { return !!poll && now() < poll.endsAt; }
  function shown() { return !!poll && slug + '\n' + poll.title !== closed && now() < poll.endsAt + RESULT_MS; }

  // The REST answer is { data: { poll, remaining, has_voted, voted_option_id } } and the socket's
  // { poll: { ..., remaining } }: both are read, and a vote already made here is kept.
  function norm(d) {
    var p = d && d.poll;
    if (!p || !p.title || !(p.options || []).length) { return null; }
    var remaining = Number(p.remaining !== undefined ? p.remaining : d.remaining);
    if (isNaN(remaining)) { remaining = Number(p.duration) || 0; }
    var voted = d.voted_option_id !== undefined && d.voted_option_id !== null ? d.voted_option_id : p.voted_option_id;
    if ((voted === undefined || voted === null) && (d.has_voted || p.has_voted)) { voted = -1; }
    if ((voted === undefined || voted === null) && poll && poll.title === p.title) { voted = poll.voted; }
    return { title: String(p.title), endsAt: now() + Math.max(0, remaining) * 1000,
      voted: voted === undefined ? null : voted,
      options: p.options.map(function (o, i) { return { id: o.id !== undefined ? o.id : i, label: String(o.label || ''), votes: Number(o.votes) || 0 }; }) };
  }

  function mmss(sec) { sec = Math.max(0, Math.ceil(sec)); return Math.floor(sec / 60) + ':' + (sec % 60 < 10 ? '0' : '') + (sec % 60); }

  // In the chat column when it shows, else on its own over the video.
  function place() {
    var b = box(), chat = K.$('chat');
    if (!chat.hidden) { if (b.parentNode !== chat) { chat.insertBefore(b, chat.firstChild); } }
    else if (b.parentNode !== K.$('player')) { K.$('player').appendChild(b); }
  }

  function draw() {
    var b = box();
    if (!shown()) { stopTick(); b.hidden = true; poll = null; changed(); return; }
    place();
    var focusId = inside && K.focus.current ? K.focus.current._pid : null, votable = K.poll.votable();
    var total = 0, left = (poll.endsAt - now()) / 1000;
    poll.options.forEach(function (o) { total += o.votes; });
    b.textContent = '';
    b.className = 'poll' + (left <= 0 ? ' ended' : '');
    var head = K.el('div', 'poll-head');
    head.appendChild(K.el('span', 'poll-kind', K.t('Poll')));
    head.appendChild(K.el('span', 'poll-time', left > 0 ? K.t('{t} left', { t: mmss(left) }) : K.t('Poll ended')));
    var x = K.el('span', 'poll-x f', '\u00d7');
    x._pid = 'x';
    x._select = close;
    head.appendChild(x);
    b.appendChild(head);
    b.appendChild(K.el('div', 'poll-q', poll.title));
    var best = 0;
    poll.options.forEach(function (o) { best = Math.max(best, o.votes); });
    poll.options.forEach(function (o) {
      var pct = total ? Math.round(o.votes / total * 100) : 0, row = K.el('div', 'poll-o' + (votable ? ' f' : '')), fill = K.el('div', 'poll-fill');
      var mine = o.id === poll.voted || o.id === sending;
      // Running: the bars grow, the own vote is ringed and ticked. Ended: the leader is filled
      // in Kick green, the others fade.
      if (mine) { row.className += ' mine'; }
      if (left <= 0) { row.className += best > 0 && o.votes === best ? ' win' : ' lose'; }
      fill.style.width = pct + '%';
      row.appendChild(fill);
      row.appendChild(K.el('span', 'poll-label', o.label));
      if (mine) { row.appendChild(K.el('span', 'poll-tick')); }
      row.appendChild(K.el('span', 'poll-pct', pct + '%'));
      row._pid = o.id;
      row._select = function () { vote(o.id); };
      b.appendChild(row);
    });
    var foot = K.el('div', 'poll-foot', K.t('{n} votes', { n: K.count(total) }));
    var hint = error || (left <= 0 ? '' : poll.voted !== null ? K.t('You voted') : !K.auth.signedIn() ? K.t('Sign in to vote') : inside ? '' : K.t('Press ▲ to vote'));
    if (!hint && !inside) { hint = K.t('Press ▲ to close'); }
    if (hint) { foot.appendChild(K.el('span', 'poll-hint' + (error ? ' err' : ''), hint)); }
    b.appendChild(foot);
    b.hidden = false;
    if (inside) {
      var rows = b.querySelectorAll('.f'), keep = rows[votable ? 1 : 0];
      Array.prototype.forEach.call(rows, function (e) { if (e._pid === focusId) { keep = e; } });
      K.focus.scope = b;
      K.focus.set(keep, true);
    }
    if (!tick) { tick = setInterval(draw, 1000); }
    changed();
  }

  function stopTick() { clearInterval(tick); tick = null; }

  // The card gone: the focus goes back where it came from.
  function changed() { if (inside && !shown()) { leave(); } }

  // Kept across chat restarts (showing or hiding the chat), per channel.
  function close() { closed = poll && slug + '\n' + poll.title; leave(); draw(); }

  function leave() {
    var back = inside;
    inside = null;
    if (!back) { return; }
    Array.prototype.forEach.call(box().querySelectorAll('.focused'), function (e) { e.classList.remove('focused'); });
    K.focus.current = null;
    K.focus.setScope(back.scope, back.el);
    if (poll) { draw(); }
  }

  // The vote goes to kick.com; the next update brings the counts.
  function vote(id) {
    if (!K.poll.votable() || sending !== null) { return; }
    var p = poll, my = gen;
    sending = id;
    draw();
    K.http('POST', SITE + '/api/v2/channels/' + encodeURIComponent(slug) + '/polls/vote',
      { headers: { Authorization: 'Bearer ' + K.auth.token }, body: { id: id }, timeout: 10000 }, function (err) {
        if (my !== gen) { return; }
        sending = null;
        if (poll !== p) { return; }
        if (err && err.status !== 409) { error = err.status === 401 || err.status === 403 ? K.t('Sign in to vote') : K.t('Vote failed. Try again.'); draw(); return; }
        p.voted = id;
        error = '';
        leave();
      });
  }

  function set(p) {
    error = '';
    poll = p;
    draw();
  }

  K.poll = {
    start: function (channelSlug) {
      K.poll.stop();
      var my = gen;
      slug = channelSlug;
      if (!slug) { return; }
      var token = K.auth.token;
      K.http('GET', SITE + '/api/v2/channels/' + encodeURIComponent(slug) + '/polls', { headers: token ? { Authorization: 'Bearer ' + token } : {} }, function (err, d) {
        if (my !== gen || err || !d) { return; }
        var p = norm(d.data || d);
        if (p) { set(p); }
      });
    },

    stop: function () {
      gen++;
      leave();
      stopTick();
      sending = null;
      poll = null;
      error = '';
      slug = null;
      if (box()) { box().hidden = true; }
      changed();
    },

    // From the chat socket.
    update: function (d) { var p = norm(d); if (p) { set(p); } },
    remove: function () { poll = null; draw(); },
    inside: function () { return !!inside; },

    // Called when the chat column shows or hides.
    place: function () { if (shown()) { place(); } },

    votable: function () { return open() && poll.voted === null && K.auth.signedIn(); },

    // Up into the card; false when none shows.
    enter: function () {
      if (!shown() || inside) { return false; }
      inside = { scope: K.focus.scope, el: K.focus.current };
      draw();
      return true;
    },

    key: function (k) {
      if (k === 'up' || k === 'down') { K.focus.move(k); }
      else if (k === 'enter') { if (K.focus.current && K.focus.current._select) { K.focus.current._select(); } }
      else { leave(); }
    }
  };
})(window.K);

