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

  // The mic key on the Search keyboard, for TVs where the remote's mic button wakes another
  // assistant (Alexa): the browser's own speech recognition, else the TV's keyboard, which has
  // a dictation mic of its own on these TVs. Either way the words come back through done().
  var field = null;
  function keyboard(done) {
    if (!field) {
      field = document.createElement('input');
      field.type = 'text';
      field.style.cssText = 'position:absolute;left:-2000px;top:0;width:10px;opacity:0';
      document.body.appendChild(field);
    }
    var prev = document.activeElement;
    function finish(e) {
      // 65376 is the TV keyboard's Done, 65385 its Cancel; a blur is the keyboard closing.
      if (e.type === 'keydown' && e.keyCode !== 65376 && e.keyCode !== 65385) { return; }
      var said = e.keyCode === 65385 ? '' : field.value;
      field.removeEventListener('keydown', finish);
      field.removeEventListener('blur', finish);
      field.blur();
      if (prev && prev.focus) { prev.focus(); }
      if (said.replace(/\s+/g, '')) { done(said); }
    }
    field.value = '';
    field.addEventListener('keydown', finish);
    field.addEventListener('blur', finish);
    field.focus();
  }
  function dictate(done) {
    var R = window.SpeechRecognition || window.webkitSpeechRecognition, r, heard = false;
    if (!R) { keyboard(done); return; }
    try {
      r = new R();
      r.lang = K.prefs.language || 'en';
      r.onresult = function (e) { heard = true; done(e.results[0][0].transcript); };
      r.onerror = r.onend = function () { if (!heard) { heard = true; keyboard(done); } };
      r.start();
    } catch (e) { keyboard(done); }
  }

  K.voice = { available: function () { return on; }, dictate: dictate };
})(window.K);
