// Load in our dependencies
var ipcRenderer = require('electron').ipcRenderer;
var GMusic = require('gmusic.js');

// When the DOM loads
// DEV: We load navigation here because otherwise we have a FOUC while our new icons load
window.addEventListener('DOMContentLoaded', function handleDOMLoad () {
  // Find our attachment point for nav buttons
  var leftNavContainer = document.querySelector('.top > #material-one-left');
  var navOpenEl = leftNavContainer ? leftNavContainer.querySelector('#left-nav-open-button') : null;

  // If there is one
  if (navOpenEl) {
    // Generate our buttons
    // https://github.com/google/material-design-icons
    // Match aria info for existing "back" button (role/tabindex given by Chrome/Polymer)
    // DEV: We use `nodeName` to to guarantee `sj-icon-button` or `paper-icon-button` on their respective pages
    var nodeName = navOpenEl.nodeName;
    var backEl = document.createElement(nodeName);
    backEl.setAttribute('aria-label', 'Back');
    backEl.setAttribute('icon', 'arrow-back');
    backEl.setAttribute('id', 'gme-back-button');
    var forwardEl = document.createElement(nodeName);
    forwardEl.setAttribute('aria-label', 'Forward');
    forwardEl.setAttribute('icon', 'arrow-forward');
    forwardEl.setAttribute('id', 'gme-forward-button');
    var shuffleEl = document.createElement(nodeName);
    shuffleEl.setAttribute('aria-label', 'Shuffle');
    shuffleEl.setAttribute('icon', 'av:shuffle');
    shuffleEl.setAttribute('id', 'gme-shuffle-button');
    var moveEl = document.createElement(nodeName);
    moveEl.setAttribute('aria-label', 'Move');
    moveEl.setAttribute('icon', 'open-with');
    moveEl.setAttribute('id', 'gme-move-button');

    // Apply one-off styles to repair positioning and padding
    // DEV: Taken from CSS styles on hidden "back" button
    var cssFixes = [
      'align-self: center;',
      'min-width: 24px;'
    ].join('');
    backEl.style.cssText = cssFixes;
    forwardEl.style.cssText = cssFixes;
    shuffleEl.style.cssText = cssFixes;
    moveEl.style.cssText = cssFixes + '-webkit-app-region: drag; cursor: move;';

    // Determine the current size of the menu button
    // 40px -> 40
    var navOpenElWidthStr = window.getComputedStyle(navOpenEl).width;
    var navOpenElWidthPx = parseInt(navOpenElWidthStr.replace(/px$/, ''), 10);

    // Increase the `min-width` for our leftNavContainer
    // 226px -> 226 -> 306px
    var leftNavContainerMinWidthStr = window.getComputedStyle(leftNavContainer).minWidth;
    var leftNavContainerMinWidthPx = parseInt(leftNavContainerMinWidthStr.replace(/px$/, ''), 10);
    leftNavContainer.style.minWidth = (leftNavContainerMinWidthPx + (navOpenElWidthPx * 4)) + 'px';
    
    // Change the html `min-width` to 820px for Miniplayer
    document.documentElement.style.minWidth = '820px';

    // Attach event listeners
    backEl.addEventListener('click', function onBackClick () {
      window.history.go(-1);
    });
    forwardEl.addEventListener('click', function onBackClick () {
      window.history.go(1);
    });
    shuffleEl.addEventListener('click', function onShuffleClick () {
      var shuffle = document.querySelector('paper-button[data-id="shuffle-my-library"]');
      if (shuffle) {
        shuffle.click();
      }
    });

    // Expose our buttons adjacent to the hidden back element
    navOpenEl.parentNode.insertBefore(moveEl, navOpenEl.nextSibling);
    navOpenEl.parentNode.insertBefore(shuffleEl, moveEl)
    navOpenEl.parentNode.insertBefore(forwardEl, shuffleEl);
    navOpenEl.parentNode.insertBefore(backEl, forwardEl);
    console.info('Added navigation buttons');
    
    function hookMiniplayer() {
      var showMiniplayer = document.querySelector('#player paper-icon-button[data-id="show-miniplayer"]');
      if (showMiniplayer) {
        showMiniplayer.setAttribute('icon', 'picture-in-picture');
        var miniplayerBtn = document.createElement('a');
        miniplayerBtn.setAttribute('href', '#');
        miniplayerBtn.style.cssText = [
            'position: absolute;',
            'top: 0;',
            'right: 0;',
            'margin: 0;',
            'width: 32px;',
            'height: 32px;',
            'z-index: 100'
          ].join('');
        showMiniplayer.parentNode.insertBefore(miniplayerBtn, showMiniplayer);
        miniplayerBtn.addEventListener('click', function(){
          ipcRenderer.send('toggle-miniplayer');
        });
      } else {
        return setTimeout(hookMiniplayer, 1000);
      }
    }
    hookMiniplayer();

  } else {
    console.error('Failed to find navigation button');
  }
});

// When we finish loading
// DEV: We must wait until the UI fully loads otherwise mutation observers won't bind
// DEV: Even with the `onload` event, we still could not have JS fully loaded so use a setTimeout loop
var loadAttempts = 0;
function handleLoad() {
  // Try to bind GMusic to the UI
  var gmusic;
  try {
    gmusic = new GMusic(window);
    console.info('Successfully initialized `GMusic`');
  // If there was an error
  } catch (err) {
    // If this is our 60th attempt (i.e. 1 minute of failures), then throw the error
    if (loadAttempts > 60) {
      throw err;
    // Otherwise, try again in 1 second
    } else {
      console.info('Failed to initialize `GMusic`. Trying again in 1 second');
      loadAttempts += 1;
      return setTimeout(handleLoad, 1000);
    }
  }

  // Forward events over `ipc`
  var events = ['change:song', 'change:playback', 'change:playback-time'];
  events.forEach(function bindForwardEvent (event) {
    gmusic.on(event, function forwardEvent (data) {
      // Send same event with data (e.g. `change:song` `GMusic.Playback.PLAYING`)
      ipcRenderer.send(event, data);
    });
  });

  // When we receive requests to control playback, run them
  ipcRenderer.on('control:play-pause', function handlePlayPause (evt) {
    gmusic.playback.playPause();
  });
  ipcRenderer.on('control:next', function handleNext (evt) {
    gmusic.playback.forward();
  });
  ipcRenderer.on('control:previous', function handlePrevious (evt) {
    gmusic.playback.rewind();
  });
}
window.addEventListener('load', handleLoad);
