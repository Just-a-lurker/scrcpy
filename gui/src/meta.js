// Hand-curated presentation metadata layered over options.json.
// Enum values are taken from the parse_* functions in app/src/cli.c, not from
// the help text, so every choice offered here is one scrcpy accepts.
(function (root) {
  const ORIENTATIONS = ['0', '90', '180', '270', 'flip0', 'flip90', 'flip180', 'flip270'];

  const meta = {
    categories: [
      { id: 'quick', label: 'Quick setup', blurb: 'What most sessions need. Everything else is under All options.' },
      { id: 'connection', label: 'Connection', blurb: 'Which device to reach and how scrcpy talks to adb.' },
      { id: 'video', label: 'Video', blurb: 'What gets captured on the device and how it is encoded.' },
      { id: 'audio', label: 'Audio', blurb: 'Audio capture, codec and playback buffering.' },
      { id: 'camera', label: 'Camera', blurb: 'Used when the video source is set to camera (Android 12+).' },
      { id: 'window', label: 'Window', blurb: 'The mirroring window on this PC and how frames are drawn in it.' },
      { id: 'virtual', label: 'Virtual display', blurb: 'Mirror a new, separate display instead of the phone screen.' },
      { id: 'input', label: 'Input', blurb: 'Keyboard, mouse, gamepad and clipboard forwarding.' },
      { id: 'device', label: 'Device', blurb: 'What happens on the phone itself while mirroring.' },
      { id: 'recording', label: 'Recording', blurb: 'Save the stream to a file or a V4L2 sink.' },
      { id: 'general', label: 'General', blurb: 'Logging and process behaviour.' },
    ],

    // option key -> category id. Option keys are long names, or "-X" for
    // short-only flags.
    category: {
      serial: 'connection', 'select-usb': 'connection', 'select-tcpip': 'connection', tcpip: 'connection',
      port: 'connection', 'force-adb-forward': 'connection', 'tunnel-host': 'connection',
      'tunnel-port': 'connection', 'kill-adb-on-close': 'connection', otg: 'connection',

      'video-source': 'video', 'video-codec': 'quick', 'video-bit-rate': 'quick', 'video-codec-options': 'video',
      'video-encoder': 'video', 'max-size': 'video', 'max-fps': 'quick', 'min-size-alignment': 'video',
      crop: 'video', angle: 'video', 'capture-orientation': 'video', 'display-id': 'video', 'no-video': 'video',
      'no-video-playback': 'video', 'video-buffer': 'quick', 'ignore-video-encoder-constraints': 'quick',
      'no-downsize-on-error': 'video', 'print-fps': 'video', hwdec: 'video',

      'audio-bit-rate': 'audio', 'audio-buffer': 'audio', 'audio-codec': 'audio', 'audio-codec-options': 'audio',
      'audio-dup': 'audio', 'audio-encoder': 'audio', 'audio-source': 'audio', 'audio-output-buffer': 'audio',
      'no-audio': 'audio', 'no-audio-playback': 'audio', 'require-audio': 'audio',

      'camera-ar': 'camera', 'camera-facing': 'camera', 'camera-fps': 'camera', 'camera-high-speed': 'camera',
      'camera-id': 'camera', 'camera-size': 'camera', 'camera-torch': 'camera', 'camera-zoom': 'camera',

      'always-on-top': 'window', fullscreen: 'window', 'window-borderless': 'window', 'window-title': 'window',
      'window-x': 'window', 'window-y': 'window', 'window-width': 'window', 'window-height': 'window',
      'no-window': 'window', 'no-window-aspect-ratio-lock': 'window', 'background-color': 'window',
      'render-driver': 'window', 'render-fit': 'window', 'display-orientation': 'window', orientation: 'window',
      'disable-screensaver': 'window', 'no-mipmaps': 'window', 'no-terminal-title': 'window',

      'new-display': 'virtual', 'display-ime-policy': 'virtual', 'no-vd-destroy-content': 'virtual',
      'no-vd-system-decorations': 'virtual', 'flex-display': 'virtual',

      keyboard: 'input', mouse: 'input', gamepad: 'input', '-K': 'input', '-M': 'input', '-G': 'input',
      'mouse-bind': 'input', 'no-control': 'input', 'no-key-repeat': 'input', 'no-mouse-hover': 'input',
      'prefer-text': 'input', 'raw-key-events': 'input', 'legacy-paste': 'input',
      'no-clipboard-autosync': 'input', 'shortcut-mod': 'input',

      'start-app': 'quick', 'turn-screen-off': 'quick', 'stay-awake': 'quick', 'show-touches': 'device', 'keep-active': 'device',
      'power-off-on-close': 'quick', 'no-power-on': 'device', 'screen-off-timeout': 'device',
      'push-target': 'device', 'no-cleanup': 'device',

      record: 'recording', 'record-format': 'recording', 'record-orientation': 'recording',
      'time-limit': 'recording', 'no-playback': 'recording', 'v4l2-sink': 'recording', 'v4l2-buffer': 'recording',

      verbosity: 'general', 'pause-on-exit': 'general',
    },

    // Shown first within their group, in this order; the rest follow in
    // cli.c order.
    pinned: [
      'start-app', 'video-codec', 'video-bit-rate', 'ignore-video-encoder-constraints', 'max-fps', 'video-buffer',
      'turn-screen-off', 'stay-awake', 'power-off-on-close',
      'serial', 'tcpip', 'select-usb', 'select-tcpip',
      'video-source', 'max-size', 'video-bit-rate', 'max-fps', 'video-codec',
      'audio-source', 'no-audio', 'audio-codec',
      'camera-facing', 'camera-id', 'camera-size',
      'window-title', 'fullscreen', 'always-on-top', 'window-borderless',
      'new-display',
      'keyboard', 'mouse', 'gamepad',
      'start-app', 'turn-screen-off', 'stay-awake',
      'record', 'record-format', 'time-limit',
    ],

    // Options that print something and exit. They run on their own from the
    // Device info panel instead of being part of the mirroring command.
    actions: ['list-displays', 'list-cameras', 'list-camera-sizes', 'list-encoders', 'list-apps', 'version', 'help'],

    // Strict choices (rendered as a select).
    enums: {
      'video-codec': ['h264', 'h265', 'av1', 'vp8', 'vp9'],
      'audio-codec': ['opus', 'aac', 'flac', 'raw'],
      'video-source': ['display', 'camera'],
      'audio-source': ['output', 'playback', 'mic', 'mic-unprocessed', 'mic-camcorder', 'mic-voice-recognition',
        'mic-voice-communication', 'voice-call', 'voice-call-uplink', 'voice-call-downlink', 'voice-performance'],
      'camera-facing': ['front', 'back', 'external'],
      keyboard: ['disabled', 'sdk', 'uhid', 'aoa'],
      mouse: ['disabled', 'sdk', 'uhid', 'aoa'],
      gamepad: ['disabled', 'uhid', 'aoa'],
      'display-ime-policy': ['local', 'fallback', 'hide'],
      'display-orientation': ORIENTATIONS,
      'record-orientation': ORIENTATIONS,
      orientation: ORIENTATIONS,
      'record-format': ['mp4', 'mkv', 'm4a', 'mka', 'opus', 'aac', 'flac', 'wav'],
      'render-fit': ['letterbox', 'stretched', 'unscaled'],
      hwdec: ['auto', 'disabled', 'd3d11va', 'vaapi', 'videotoolbox'],
      verbosity: ['verbose', 'debug', 'info', 'warn', 'error'],
      'pause-on-exit': ['true', 'false', 'if-error'],
    },

    // Values that only work on another OS. Shown, but marked.
    enumPlatform: {
      hwdec: { vaapi: 'Linux', videotoolbox: 'macOS', d3d11va: 'Windows' },
    },

    // Free-text fields with suggestions (rendered with a datalist).
    suggestions: {
      'capture-orientation': [...ORIENTATIONS, ...ORIENTATIONS.map((o) => '@' + o), '@'],
      'render-driver': ['direct3d', 'opengl', 'opengles2', 'opengles', 'software'],
      'shortcut-mod': ['lalt,lsuper', 'lctrl', 'rctrl', 'lalt', 'ralt', 'lsuper', 'rsuper', 'lctrl,lsuper', 'lctrl+lshift'],
      'mouse-bind': ['bhsn:++++', '++++:bhsn', '++++', '----'],
      'video-bit-rate': ['2M', '4M', '8M', '16M', '24M'],
      'audio-bit-rate': ['64K', '128K', '192K', '256K'],
      'max-size': ['720', '1024', '1280', '1600', '1920'],
      'max-fps': ['15', '30', '60', '90', '120'],
      'camera-ar': ['sensor', '4:3', '16:9', '1:1'],
      'new-display': ['1920x1080', '1920x1080/420', '1280x720', '/240'],
      'background-color': ['#222', '#000', '#fff'],
    },

    // Fields that take a file path on this PC.
    savePath: ['record'],

    // Options a Windows build of scrcpy rejects.
    unsupported: {
      'v4l2-sink': 'Linux only. A Windows build of scrcpy rejects this option.',
      'v4l2-buffer': 'Linux only. A Windows build of scrcpy rejects this option.',
    },

    // Friendlier labels where the flag name reads poorly.
    labels: {
      '-K': 'Physical keyboard (UHID/AOA)',
      '-M': 'Physical mouse (UHID/AOA)',
      '-G': 'Physical gamepad (UHID/AOA)',
      'select-usb': 'Use the USB device',
      'select-tcpip': 'Use the TCP/IP device',
      tcpip: 'Connect over TCP/IP',
      'video-bit-rate': 'Video bit rate',
      'audio-bit-rate': 'Audio bit rate',
      'max-fps': 'Max FPS',
      'camera-fps': 'Camera FPS',
      'camera-ar': 'Camera aspect ratio',
      'camera-id': 'Camera ID',
      'display-id': 'Display ID',
      'display-ime-policy': 'Display IME policy',
      'print-fps': 'Print FPS',
      hwdec: 'Hardware decoding',
      'ignore-video-encoder-constraints': 'Exact video size (sharper)',
      'no-vd-destroy-content': 'Keep virtual display apps on close',
      'no-vd-system-decorations': 'No virtual display decorations',
      'v4l2-sink': 'V4L2 sink',
      'v4l2-buffer': 'V4L2 buffer',
      otg: 'OTG mode',
      'tunnel-host': 'Tunnel host',
      'tunnel-port': 'Tunnel port',
      'flex-display': 'Flexible display',
    },
  };

  root.ScrcpyMeta = meta;
  if (typeof module !== 'undefined' && module.exports) module.exports = meta;
})(typeof globalThis !== 'undefined' ? globalThis : this);
