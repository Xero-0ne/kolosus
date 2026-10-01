const body = document.body;
const backdrops = document.querySelector('.backdrops');
const navButtons = [...document.querySelectorAll('.mode-button')];
const views = [...document.querySelectorAll('.view')];
const player = document.querySelector('.music-player');
const playButton = document.getElementById('play');
const shuffleButton = document.getElementById('shuffle');
const repeatButton = document.getElementById('repeat');
const seek = document.querySelector('.seek');
const currentTime = document.querySelector('.current-time');
const duration = document.querySelector('.duration');
const audioStatus = document.getElementById('audio-status');
const spectrum = document.querySelector('.spectrum');
const spectrumContext = spectrum.getContext('2d');
const tracks = ['KUSH', 'XLVII', 'SALT & SILENCE'].map((title, index) => ({
  title, audio: document.querySelectorAll('.audio-sources audio')[index], ready: false, failed: false
}));

// Reuse two layers for the crossfade so only the current artwork is animated.
const statueLayers = Array.from({ length: 2 }, (_, index) => {
  const layer = document.createElement('div');
  layer.className = `backdrop statue-backdrop${index === 0 ? ' is-visible' : ''}`;
  backdrops.prepend(layer);
  return layer;
});
const staticLayers = [...document.querySelectorAll('.static-backdrop')];
const audioNodes = new WeakMap();
const smoothSpectrum = new Float32Array(72);
const idleSpectrum = Array.from({ length: 72 }, (_, index) =>
  0.1 + Math.abs(Math.sin(index * 0.39) * Math.cos(index * 0.13)) * 0.34
);
let trackIndex = 0;
let statueIndex = 0;
let visibleStatueLayer = 0;
let lastSlideAt = performance.now();
let playRequest = 0;
let audioContext = null;
let activeAnalyser = null;
let frequencyBytes = null;
let shuffle = false;
let shufflePool = [];
let history = [];
let repeatMode = 0; // Off, all, one.
const clamp = (value, minimum = 0, maximum = 1) => Math.max(minimum, Math.min(maximum, value));
const statueSource = (index) => `./assets/statue-${String(index + 1).padStart(2, '0')}.webp`;
statueLayers[0].style.setProperty('--image', `url('${statueSource(0)}')`);
const nextStatueImage = new Image();
nextStatueImage.src = statueSource(1);

function showStatue(index, resetClock = true) {
  statueIndex = (index + 37) % 37;
  if (resetClock) lastSlideAt = performance.now();
  const incoming = 1 - visibleStatueLayer;
  statueLayers[incoming].style.setProperty('--image', `url('${statueSource(statueIndex)}')`);
  nextStatueImage.src = statueSource((statueIndex + 1) % 37);
  visibleStatueLayer = incoming;
  if (body.dataset.view === 'listen') {
    statueLayers.forEach((layer, layerIndex) => layer.classList.toggle('is-visible', layerIndex === incoming));
  }
  body.dataset.backdrop = `statue-${String(statueIndex + 1).padStart(2, '0')}`;
}

function setView(id) {
  body.dataset.view = id;
  navButtons.forEach((button) => {
    const selected = button.dataset.viewTarget === id;
    button.classList.toggle('is-active', selected);
    button.setAttribute('aria-pressed', String(selected));
  });
  views.forEach((view) => {
    const selected = view.dataset.viewId === id;
    view.classList.toggle('is-active', selected);
    view.hidden = !selected;
  });
  statueLayers.forEach((layer, index) => layer.classList.toggle('is-visible', id === 'listen' && index === visibleStatueLayer));
  staticLayers.forEach((layer) => layer.classList.toggle('is-visible',
    (id === 'stream' && layer.dataset.backdropId === 'monolith') ||
    (id === 'contact' && layer.dataset.backdropId === 'ritual')));
  body.dataset.backdrop = id === 'listen' ? `statue-${String(statueIndex + 1).padStart(2, '0')}` : id === 'stream' ? 'monolith' : 'ritual';
}
navButtons.forEach((button) => button.addEventListener('click', () => setView(button.dataset.viewTarget)));

function formatTime(value) {
  if (!Number.isFinite(value)) return '--:--';
  return `${Math.floor(value / 60)}:${Math.floor(value % 60).toString().padStart(2, '0')}`;
}
function showStatus(message) {
  audioStatus.textContent = message;
  audioStatus.hidden = !message;
}
function updateProgress() {
  const audio = tracks[trackIndex].audio;
  const hasDuration = Number.isFinite(audio.duration) && audio.duration > 0;
  currentTime.textContent = formatTime(audio.currentTime);
  duration.textContent = hasDuration ? formatTime(audio.duration) : '--:--';
  if (!seek.matches(':active')) seek.value = hasDuration ? String(Math.round(audio.currentTime / audio.duration * 1000)) : '0';
  seek.style.setProperty('--progress', `${Number(seek.value) / 10}%`);
  seek.disabled = !hasDuration;
}
function updatePlayer() {
  const track = tracks[trackIndex];
  const playing = !track.audio.paused && !track.audio.ended;
  document.getElementById('track-index').textContent = `${String(trackIndex + 1).padStart(2, '0')} / 03`;
  document.getElementById('track-title').textContent = track.title;
  player.classList.toggle('is-playing', playing);
  playButton.setAttribute('aria-label', `${playing ? 'Pause' : 'Play'} ${track.title}`);
  playButton.title = playing ? 'Pause' : 'Play';
  player.setAttribute('aria-busy', String(!track.ready && !track.failed));
  updateProgress();
}
function ensureAudioGraph(audio) {
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (!AudioContext) return null;
  if (!audioContext) audioContext = new AudioContext();
  if (audioNodes.has(audio)) return audioNodes.get(audio);
  const source = audioContext.createMediaElementSource(audio);
  const analyser = audioContext.createAnalyser();
  analyser.fftSize = 2048;
  analyser.smoothingTimeConstant = 0.45;
  source.connect(analyser);
  analyser.connect(audioContext.destination);
  audioNodes.set(audio, analyser);
  return analyser;
}
function prepareTrack(track) {
  if (track.preparePromise) return track.preparePromise;
  track.preparePromise = (async () => {
    const response = await fetch(track.audio.dataset.src);
    if (!response.ok) throw new Error(`Audio request failed: ${response.status}`);
    const blob = await response.blob();
    await new Promise((resolve, reject) => {
      track.audio.addEventListener('loadedmetadata', resolve, { once: true });
      track.audio.addEventListener('error', reject, { once: true });
      track.audio.src = URL.createObjectURL(blob);
      track.audio.load();
    });
    track.ready = true;
    if (tracks[trackIndex] === track) updatePlayer();
  })().catch((error) => {
    track.failed = true;
    if (tracks[trackIndex] === track) {
      updatePlayer();
      showStatus('Track unavailable. Please try again later.');
    }
    console.error('Audio preparation failed', error);
    throw error;
  });
  return track.preparePromise;
}
async function playSelected() {
  const request = ++playRequest;
  const track = tracks[trackIndex];
  showStatus('');
  try {
    await prepareTrack(track);
    if (request !== playRequest || tracks[trackIndex] !== track) return;
    try {
      activeAnalyser = ensureAudioGraph(track.audio);
      frequencyBytes = activeAnalyser ? new Uint8Array(activeAnalyser.frequencyBinCount) : null;
    } catch (error) {
      activeAnalyser = null;
      frequencyBytes = null;
      console.warn('Spectrum unavailable', error);
    }
    if (request !== playRequest) return;
    const playback = track.audio.play();
    if (audioContext?.state === 'suspended') audioContext.resume().catch(() => {});
    await playback;
    if (request !== playRequest) {
      track.audio.pause();
      return;
    }
    updatePlayer();
  } catch (error) {
    if (request === playRequest) showStatus('Playback could not start. Tap play to try again.');
    console.error('Audio playback failed', error);
  }
}
function selectTrack(index, autoplay = true) {
  ++playRequest;
  tracks.forEach((track) => track.audio.pause());
  trackIndex = index;
  tracks[trackIndex].audio.currentTime = 0;
  activeAnalyser = null;
  frequencyBytes = null;
  showStatus('');
  updatePlayer();
  if (autoplay) playSelected();
}
function refillShufflePool() {
  shufflePool = tracks.map((_, index) => index).filter((index) => index !== trackIndex);
  for (let index = shufflePool.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(Math.random() * (index + 1));
    [shufflePool[index], shufflePool[swap]] = [shufflePool[swap], shufflePool[index]];
  }
}
function nextTrack(automatic = false) {
  if (automatic && repeatMode === 2) {
    tracks[trackIndex].audio.currentTime = 0;
    playSelected();
    return;
  }
  let next;
  if (shuffle) {
    if (!shufflePool.length) {
      if (automatic && repeatMode === 0) return;
      refillShufflePool();
    }
    next = shufflePool.pop();
  } else {
    if (automatic && trackIndex === tracks.length - 1 && repeatMode === 0) return;
    next = (trackIndex + 1) % tracks.length;
  }
  history.push(trackIndex);
  selectTrack(next);
}
function previousTrack() {
  const audio = tracks[trackIndex].audio;
  if (audio.currentTime > 3) {
    audio.currentTime = 0;
    updateProgress();
    playSelected();
    return;
  }
  const previous = shuffle && history.length ? history.pop() : (trackIndex + tracks.length - 1) % tracks.length;
  if (shuffle) shufflePool.push(trackIndex);
  selectTrack(previous);
}
playButton.addEventListener('click', () => {
  const audio = tracks[trackIndex].audio;
  if (!audio.paused) {
    ++playRequest;
    audio.pause();
    updatePlayer();
  } else playSelected();
});
document.getElementById('next').addEventListener('click', () => nextTrack());
document.getElementById('previous').addEventListener('click', previousTrack);
shuffleButton.addEventListener('click', () => {
  shuffle = !shuffle;
  shuffleButton.classList.toggle('is-active', shuffle);
  shuffleButton.setAttribute('aria-pressed', String(shuffle));
  shuffleButton.setAttribute('aria-label', `Shuffle ${shuffle ? 'on' : 'off'}`);
  shuffleButton.title = `Shuffle ${shuffle ? 'on' : 'off'}`;
  history = [];
  shufflePool = [];
  if (shuffle) refillShufflePool();
});
repeatButton.addEventListener('click', () => {
  repeatMode = (repeatMode + 1) % 3;
  const label = ['Repeat off', 'Repeat all', 'Repeat one'][repeatMode];
  repeatButton.dataset.mode = String(repeatMode);
  repeatButton.setAttribute('aria-label', label);
  repeatButton.title = label;
});
seek.addEventListener('input', () => {
  const audio = tracks[trackIndex].audio;
  if (Number.isFinite(audio.duration) && audio.duration > 0) {
    audio.currentTime = Number(seek.value) / 1000 * audio.duration;
    currentTime.textContent = formatTime(audio.currentTime);
    seek.style.setProperty('--progress', `${Number(seek.value) / 10}%`);
  }
});
tracks.forEach((track) => {
  track.audio.addEventListener('timeupdate', () => { if (tracks[trackIndex] === track) updateProgress(); });
  track.audio.addEventListener('durationchange', () => { if (tracks[trackIndex] === track) updateProgress(); });
  track.audio.addEventListener('play', () => { if (tracks[trackIndex] === track) updatePlayer(); });
  track.audio.addEventListener('pause', () => { if (tracks[trackIndex] === track) updatePlayer(); });
  track.audio.addEventListener('ended', () => {
    if (tracks[trackIndex] !== track) return;
    updatePlayer();
    nextTrack(true);
  });
  // Full-file blobs keep seeking reliable on both the Site host and GitHub Pages.
  prepareTrack(track).catch(() => {});
});
function drawSpectrum() {
  const audio = tracks[trackIndex].audio;
  let liveValues = null;
  if (activeAnalyser && frequencyBytes && !audio.paused) {
    activeAnalyser.getByteFrequencyData(frequencyBytes);
    liveValues = Array.from({ length: 72 }, (_, index) => {
      const normalized = index / 71;
      const sourceIndex = Math.min(frequencyBytes.length - 1, Math.floor(normalized ** 1.75 * frequencyBytes.length * 0.72));
      return clamp((frequencyBytes[sourceIndex] / 255) ** 0.78 * 1.18);
    });
  }
  const target = liveValues || idleSpectrum;
  for (let index = 0; index < smoothSpectrum.length; index += 1) {
    smoothSpectrum[index] += (target[index] - smoothSpectrum[index]) * (target[index] > smoothSpectrum[index] ? 0.25 : 0.08);
  }
  const width = spectrum.width;
  const height = spectrum.height;
  spectrumContext.clearRect(0, 0, width, height);
  spectrumContext.fillStyle = liveValues ? 'rgba(255,255,255,.92)' : 'rgba(255,255,255,.42)';
  const gap = 5;
  const barWidth = (width - gap * 71) / 72;
  smoothSpectrum.forEach((value, index) => {
    const barHeight = Math.max(liveValues ? 7 : 4, value * height * (liveValues ? 0.98 : 0.5));
    spectrumContext.fillRect(index * (barWidth + gap), (height - barHeight) / 2, barWidth, barHeight);
  });
}
function animate(now) {
  if (body.dataset.view === 'listen' && now - lastSlideAt > 7200) showStatue(statueIndex + 1);
  // Only the slow vertical pan remains; audio never moves or scales the backdrop.
  backdrops.style.setProperty('--pan-y', `${Math.sin(now * 0.00012) * 42}px`);
  drawSpectrum();
  requestAnimationFrame(animate);
}
updatePlayer();
requestAnimationFrame(animate);
