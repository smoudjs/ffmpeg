'use strict';

// Finds an ffmpeg to run, in this order: FFMPEG_PATH, `ffmpeg` on the PATH, a copy downloaded earlier into the
// user's cache folder, or a fresh download there. Downloads come from this package's own GitHub release and are
// checked against the sha256 pinned below, so a machine downloads ffmpeg once for all its projects.

const { spawn } = require('node:child_process');
const { createHash, randomBytes } = require('node:crypto');
const fs = require('node:fs/promises');
const http = require('node:http');
const https = require('node:https');
const os = require('node:os');
const path = require('node:path');
const tls = require('node:tls');
const { gunzipSync } = require('node:zlib');

const BUILDS_URL = 'https://github.com/smoudjs/ffmpeg/releases/download/builds-6.1.1';
// Copies of the ffmpeg-static release files. Its 6.1.1 release dropped freebsd-x64 and win32-ia32, so those two are
// ffmpeg 6.0. `version` names the cache folder; `sha256` is of the release file `ffmpeg-<platform>-<arch>.gz`.
const BUILDS = {
  'darwin-arm64': { version: '6.1.1', sha256: '8923876afa8db5585022d7860ec7e589af192f441c56793971276d450ed3bbfa' },
  'darwin-x64': { version: '6.1.1', sha256: '929b375c1182d956c51f7ac25e0b2b0411fb01f6f407aa15c9758efeb4242106' },
  'freebsd-x64': { version: '6.0', sha256: '9286d5c6bf8ca004a4d705767cfde7d2c15cbb5d4ca41390b297b1390cc26add' },
  'linux-arm': { version: '6.1.1', sha256: '64b115a12f0ab77c277e3c418aae8b40ef881e75e746a0e2d066a206b9bc5172' },
  'linux-arm64': { version: '6.1.1', sha256: '754a678672298bc68156adff58aa7385a592c2b30b1d0ae8750c45c915c4bac0' },
  'linux-ia32': { version: '6.1.1', sha256: '169b27c078a8ecedb814cac67afccf15a9868d63e9d74ef86088adefaa500d00' },
  'linux-x64': { version: '6.1.1', sha256: 'bfe8a8fc511530457b528c48d77b5737527b504a3797a9bc4866aeca69c2dffa' },
  'win32-ia32': { version: '6.0', sha256: 'af47ca5de7b9f859f48e4e96ea831bf551b100144b0b871762ab48fba1152f56' },
  'win32-x64': { version: '6.1.1', sha256: '8883a3dffbd0a16cf4ef95206ea05283f78908dbfb118f73c83f4951dcc06d77' }
};
const INSTALL_HINT = 'set FFMPEG_PATH to an ffmpeg binary, or install ffmpeg on your system';
const MAX_REDIRECTS = 5;
// a download that receives nothing for this long fails instead of hanging a CI job
const IDLE_TIMEOUT_MS = 30_000;

let found;

// The ffmpeg to run, looked up once per process. A failed lookup is tried again on the next call.
function findFfmpeg() {
  if (!found) {
    found = locateFfmpeg();
    found.catch(() => (found = undefined));
  }
  return found;
}

// Runs ffmpeg with `args`, `input` on its stdin. Rejects with the last lines of its log when it exits with an error.
async function runFfmpeg(args, input) {
  const ffmpeg = await findFfmpeg();
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpeg.path, ['-hide_banner', ...args], {
      stdio: [input ? 'pipe' : 'ignore', 'pipe', 'pipe'],
      windowsHide: true
    });
    const stdout = [];
    const stderr = [];
    child.stdout.on('data', (chunk) => stdout.push(chunk));
    child.stderr.on('data', (chunk) => stderr.push(chunk));
    child.on('error', reject);
    child.on('close', (code) => {
      const log = Buffer.concat(stderr).toString('utf8');
      if (code === 0) resolve({ stdout: Buffer.concat(stdout), stderr: log });
      else reject(new Error(log.trim().split(/\r?\n/).slice(-3).join(' | ') || `ffmpeg exited with code ${code}`));
    });
    if (input) {
      // ffmpeg may stop reading early and close the pipe; its exit code tells what happened
      child.stdin.on('error', () => {});
      child.stdin.end(input);
    }
  });
}

async function locateFfmpeg() {
  const fromEnv = process.env.FFMPEG_PATH;
  if (fromEnv) {
    const version = await readVersion(fromEnv);
    if (!version) throw new Error(`FFMPEG_PATH is "${fromEnv}", which does not run as ffmpeg`);
    return { path: fromEnv, version };
  }

  const systemVersion = await readVersion('ffmpeg');
  if (systemVersion) return { path: 'ffmpeg', version: systemVersion };

  // Windows on Arm runs x64 programs through emulation
  const arch = process.platform === 'win32' && process.arch === 'arm64' ? 'x64' : process.arch;
  const platform = `${process.platform}-${arch}`;
  const build = BUILDS[platform];
  if (!build) throw new Error(`no ffmpeg download exists for ${platform}; ${INSTALL_HINT}`);

  const downloaded = downloadedBinaryPath(build.version);
  if (!(await statOrNull(downloaded))) await download(platform, build, downloaded);
  const version = await readVersion(downloaded);
  if (!version) throw new Error(`the downloaded ffmpeg at ${downloaded} does not run; ${INSTALL_HINT}`);
  return { path: downloaded, version };
}

// null when nothing runs at `binary` or it is not ffmpeg
function readVersion(binary) {
  return new Promise((resolve) => {
    const child = spawn(binary, ['-version'], { stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true });
    let output = '';
    child.stdout.on('data', (chunk) => (output += chunk.toString('utf8')));
    child.on('error', () => resolve(null));
    child.on('close', (code) => resolve(code === 0 ? (/ffmpeg version (\S+)/.exec(output)?.[1] ?? null) : null));
  });
}

function downloadedBinaryPath(version) {
  const home = os.homedir();
  let cacheRoot;
  if (process.platform === 'win32') cacheRoot = process.env.LOCALAPPDATA ?? path.join(home, 'AppData', 'Local');
  else if (process.platform === 'darwin') cacheRoot = path.join(home, 'Library', 'Caches');
  else cacheRoot = process.env.XDG_CACHE_HOME ?? path.join(home, '.cache');
  const fileName = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
  return path.join(cacheRoot, 'smoud-ffmpeg', `ffmpeg-${version}`, fileName);
}

async function download(platform, build, target) {
  const url = `${BUILDS_URL}/ffmpeg-${platform}.gz`;
  process.stderr.write(`Downloading ffmpeg ${build.version} into ${path.dirname(target)} (once per machine)\n`);
  let packed;
  try {
    packed = await get(url);
  } catch (error) {
    throw new Error(
      `could not download ffmpeg from ${url} (${error.message}); ${INSTALL_HINT}. Behind a proxy, set HTTPS_PROXY`
    );
  }
  if (createHash('sha256').update(packed).digest('hex') !== build.sha256) {
    throw new Error(`the ffmpeg downloaded from ${url} does not match its pinned sha256; ${INSTALL_HINT}`);
  }

  // parallel builds may download at the same time: each writes its own temporary file and either rename wins
  const temporary = `${target}.${randomBytes(6).toString('hex')}.tmp`;
  try {
    await writeFile(temporary, gunzipSync(packed));
    await fs.chmod(temporary, 0o755);
    await moveFile(temporary, target);
  } catch (error) {
    await fs.rm(temporary, { force: true });
    if (!(await statOrNull(target))) throw error;
  }
}

// Node's fetch ignores HTTPS_PROXY unless started with NODE_USE_ENV_PROXY=1 (Node 22.21+ only), so downloads use
// node:https and tunnel through the proxy themselves
async function get(url, redirectsLeft = MAX_REDIRECTS) {
  const target = new URL(url);
  const proxy = proxyFor(target);
  const socket = proxy ? await tunnel(proxy, target) : undefined;
  const response = await request(target, socket);
  const { statusCode, headers } = response;
  if (statusCode >= 300 && statusCode < 400 && headers.location) {
    response.resume();
    if (!redirectsLeft) throw new Error('too many redirects');
    return get(new URL(headers.location, url).href, redirectsLeft - 1);
  }
  if (statusCode !== 200) {
    response.resume();
    throw new Error(`HTTP ${statusCode}`);
  }
  const chunks = [];
  for await (const chunk of response) chunks.push(chunk);
  return Buffer.concat(chunks);
}

function request(target, socket) {
  return new Promise((resolve, reject) => {
    const options = { timeout: IDLE_TIMEOUT_MS };
    if (socket) options.createConnection = () => tls.connect({ socket, servername: target.hostname });
    const req = https.get(target, options, resolve);
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('timed out')));
  });
}

// null when no proxy is set or NO_PROXY lists the host
function proxyFor(target) {
  const proxy = process.env.HTTPS_PROXY || process.env.https_proxy;
  if (!proxy) return null;
  const noProxy = process.env.NO_PROXY || process.env.no_proxy || '';
  for (const rule of noProxy.split(/[\s,]+/).filter(Boolean)) {
    if (rule === '*') return null;
    const domain = rule.replace(/^\*?\./, '');
    if (target.hostname === domain || target.hostname.endsWith(`.${domain}`)) return null;
  }
  // `proxy:8080` without a scheme is common; URL would read `proxy:` as the protocol
  return new URL(proxy.includes('://') ? proxy : `http://${proxy}`);
}

// Opens a raw connection to `target` through the proxy with HTTP CONNECT; TLS then runs over it end to end.
function tunnel(proxy, target) {
  return new Promise((resolve, reject) => {
    const hostPort = `${target.hostname}:${target.port || 443}`;
    const headers = { host: hostPort };
    if (proxy.username) {
      const login = `${decodeURIComponent(proxy.username)}:${decodeURIComponent(proxy.password)}`;
      headers['proxy-authorization'] = `Basic ${Buffer.from(login).toString('base64')}`;
    }
    const req = (proxy.protocol === 'https:' ? https : http).request({
      host: proxy.hostname,
      port: proxy.port,
      method: 'CONNECT',
      path: hostPort,
      headers,
      timeout: IDLE_TIMEOUT_MS
    });
    req.on('connect', (response, socket) => {
      if (response.statusCode === 200) return resolve(socket);
      socket.destroy();
      reject(new Error(`proxy ${proxy.host} answered ${response.statusCode}`));
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error(`proxy ${proxy.host} timed out`)));
    req.end();
  });
}

async function writeFile(file, data) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, data);
}

// Move a file into place over whatever is there. Falls back to copy + delete when a rename is refused.
async function moveFile(from, to) {
  await fs.mkdir(path.dirname(to), { recursive: true });
  try {
    await fs.rename(from, to);
  } catch (error) {
    if (error.code !== 'EXDEV' && error.code !== 'EPERM' && error.code !== 'EEXIST') throw error;
    await fs.copyFile(from, to);
    await fs.unlink(from);
  }
}

async function statOrNull(target) {
  try {
    return await fs.stat(target);
  } catch {
    return null;
  }
}

module.exports = { findFfmpeg, runFfmpeg };
