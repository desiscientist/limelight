// Video probing and quality-version (rendition) generation using ffmpeg.
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const ffmpegPath = require('ffmpeg-static');
const ffprobePath = require('ffprobe-static').path;

// Quality levels offered to viewers (by the video's short side, e.g. 720 = "720p").
const LADDER = [2160, 1440, 1080, 720, 480, 360];
const WEB_CODECS = ['h264', 'vp8', 'vp9', 'av1'];
const WEB_CONTAINERS = ['mov,mp4,m4a,3gp,3g2,mj2', 'matroska,webm'];

function run(bin, args, onStdout) {
  return new Promise((resolve, reject) => {
    const p = spawn(bin, args, { windowsHide: true });
    let out = '', err = '';
    p.stdout.on('data', (d) => { out += d; if (onStdout) onStdout(String(d)); });
    p.stderr.on('data', (d) => { err = (err + d).slice(-4000); });
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve(out) : reject(new Error(`${path.basename(bin)} exited ${code}: ${err}`))));
  });
}

// Returns { width, height, duration, codec, webFriendly } with width/height as displayed (rotation applied).
async function probe(file) {
  const json = JSON.parse(await run(ffprobePath, ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', file]));
  const v = (json.streams || []).find((s) => s.codec_type === 'video');
  if (!v) throw new Error('No video stream found');
  const rawRotation = Number(
    (v.side_data_list || []).find((d) => d.rotation !== undefined)?.rotation ?? v.tags?.rotate ?? 0) || 0;
  const rotation = Math.abs(rawRotation) % 180;
  const [width, height] = rotation === 90 ? [v.height, v.width] : [v.width, v.height];
  const formatName = json.format?.format_name || '';
  return {
    width,
    height,
    duration: Number(json.format?.duration) || 0,
    codec: v.codec_name,
    pixFmt: v.pix_fmt,
    rotated: rawRotation % 360 !== 0,
    webFriendly: WEB_CODECS.includes(v.codec_name) && WEB_CONTAINERS.includes(formatName) && v.pix_fmt !== 'yuv444p',
  };
}

// Which quality versions to create for a video.
function plan(info) {
  const short = Math.min(info.width, info.height);
  const targets = LADDER.filter((h) => h < short);
  // If browsers can't play the original, also make a full-resolution copy that they can.
  if (!info.webFriendly) targets.unshift(short);
  return targets;
}

function transcode(input, output, short, info, duration, onProgress) {
  const portrait = info.height > info.width;
  const scale = short >= Math.min(info.width, info.height)
    ? 'scale=trunc(iw/2)*2:trunc(ih/2)*2'
    : portrait ? `scale=${short}:-2` : `scale=-2:${short}`;
  const args = [
    '-y', '-hide_banner', '-loglevel', 'error', '-i', input,
    '-map', '0:v:0', '-map', '0:a:0?',
    '-vf', scale,
    '-c:v', 'libx264', '-preset', 'fast', '-crf', short >= Math.min(info.width, info.height) ? '18' : '21',
    '-pix_fmt', 'yuv420p', '-profile:v', 'high',
    '-c:a', 'aac', '-b:a', '160k',
    '-movflags', '+faststart',
    '-progress', 'pipe:1', '-nostats',
    output,
  ];
  return run(ffmpegPath, args, (chunk) => {
    const m = chunk.match(/out_time_us=(\d+)/g);
    if (m && duration) {
      const us = Number(m[m.length - 1].split('=')[1]);
      onProgress(Math.min(99, Math.round((us / 1e6 / duration) * 100)));
    }
  });
}

const quiet = ['-y', '-hide_banner', '-loglevel', 'error'];

// Saves one frame (or converts an uploaded image) as a JPEG cover image, max 1280px wide.
function makePoster(input, output, atSeconds = 0) {
  return run(ffmpegPath, [
    ...quiet, '-ss', String(Math.max(0, atSeconds)), '-i', input,
    '-frames:v', '1', '-vf', "scale='min(1280,iw)':-2", '-q:v', '3', output,
  ]);
}

// One image holding up to 100 small frames, shown when hovering over the progress bar.
async function makeStoryboard(input, output, duration) {
  const interval = Math.max(1, Math.ceil(duration / 100));
  const count = Math.max(1, Math.min(100, Math.ceil(duration / interval)));
  const cols = Math.min(10, count);
  const rows = Math.ceil(count / cols);
  await run(ffmpegPath, [
    ...quiet, '-i', input,
    '-vf', `fps=1/${interval},scale=160:90:force_original_aspect_ratio=decrease,pad=160:90:(ow-iw)/2:(oh-ih)/2:black,tile=${cols}x${rows}`,
    '-frames:v', '1', '-q:v', '5', output,
  ]);
  return { interval, count, cols, rows, width: 160, height: 90 };
}

// Splits an existing H.264 file into small streaming chunks (HLS) without re-encoding the picture.
function makeHlsVariant(input, prefix) {
  return run(ffmpegPath, [
    ...quiet, '-i', input,
    '-map', '0:v:0', '-map', '0:a:0?',
    '-c:v', 'copy', '-c:a', 'aac', '-b:a', '160k',
    '-f', 'hls', '-hls_time', '6', '-hls_playlist_type', 'vod', '-hls_flags', 'independent_segments',
    '-hls_segment_filename', prefix + '_%04d.ts',
    prefix + '.m3u8',
  ]);
}

module.exports = { probe, plan, transcode, makePoster, makeStoryboard, makeHlsVariant };
