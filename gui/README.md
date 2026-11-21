# scrcpy Launcher

An Electron desktop front-end for scrcpy. Every command-line flag of the scrcpy
in this repository appears as a form control. The app builds the command,
shows it live, and runs `scrcpy.exe` for you.

## Run

```sh
cd gui
npm install
npm start
```

Electron 45 is used. npm 11 may skip Electron's download step; if
`node_modules/electron/dist/electron.exe` is missing after `npm install`, run
`node node_modules/electron/install.js`.

The app looks for `scrcpy.exe` in this order: the path you picked with
**Change…** (bottom of the sidebar), next to the launcher (or next to the
portable .exe), `../build*/app/`, then `PATH`. The Windows release zip
works: point it at the `scrcpy.exe` inside it, and `adb.exe` next to it is
used for the device list.

## Build

```sh
npm run pack
```

This writes `dist/win-unpacked/`, a folder that runs without installing: start
`scrcpy Launcher.exe` inside it. Nothing is compressed or unpacked, so it
builds in seconds and starts at once. Copy `scrcpy.exe` (with the files from
the scrcpy release) into that folder and the launcher finds it by itself. The
build is unsigned, and the development screenshot hooks are disabled in it.

Close the launcher before rebuilding, because the build replaces that folder.

### Portable .exe (optional)

```sh
npx electron-builder --win portable
```

This writes `dist/scrcpy-launcher-<version>-portable.exe`, a single file you
can copy anywhere; put it next to `scrcpy.exe` and it finds scrcpy by itself.
It takes a few minutes to build, because everything is compressed, and on
every launch it unpacks the whole app (about 360 MB) to a folder under
`%TEMP%`, deleting it on exit. For everyday use, the folder build is faster.

## Test

```sh
npm test
```

Covers the flag builder, the app-list and encoder-list parsers, the
screen-fit math, the flags the Fill-the-monitor cards and the picture presets
write, the error messages (against scrcpy's exact wording), and every check
the main process applies to values before they reach adb.

## How the options stay in sync

`src/options.json` and `src/options.js` are generated from the `options[]`
table in `app/src/cli.c`:

```sh
npm run extract
```

Re-run it after pulling upstream changes. `src/meta.js` adds the presentation
layer: groups, dropdown values (taken from the `parse_*` functions in `cli.c`),
suggestions, and Windows-only notes. `npm test` fails if a new flag has no group.

## Quick setup

Quick setup is four cards for what most sessions need. They edit the same
flags as the rows under All options, so the two always agree, and the command
line shows exactly what they set.

| Card | Sets |
| --- | --- |
| **Game** | `--start-app` (with **Choose app…**) and *Close it when I stop* |
| **Picture** | A preset, or the fields under **Details**: `--video-codec`, `--video-bit-rate`, `--video-buffer`, and the `video-qp-max` / `i-frame-interval` entries of `--video-codec-options` |
| **Screen** | A summary of Fill the monitor, with a link to change it |
| **Phone** | `--turn-screen-off`, `--stay-awake`, `--power-off-on-close` |

Picture presets (`src/presets.js`):

| Preset | Flags |
| --- | --- |
| USB sharp | H.265, 24M, `video-qp-max=30,i-frame-interval=2` |
| Wi-Fi smooth | H.265, 16M, `video-qp-max=34,i-frame-interval=5`, `--video-buffer=50` (a starting point, not tested) |
| scrcpy default | None of these flags: H.264 at 8 Mbps |

The active preset is read back from the flags. Any hand edit shows as
*Custom*, and picking a preset keeps codec options it does not own.

Next to **Start**, the status says whether a session can start: scrcpy.exe not
found, adb not available, phone not connected, phone waiting for USB debugging
approval, several phones, or *Ready* with the phone's name.

## Wireless debugging (adb pair)

**Pair over Wi-Fi…** next to the device picker opens a dialog for Android 11+ wireless
debugging:

1. On the phone, open Developer options › Wireless debugging › *Pair device
   with pairing code*. Enter the IP address, pairing port and 6-digit code in
   the dialog, then press **Pair**. The dialog runs `adb pair ip:port code`.
2. Enter the IP address and port from the main Wireless debugging screen,
   which is a different port from the pairing one, then press **Connect**.
   The dialog runs `adb connect ip:port` and selects the device for scrcpy.

**Find phones on this network** runs `adb mdns services` and fills in the
address and ports for you. After pairing, the dialog also looks up the
connection port by itself. You can paste `ip:port` into an IP field and it is
split for you.

## Fill the monitor (no black bars in landscape games)

Most phones are taller than 16:9 (for example 1080x2400 is 20:9). Mirrored in
landscape on a 1920x1080 monitor, the picture is 1920x864, which leaves 108 px
bars above and below. The **Fill the monitor** section shows the sizes it
detected and offers two methods. Each is an on/off switch, and turning one on
turns the other off.

Each card has its own **Resolution** (the monitor's size, the standard 16:9
sizes that fit on it, or a custom W × H) and its own **Fullscreen** switch:

- Fullscreen on: `--fullscreen`. A resolution below the monitor's is scaled up.
- Fullscreen off: `--window-width=W --window-height=H`, a normal window of
  exactly that size, like any Windows app.

The methods:

- **Virtual display (recommended).** Sets `--new-display=<W>x<H>` (keeping a
  `/dpi` suffix if you added one), then asks for the app to start. The game
  draws on a display of exactly that size. It clears `--display-id`,
  `--no-video`, `--crop` and a camera `--video-source`, because they cannot be
  combined with a virtual display. Needs Android 10 or newer.
- **Resize the phone screen.** For games that will not run on a second display.
  When mirroring starts, the launcher sets the phone's own screen to the
  resolution, in portrait (`adb shell wm size 1080x1920` for 1920 × 1080). For
  a resolution smaller than the phone's width, it also lowers the density in
  proportion (`wm density 293` for 1280 × 720 on a 440 dpi phone), so the
  Android UI keeps its size. Resolutions larger than the phone's screen are
  disabled.

  Before the first change, the phone's current size and density overrides
  are saved in the launcher's settings file. When mirroring stops, when the
  launcher quits, or when you press **Restore phone screen now**, exactly those
  values are put back, so a display-size setting chosen on the phone survives.
  If the phone cannot be reached at that moment, the record is kept and the
  restore happens the next time.

  **Orientation** on this card fixes a window that changes shape when the
  game turns landscape (the phone starts in portrait). *Landscape from the
  start* adds `--capture-orientation=@270`, so the video is landscape from the
  first frame, and locks the phone to landscape while mirroring
  (`settings put system user_rotation 1` with auto-rotate off). If the game
  shows upside down, choose *Landscape, upside down* (`@90`, rotation 3). The
  phone's previous rotation settings are saved and restored with the size and
  density. A virtual display is always landscape and does not need this.

### Exact video size

Many hardware encoders require sizes in multiples of 16. scrcpy then
rescales the picture to fit: 1080 rows become 1072, and 900 become 896.
Every frame is resampled, which makes it look slightly soft. When a card's
resolution is not a multiple of 16, the card also turns on
`--ignore-video-encoder-constraints` (shown in the Video group as *Exact video
size*), so the encoder gets the exact size. On a Redmi M2012K10C (MediaTek
HEVC encoder), a headless test recording came out at 1080x2400 with the flag,
and 1072x2400 without it. If a phone's encoder refuses the exact size, turn
the option off.

## Picking the start app

**Choose app…** on the Game card, or **Browse apps…** on the *Start app*
option (Device group), runs
`scrcpy --list-apps` with your connection options. It lists the launchable
apps under Installed, System and All, with search. Picking one sets
`--start-app=<package>`. Turn on *Restart the app if it is already running* to
add the `+` prefix. The list is parsed by `src/apps.js`, which handles app
names that contain line breaks.

## Close the app when mirroring stops

This is a launcher setting, not a scrcpy flag. When scrcpy exits, because you
closed the mirror window or pressed Stop, the launcher runs
`adb [-s serial] shell am force-stop <package>` for the Start app. The command
preview shows this as a `# when scrcpy exits:` line, and it is not included in
**Copy command**. A `?name` search value is resolved from the app list, so
browse the apps once. With `--new-display`, scrcpy already closes apps on the
virtual display unless `--no-vd-destroy-content` is set.

## Sharper scene changes

The Video group has two rows under *Video bit rate*, also under **Details** on
the Picture card, that tune the phone's video encoder. They are not scrcpy
flags. Each one writes its own entry into `--video-codec-options` and leaves
any other entries as written.

| Row | Writes | Effect |
| --- | --- | --- |
| *Limit blockiness* | `video-qp-max=<n>` (0–51) | Caps how coarse the encoder may compress, so the picture stays sharper after a scene change. Lower values are sharper but send bigger bursts of data. |
| *Full refresh every (s)* | `i-frame-interval=<n>` | Sends a full picture this often instead of every 10 s, so blur clears sooner. Each refresh is a large frame. |

On a Redmi M2012K10C (MediaTek HEVC encoder, 24 Mbps),
`video-qp-max=30,i-frame-interval=2` cut the blur after scene changes. That
encoder counts the refresh interval in frames at 60 fps, so at 30 fps the
real spacing is about twice as long. The bursts are harmless over USB but can
stutter over Wi-Fi; there, use a cap of 34–36 and a longer interval. Some
encoders ignore these keys. `bitrate-mode=2` (constant bitrate) broke
decoding on that phone ("No start code is found").

*Video encoder* is a list, not a text field. **Find…** runs
`scrcpy --list-encoders` and offers the phone's encoders for the chosen codec,
hardware first (`src/encoders.js`). A saved value the phone does not have is
marked as such.

## Running a session

- **Start** is disabled while a session starts, so a double click cannot
  launch two copies.
- **Stop** asks scrcpy to close like closing its window does, so it exits
  through its normal shutdown. It is forced only if it has not exited after 3
  seconds.
- If you change options while mirroring, **Restart to apply** appears next to
  Stop.
- The status shows the live frame rate when *Print FPS* is on.
- Common failures are explained above the command line with what to do: phone
  not allowed yet, no phone found, more than one phone, phone offline, video
  encoder refused the settings, a codec option typed into *Video encoder*, a
  stream the PC cannot decode (usually a bad codec option), virtual display not
  available, or an option the phone's Android version does not support.
- The command line is one line; **Show all** expands it. The log opens as a
  drawer under it; drag its top edge, or focus it and use the arrow keys, to
  resize it.
- The device list updates by itself when a phone is plugged in, unplugged,
  allowed, or drops off Wi-Fi (`adb track-devices`).

## Notes

- Flags are always passed as `--name=value`. The three optional-argument flags
  (`--new-display`, `--tcpip`, `--pause-on-exit`) only work in that form.
  Typing a value into one switches it on; *Pause on exit* is a single list
  (Off, On, or a mode).
- `--list-*`, `--version` and `--help` run on their own from **Device info**,
  with your connection options, and print to the log.
- `--v4l2-sink` and `--v4l2-buffer` are shown but marked Linux only.
- Profiles and the last-used options are saved in the app's user data folder
  (`%APPDATA%/scrcpy Launcher/settings.json`). The file is written to a
  temporary file first and then swapped in, and the previous good copy is kept
  as `settings.json.bak`. **Save** overwrites the selected profile; **Save
  as…** creates a new one.
- The page can only change its own settings (options, profiles, theme, last
  Wi-Fi address). The scrcpy path and the phone-restore record are kept by the
  main process.
- Theme: System, Light or Dark, at the bottom of the sidebar.
- Shortcuts: Ctrl+F focuses search, Ctrl+Enter starts or stops mirroring.
