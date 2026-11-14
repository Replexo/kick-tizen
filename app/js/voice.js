/* Voice commands through Samsung's webapis.voiceinteraction (TVs from 2021, Tizen 6.0 and up;
   needs the voicecontrol privilege in config.xml). Holding the remote's mic button and saying
   what to look for opens Search with the spoken text; the assistant also asks which state the
   app is in, and play/pause, next/previous channel and arrow/OK commands map onto the remote's
   keys. On TVs without the API (the 2019 TV) nothing happens and Search shows no voice hint. */
(function (K) {
  'use strict';

  var on = false;

  // The remote's key codes as js/app.js reads them.
  var CODES = { left: 37, up: 38, right: 39, down: 40, enter: 13, play: 415, pause: 19, chup: 427, chdown: 428 };
  var NAV = { NAV_LEFT: 'left', NAV_RIGHT: 'right', NAV_UP: 'up', NAV_DOWN: 'down' };

  // As if the key had been pressed: the same handler decides what it does where.
  function press(k) {
    var e = document.createEvent('Event');
    e.initEvent('keydown', true, true);
    e.keyCode = CODES[k];
    document.dispatchEvent(e);
    return true;
  }

  function paused() { return !K.$('pauseBadge').hidden; }

  function state() {
    if (K.player.isOpen()) { return 'Player'; }
    var s = K.app.current(), name = s && s.name;
    return name === 'search' ? 'Search' : name === 'settings' ? 'Setting' : 'List';
  }

  // The spoken words, from the term object the assistant hands over.
  function spoken(term) {
    var v = '';
    try { v = webapis.voiceinteraction.getDataFromSearchTerm(term, 'SEARCH_TERM_UTTERANCE'); } catch (e) { /* older firmware */ }
    if (!v && term) { v = typeof term === 'string' ? term : term.utterance || term.title || ''; }
    return String(v || '').replace(/^\s+|\s+$/g, '');
  }

  // Search opens the way its tab in the top bar does, on top of whatever was showing.
  function search(term) {
    var said = spoken(term), s;
    if (!said) { return false; }
    if (K.modal.isOpen()) { K.modal.close(); }
    if (K.player.isOpen()) { K.player.close(); }
    document.querySelector('#nav [data-go="search"]')._select();
    s = K.app.current();
    if (s && s.voice) { s.voice(said); }
    return true;
  }

  try {
    if (window.webapis && webapis.voiceinteraction) {
      webapis.voiceinteraction.setCallback({
        onupdatestate: state,
        onsearch: search,
        onnavigation: function (dir) { return NAV[dir] ? press(NAV[dir]) : false; },
        // "Play this" in a list selects the focused card; other positions are left to the TV.
        onselection: function (n) { return n === 0 && !K.player.isOpen() ? press('enter') : false; },
        onplay: function () { return K.player.isOpen() ? (paused() ? press('play') : true) : false; },
        onpause: function () { return K.player.isOpen() ? (paused() ? true : press('pause')) : false; },
        onchangeprevioustrack: function () { return K.player.isOpen() ? press('chup') : false; },
        onchangenexttrack: function () { return K.player.isOpen() ? press('chdown') : false; }
      });
      webapis.voiceinteraction.listen();
      on = true;
    }
  } catch (e) { /* no voice on this TV, or the privilege is missing */ }

  K.voice = { available: function () { return on; } };
})(window.K);
