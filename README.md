# @smoud/ffmpeg

[![npm version](https://img.shields.io/npm/v/@smoud/ffmpeg.svg)](https://www.npmjs.com/package/@smoud/ffmpeg)
[![npm downloads](https://img.shields.io/npm/dw/@smoud/ffmpeg.svg)](https://www.npmjs.com/package/@smoud/ffmpeg)
[![node](https://img.shields.io/node/v/@smoud/ffmpeg.svg)](https://www.npmjs.com/package/@smoud/ffmpeg)
[![dependencies](https://img.shields.io/badge/dependencies-0-brightgreen.svg)](https://www.npmjs.com/package/@smoud/ffmpeg?activeTab=dependencies)
[![license](https://img.shields.io/npm/l/@smoud/ffmpeg.svg)](https://github.com/smoudjs/ffmpeg/blob/master/LICENSE)

ffmpeg binaries for macOS, Linux, Windows and FreeBSD. Uses the ffmpeg you already have, or downloads a verified build once per machine.

- **Uses the ffmpeg you already have.** If `ffmpeg` is on the PATH, nothing is downloaded.
- **Downloads once per machine, not once per project.** The build goes into your user cache folder and every project shares it, instead of a 30 MB copy in each `node_modules`.
- **Only when needed.** No postinstall script: the download happens the first time ffmpeg is actually used.
- **Verified.** Every download is checked against a sha256 pinned in the code.
- **No dependencies.** Works behind a proxy through `HTTPS_PROXY`, on every supported Node version.

## Install

```sh
npm install @smoud/ffmpeg
```

Requires Node 20.9 or newer.

## Usage

```js
import { findFfmpeg, runFfmpeg } from '@smoud/ffmpeg';

// where ffmpeg is and which version it is
const { path, version } = await findFfmpeg();

// convert files
await runFfmpeg(['-y', '-i', 'music.wav', '-c:a', 'libmp3lame', '-b:a', '128k', 'music.mp3']);

// or pipe data through it
const { stdout } = await runFfmpeg(['-i', 'pipe:0', '-c:a', 'libopus', '-f', 'ogg', 'pipe:1'], wavBuffer);
```

CommonJS works the same way:

```js
const { findFfmpeg, runFfmpeg } = require('@smoud/ffmpeg');
```

## Command line

`smoud-ffmpeg` runs ffmpeg with your arguments exactly as you typed them:

```sh
npx @smoud/ffmpeg -i music.wav music.mp3
```

Or install it globally and call it by name:

```sh
npm install -g @smoud/ffmpeg
smoud-ffmpeg -i music.wav -c:a libopus music.ogg
```

In npm scripts, with the package in your dependencies:

```json
"scripts": {
  "audio": "smoud-ffmpeg -y -i music.wav music.mp3"
}
```

- ffmpeg is found or downloaded the same way as with the API.
- Pipes work: `cat music.wav | smoud-ffmpeg -i pipe:0 -f mp3 pipe:1 > music.mp3`.
- The exit code is ffmpeg's exit code.
- Ctrl+C goes to ffmpeg, which finishes writing its output before it exits.

## How ffmpeg is found

1. The `FFMPEG_PATH` environment variable.
2. `ffmpeg` on the PATH.
3. A copy downloaded earlier into the cache folder.
4. A fresh download into the cache folder.

The cache folder is:

| OS      | Folder                                                      |
| ------- | ----------------------------------------------------------- |
| Windows | `%LOCALAPPDATA%\smoud-ffmpeg\ffmpeg-<version>\`             |
| macOS   | `~/Library/Caches/smoud-ffmpeg/ffmpeg-<version>/`           |
| Linux   | `$XDG_CACHE_HOME/smoud-ffmpeg/ffmpeg-<version>/` or `~/.cache/smoud-ffmpeg/ffmpeg-<version>/` |

Deleting it is safe: the next run downloads ffmpeg again.

## Platforms

| Platform     | ffmpeg |
| ------------ | ------ |
| darwin-arm64 | 6.1.1  |
| darwin-x64   | 6.1.1  |
| linux-x64    | 6.1.1  |
| linux-ia32   | 6.1.1  |
| linux-arm64  | 6.1.1  |
| linux-arm    | 6.1.1  |
| win32-x64    | 6.1.1  |
| win32-ia32   | 6.0    |
| freebsd-x64  | 6.0    |

Windows on Arm uses the x64 build. On any other platform, install ffmpeg yourself or set `FFMPEG_PATH`.

## Environment variables

| Variable      | Effect                                                           |
| ------------- | ---------------------------------------------------------------- |
| `FFMPEG_PATH` | Use this ffmpeg binary. Nothing is looked up or downloaded.      |
| `HTTPS_PROXY` | Download through this proxy, e.g. `http://user:pass@proxy:8080`. |
| `NO_PROXY`    | Hosts that skip the proxy, e.g. `localhost,.example.com`.        |

If the download fails, the error says what went wrong and how to fix it: set `FFMPEG_PATH`, install ffmpeg, or set `HTTPS_PROXY`.

## CI

The first run on a fresh machine downloads ffmpeg (about 20–30 MB, a few seconds). To skip that on every job, install ffmpeg on the runner or cache the folder. For GitHub Actions on Linux:

```yaml
- uses: actions/cache@v4
  with:
    path: ~/.cache/smoud-ffmpeg
    key: smoud-ffmpeg-${{ runner.os }}-${{ runner.arch }}
```

## API

### `findFfmpeg(): Promise<{ path, version }>`

Finds ffmpeg as described above. `path` is what to spawn; `version` is what ffmpeg reports, e.g. `6.1.1-essentials_build-www.gyan.dev`. The lookup runs once per process; if it fails, the next call tries again.

### `runFfmpeg(args, input?): Promise<{ stdout, stderr }>`

Runs ffmpeg with `args`, adding `-hide_banner` in front. `input` (a Buffer) is written to ffmpeg's stdin. Resolves with stdout as a Buffer and ffmpeg's log as a string. If ffmpeg fails, it rejects with the last 3 lines of its log.

## License

This package is MIT licensed.

The ffmpeg binaries it downloads are not part of this package. They are GPL licensed static builds, hosted unchanged in the [builds-6.1.1](https://github.com/smoudjs/ffmpeg/releases/tag/builds-6.1.1) release of this repository. Thanks to the people who build them:

| Platform     | Built by                                                                       |
| ------------ | ------------------------------------------------------------------------------ |
| win32-x64    | [gyan.dev](https://www.gyan.dev/ffmpeg/builds/)                                |
| win32-ia32   | [sudo-nautilus](https://github.com/sudo-nautilus/FFmpeg-Builds-Win32)          |
| linux-*      | [johnvansickle.com](https://johnvansickle.com/ffmpeg/)                         |
| darwin-x64   | [evermeet.cx](https://evermeet.cx/ffmpeg/)                                     |
| darwin-arm64 | [osxexperts.net](https://www.osxexperts.net/)                                  |
| freebsd-x64  | [Thefrank](https://github.com/Thefrank/ffmpeg-static-freebsd)                  |

Each build in the release comes with a `<platform>.LICENSE` file and, where the builder provided one, a `<platform>.README` that says which source it was built from. The ffmpeg source code is available at [ffmpeg.org](https://ffmpeg.org/download.html).
