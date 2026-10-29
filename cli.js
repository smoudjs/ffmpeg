#!/usr/bin/env node
'use strict';

// Runs ffmpeg with the given arguments unchanged, after finding or downloading it the same way as findFfmpeg().

const { spawn } = require('node:child_process');
const { findFfmpeg } = require('./index.js');

function fail(message) {
  process.stderr.write(`smoud-ffmpeg: ${message}\n`);
  process.exit(1);
}

findFfmpeg().then((ffmpeg) => {
  const child = spawn(ffmpeg.path, process.argv.slice(2), { stdio: 'inherit' });
  // Ctrl+C reaches ffmpeg too; let it finish writing its output and exit on its own
  process.on('SIGINT', () => {});
  process.on('SIGTERM', () => child.kill('SIGTERM'));
  child.on('error', (error) => fail(error.message));
  child.on('close', (code) => process.exit(code ?? 1));
}, (error) => fail(error.message));
