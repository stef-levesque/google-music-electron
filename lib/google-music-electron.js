// Load in our dependencies
var app = require('electron').app;
var BrowserWindow = require('electron').BrowserWindow;
var ipcMain = require('electron').ipcMain;
var monogamous = require('monogamous');
var _ = require('underscore');
var replify = require('replify');
var assets = require('./assets');
var appMenu = require('./app-menu');
var appTray = require('./app-tray');
var Config = require('./config');
var getLogger = require('./logger');
var shortcuts = require('./shortcuts');
var mpris;
try {
  mpris = require('./mpris');
} catch (err) {
  // Optionally allow `mpris` to be installed
}

// Load in package info and process our CLI
var pkg = require('../package.json');
var program = require('./cli-parser').parse(process.argv);

// Generate a logger
var logger = getLogger({verbose: program.verbose});

// Log our CLI arguments
logger.debug('CLI arguments received', {argv: process.argv});

// When all Windows are closed
app.on('window-all-closed', function handleWindowsClosed () {
  // If we are not on OSX, exit
  // DEV: OSX requires users to quit via the menu/cmd+q
  if (process.platform !== 'darwin') {
    logger.debug('All windows closed. Exiting application');
    app.quit();
  } else {
    logger.debug('All windows closed but not exiting because OSX');
  }
});

// Generate a config based on our CLI arguments
// DEV: We need to build cliConfig off of options since we are using `camelCase` from `commander`
// https://github.com/tj/commander.js/blob/v2.9.0/index.js#L1046-L1050
function camelcase(flag) {
  return flag.split('-').reduce(function (str, word) {
    return str + word[0].toUpperCase() + word.slice(1);
  });
}
var cliConfig = _.object(program._cliConfigKeys.map(function getCliValue (dashCaseKey) {
  var camelCaseKey = camelcase(dashCaseKey);
  return [dashCaseKey, program[camelCaseKey]];
}));
logger.debug('CLI options overriding config', cliConfig);
var config = new Config(cliConfig, program._cliInfo);
logger.debug('Generated starting config options', config.getAll());

// Define helpers for controlling/sending messages to our window
// https://github.com/atom/electron-starter/blob/96f6117b4c1f33c0881d504d655467fc049db433/src/browser/application.coffee#L87-L104
// DEV: We are choosing to dodge classes to avoid `.bind` calls
// DEV: This must be in the top level scope, otherwise our window gets GC'd
var gme = {
  browserWindow: null,
  config: config,
  controlPlayPause: function () {
    if (gme.browserWindow && gme.browserWindow.webContents) {
      logger.debug('Sending `control:play-pause` to browser window');
      gme.browserWindow.webContents.send('control:play-pause');
    } else {
      logger.debug('`control:play-pause` requested but couldn\'t find browser window');
    }
  },
  controlNext: function () {
    if (gme.browserWindow && gme.browserWindow.webContents) {
      logger.debug('Sending `control:next` to browser window');
      gme.browserWindow.webContents.send('control:next');
    } else {
      logger.debug('`control:next` requested but couldn\'t find browser window');
    }
  },
  controlPrevious: function () {
    if (gme.browserWindow && gme.browserWindow.webContents) {
      logger.debug('Sending `control:previous` to browser window');
      gme.browserWindow.webContents.send('control:previous');
    } else {
      logger.debug('`control:previous` requested but couldn\'t find browser window');
    }
  },
  logger: logger,
  openAboutWindow: function () {
    logger.debug('Showing `about` window for `google-music-electron`');
    var info = [
      // https://github.com/corysimmons/typographic/blob/2.9.3/scss/typographic.scss#L34
      '<div style="text-align: center; font-family: \'Helvetica Neue\', \'Helvetica\', \'Arial\', \'sans-serif\'">',
        '<h1>google-music-electron</h1>',
        '<p>',
          'Version: ' + pkg.version,
          '<br/>',
          'Electron version: ' + process.versions.electron,
          '<br/>',
          'Node.js version: ' + process.versions.node,
          '<br/>',
          'Chromium version: ' + process.versions.chrome,
        '</p>',
      '</div>'
    ].join('');
    // DEV: aboutWindow will be garbage collection automatically
    var aboutWindow = new BrowserWindow({
      height: 180,
      icon: assets['icon-32'],
      width: 400
    });
    aboutWindow.loadURL('data:text/html,' + info);
  },
  openConfigWindow: function () {
    logger.debug('Showing `config` window for `google-music-electron`');
    // DEV: configWindow will be garbage collection automatically
    var configWindow = new BrowserWindow({
      height: 440,
      icon: assets['icon-32'],
      width: 620
    });
    configWindow.loadURL('file://' + __dirname + '/views/config.html');
  },
  quitApplication: function () {
    logger.debug('Exiting `google-music-electron`');
    app.quit();
  },
  reloadWindow: function () {
    logger.debug('Reloading focused browser window');
    BrowserWindow.getFocusedWindow().reload();
  },
  showMinimizedWindow: function () {
    // DEV: Focus is necessary when there is no taskbar and we have lost focus for the app
    gme.browserWindow.restore();
    gme.browserWindow.focus();
  },
  showInvisibleWindow: function () {
    gme.browserWindow.show();
  },
  toggleDevTools: function () {
    logger.debug('Toggling developer tools in focused browser window');
    BrowserWindow.getFocusedWindow().toggleDevTools();
  },
  toggleFullScreen: function () {
    var focusedWindow = BrowserWindow.getFocusedWindow();
    // Move to other full screen state (e.g. true -> false)
    var wasFullScreen = focusedWindow.isFullScreen();
    var toggledFullScreen = !wasFullScreen;
    logger.debug('Toggling focused browser window full screen', {
      wasFullScreen: wasFullScreen,
      toggledFullScreen: toggledFullScreen
    });
    focusedWindow.setFullScreen(toggledFullScreen);
  },
  toggleMinimize: function () {
    if (gme.browserWindow) {
      var isMinimized = gme.browserWindow.isMinimized();
      logger.debug('Toggling browser window minimization', {
        isMinimized: isMinimized
      });
      if (isMinimized) {
        gme.showMinimizedWindow();
      } else {
        gme.browserWindow.minimize();
      }
    } else {
      logger.debug('Browser window minimization toggling requested but browser window as not found');
    }
  },
  toggleVisibility: function () {
    if (gme.browserWindow) {
      var isVisible = gme.browserWindow.isVisible();
      logger.debug('Toggling browser window visibility', {
        isVisible: isVisible
      });
      if (isVisible) {
        gme.browserWindow.hide();
      } else {
        gme.showInvisibleWindow();
      }
    } else {
      logger.debug('Browser window visibility toggling requested but browser window as not found');
    }
  },
  prevBounds: null,
  toggleMiniplayer: function () {
    if (gme.browserWindow) {
      if (gme.prevBounds) {
        // Restore
        gme.browserWindow.webContents.setZoomFactor(1);
        gme.browserWindow.webContents.insertCSS("#player{-webkit-app-region: no-drag}")
        gme.browserWindow.setBounds(gme.prevBounds, true);
        gme.browserWindow.setResizable(true);
        gme.prevBounds = null;
      } else {
        // Mini
        gme.prevBounds = gme.browserWindow.getBounds();
        const zoom = 0.5;
        const width = 820 * zoom;
        var height = 90 * zoom;
        if (!config.get('frameless'))
          height += 12;

        gme.browserWindow.webContents.setZoomFactor(zoom);
        gme.browserWindow.webContents.insertCSS("#player{-webkit-app-region: drag}")
        gme.browserWindow.setSize(width, height, true);
        gme.browserWindow.setResizable(false);
      }
    }
  },
  alwaysOnTop: function(menuItem) {
    if (gme.browserWindow) {
      gme.browserWindow.setAlwaysOnTop(menuItem.checked);
    }
  },
  visibleOnAllWorkspaces: function(menuItem) {
    if (gme.browserWindow) {
      gme.browserWindow.setVisibleOnAllWorkspaces(menuItem.checked);
    }
  }
};

// Assign tray click behavior
gme.onTrayClick = (config.get('hide-via-tray') || config.get('minimize-to-tray')) ?
  gme.toggleVisibility : gme.toggleMinimize;
gme.onRaise = (config.get('hide-via-tray') || config.get('minimize-to-tray')) ?
  gme.showInvisibleWindow : gme.showMinimizedWindow;

// Define our launch handler
function launchGme() {
  // Create our browser window for Google Music
  var windowOpts = {
    height: 920,
    icon: assets['icon-32'],
    // Load in our Google Music bindings on the page
    preload: __dirname + '/browser.js',
    'skip-taskbar': config.get('skip-taskbar'),
    'frame': !config.get('frameless'),
    'use-content-size': true,
    width: 1024
  };
  logger.info('App ready. Opening Google Music window', {
    options: windowOpts,
    processVersions: process.versions,
    version: pkg.version
  });
  gme.browserWindow = new BrowserWindow(windowOpts);
  gme.browserWindow.loadURL('https://play.google.com/music/listen');

  // If hiding to tray was requested, trigger a visibility toggle when the window is minimized
  if (config.get('minimize-to-tray')) {
    gme.browserWindow.on('minimize', gme.toggleVisibility);
  }

  // When our window is closed, clean up the reference to our window
  gme.browserWindow.on('closed', function handleWindowClose () {
    logger.debug('Browser window closed, garbage collecting `browserWindow`');
    gme.browserWindow = null;
  });
  
  ipcMain.on('toggle-miniplayer', gme.toggleMiniplayer);

  // Save browser window context to replify
  // http://dshaw.github.io/2012-10-nodedublin/#/
  if (program.debugRepl) {
    var replServer = replify('google-music-electron', null, {gme: gme});
    replServer.on('listening', function handleReplServerListen () {
      var socketPath = replServer.address();
      logger.info('Debug repl opened at "%s". This should be accessible via `npm run debug-repl`', socketPath);
    });
  }

  // Set up our application menu, tray, and shortcuts
  appMenu.init(gme);
  appTray.init(gme);
  shortcuts.init(gme);
  if (mpris) {
    mpris.init(gme);
  }
}

// If we are only allowing single instances
var booter;
if (!config.get('allow-multiple-instances')) {
  // Start up/connect to a monogamous server (detects other instances)
  booter = monogamous({sock: pkg.name});

  // If we are the first instance, start up gme
  booter.on('boot', launchGme);

  // Otherwise, focus it
  booter.on('reboot', gme.onRaise);

  // If we encounter an error, log it and start anyway
  booter.on('error', function handleError (err) {
    logger.error('Error while starting/connecting to monogamous server', err);
    logger.info('Ignoring monogamous error, starting google-music-electron');
    launchGme();
  });
}

// When Electron is done loading
app.on('ready', function handleReady () {
  // If we have a booter, invoke it
  if (booter) {
    booter.boot();
  // Otherwise, launch immediately
  } else {
    launchGme();
  }
});
