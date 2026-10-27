/// <reference types="node" />

/** An ffmpeg ready to run. */
export interface Ffmpeg {
  /** What to spawn: the FFMPEG_PATH value, `ffmpeg` when it comes from the PATH, or the downloaded file. */
  path: string;
  /** The version ffmpeg reports, e.g. `6.1.1`. Another version may encode other bytes, so it suits cache keys. */
  version: string;
}

/**
 * Finds an ffmpeg to run, in this order:
 * 1. the `FFMPEG_PATH` environment variable
 * 2. `ffmpeg` on the PATH
 * 3. a copy downloaded earlier into the user's cache folder (`%LOCALAPPDATA%`, `~/Library/Caches`, or
 *    `$XDG_CACHE_HOME` / `~/.cache`, then `smoud-ffmpeg/ffmpeg-<version>/`)
 * 4. a fresh download into that folder, checked against a pinned sha256. Goes through `HTTPS_PROXY` unless `NO_PROXY`
 *    lists the host.
 *
 * The lookup runs once per process; a failed lookup is tried again on the next call.
 *
 * @throws When `FFMPEG_PATH` does not run as ffmpeg, or no ffmpeg is found and the download fails. The message says
 * what failed and how to fix it.
 */
export declare function findFfmpeg(): Promise<Ffmpeg>;

/**
 * Runs ffmpeg (found by {@link findFfmpeg}) with `args`, adding `-hide_banner` in front.
 *
 * @param args Arguments for ffmpeg, e.g. `['-i', 'pipe:0', '-f', 'mp3', 'pipe:1']`.
 * @param input Written to ffmpeg's stdin. Without it, stdin is closed.
 * @returns ffmpeg's stdout and its log (stderr).
 * @throws When ffmpeg exits with an error; the message holds the last 3 lines of its log.
 */
export declare function runFfmpeg(args: string[], input?: Buffer): Promise<{ stdout: Buffer; stderr: string }>;
