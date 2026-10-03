'use strict';
// sunoapi.org - an UNOFFICIAL reseller of Suno. Docs: https://docs.sunoapi.org
// Kept for testing and as a stand-in until Suno's own API opens. It can stop working without notice.
const cfg = require('../config');
const { PublicError } = require('../errors');

const BASE = 'https://api.sunoapi.org/api/v1';
const FAILED = ['CREATE_TASK_FAILED', 'GENERATE_AUDIO_FAILED', 'SENSITIVE_WORD_ERROR'];
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function api(path, opts = {}) {
  const res = await fetch(BASE + path, Object.assign({}, opts, {
    headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.sunoapiKey}` },
    signal: AbortSignal.timeout(60000),
  }));
  const json = await res.json().catch(() => null);
  if (!res.ok || !json || json.code !== 200) {
    console.error('sunoapi error', res.status, JSON.stringify(json).slice(0, 500));
    throw new PublicError('The recording did not start. Try again.', 502);
  }
  return json.data;
}

async function generate(song) {
  if (!cfg.sunoapiKey) throw new PublicError('Recording is not set up yet.', 503);
  const body = {
    customMode: true,
    instrumental: false,
    model: cfg.sunoapiModel,
    title: String(song.title || '').slice(0, 80),
    style: String(song.style || '').slice(0, 1000),
    lyrics: String(song.lyrics || '').slice(0, 5000),
    duration: cfg.sunoapiDuration,
    // The API requires a callback address. We poll instead, so this endpoint just answers 200.
    callBackUrl: cfg.baseUrl + '/api/engine-callback',
  };
  if (song.voice === 'male') body.vocalGender = 'm';
  if (song.voice === 'female') body.vocalGender = 'f';

  const { taskId } = await api('/generate', { method: 'POST', body: JSON.stringify(body) });

  const deadline = Date.now() + 10 * 60 * 1000;
  while (Date.now() < deadline) {
    await sleep(10000);
    const info = await api('/generate/record-info?taskId=' + encodeURIComponent(taskId));
    if (FAILED.includes(info.status)) {
      console.error('sunoapi task failed', info.status, info.errorMessage);
      throw new PublicError(info.status === 'SENSITIVE_WORD_ERROR'
        ? 'The music service turned down some of the words. Change the lyrics and try again.'
        : 'The recording did not finish. Try again.', 502);
    }
    const tracks = (info.response && info.response.sunoData) || [];
    const track = tracks.find(t => t && t.audio_url);
    // Each request makes two variations; the first finished file is the one we keep.
    if (track && (info.status === 'SUCCESS' || info.status === 'FIRST_SUCCESS')) {
      const file = await fetch(track.audio_url, { signal: AbortSignal.timeout(120000) });
      if (!file.ok) throw new PublicError('The recording could not be downloaded. Try again.', 502);
      // Their links expire after about two weeks, which is why we copy the file to our own disk.
      return { audio: Buffer.from(await file.arrayBuffer()), mime: 'audio/mpeg', ext: 'mp3', durationSec: Number(track.duration) || null };
    }
  }
  throw new PublicError('The recording took too long. Try again.', 504);
}

module.exports = { name: 'sunoapi', generate };
