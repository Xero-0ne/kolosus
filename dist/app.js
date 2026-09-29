const body = document.body;
const backdrops = document.querySelector('.backdrops');
const navButtons = [...document.querySelectorAll('.mode-button')];
const views = [...document.querySelectorAll('.view')];
const cards = [...document.querySelectorAll('.track-card')];
const audioStatus = document.getElementById('audio-status');

const statueFiles = Array.from({ length: 18 }, (_, index) => `./assets/statue-${String(index + 1).padStart(2, '0')}.webp`);
statueFiles.forEach((source, index) => {
  const layer = document.createElement('div');
  layer.className = `backdrop statue-backdrop${index === 0 ? ' is-visible' : ''}`;
  layer.dataset.backdropId = `statue-${String(index + 1).padStart(2, '0')}`;
  layer.style.setProperty('--image', `url('${source}')`);
  backdrops.prepend(layer);
});

const backdropLayers = [...document.querySelectorAll('.backdrop')];
const statueLayers = [...document.querySelectorAll('.statue-backdrop')];
const audioNodes = new WeakMap();
const smoothSpectra = cards.map(() => new Float32Array(72));

let activeCard = cards[0];
let audioContext = null;
let activeAnalyser = null;
let activeAudio = null;
let frequencyDb = null;
let frequencyBytes = null;
let statueIndex = 0;
let lastSlideAt = performance.now();
let lastFrameAt = performance.now();
let bassEnvelope = 0;

const clamp = (value, minimum = 0, maximum = 1) => Math.max(minimum, Math.min(maximum, value));

class KickDetector {
  constructor() { this.reset(); }
  reset() { this.floor = 0.015; this.previous = 0; this.punch = 0; this.last = -10; }
  update(amplitude, deltaTime, now, sensitivity = 1) {
    const level = clamp(amplitude * 6);
    this.floor += (level - this.floor) * (1 - Math.exp(-deltaTime / (level > this.floor ? 0.5 : 0.11)));
    const onset = level - this.previous;
    const hit = level > 0.035 && onset > 0.05 / sensitivity && level > this.floor * (1.9 / Math.sqrt(sensitivity)) && now - this.last > 0.14;
    if (hit) {
      this.last = now;
      this.punch = clamp(0.3 + level * 1.3 * sensitivity);
    } else {
      this.punch *= Math.exp(-deltaTime / 0.1);
    }
    this.previous = level;
    return this.punch;
  }
}

const kickDetector = new KickDetector();

function bandAmplitude(values, sampleRate, fftSize, low, high) {
  const hertzPerBin = sampleRate / fftSize;
  const first = Math.max(1, Math.floor(low / hertzPerBin));
  const last = Math.min(values.length - 1, Math.ceil(high / hertzPerBin));
  let power = 0;
  let weight = 0;
  for (let index = first; index <= last; index += 1) {
    const overlap = Math.max(0, Math.min(high, (index + 0.5) * hertzPerBin) - Math.max(low, (index - 0.5) * hertzPerBin)) / hertzPerBin;
    if (overlap) {
      power += 10 ** (values[index] / 10) * overlap;
      weight += overlap;
    }
  }
  return weight ? Math.sqrt(power / weight) : 0;
}

function setBackdrop(id) {
  body.dataset.backdrop = id;
  backdropLayers.forEach((layer) => layer.classList.toggle('is-visible', layer.dataset.backdropId === id));
}

function showStatue(index, resetClock = true) {
  statueIndex = (index + statueLayers.length) % statueLayers.length;
  setBackdrop(statueLayers[statueIndex].dataset.backdropId);
  if (resetClock) lastSlideAt = performance.now();
}

function nextStatue() { showStatue(statueIndex + 1); }

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
  if (id === 'listen') showStatue(statueIndex, false);
  if (id === 'stream') setBackdrop('monolith');
  if (id === 'contact') setBackdrop('ritual');
}

navButtons.forEach((button) => button.addEventListener('click', () => setView(button.dataset.viewTarget)));

function formatTime(value) {
  if (!Number.isFinite(value)) return '—:—';
  const minutes = Math.floor(value / 60);
  const seconds = Math.floor(value % 60).toString().padStart(2, '0');
  return `${minutes}:${seconds}`;
}

function selectCard(card) {
  activeCard = card;
  cards.forEach((item) => item.classList.toggle('is-selected', item === card));
}

function ensureAudioGraph(audio) {
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (!AudioContext) return null;
  if (!audioContext) audioContext = new AudioContext();
  if (audioNodes.has(audio)) return audioNodes.get(audio).analyser;
  const source = audioContext.createMediaElementSource(audio);
  const analyser = audioContext.createAnalyser();
  analyser.fftSize = 2048;
  analyser.smoothingTimeConstant = 0.35;
  analyser.minDecibels = -100;
  analyser.maxDecibels = -10;
  source.connect(analyser);
  analyser.connect(audioContext.destination);
  audioNodes.set(audio, { source, analyser });
  return analyser;
}

cards.forEach((card) => {
  const audio = card.querySelector('audio');
  const button = card.querySelector('.play-button');
  const seek = card.querySelector('.seek');
  const current = card.querySelector('.current-time');
  const duration = card.querySelector('.duration');

  card.addEventListener('click', (event) => {
    if (!event.target.closest('button, input')) selectCard(card);
  });

  audio.addEventListener('loadedmetadata', () => {
    button.disabled = false;
    seek.disabled = false;
    duration.textContent = formatTime(audio.duration);
  });

  audio.addEventListener('error', () => {
    button.disabled = true;
    seek.disabled = true;
    duration.textContent = '--:--';
  });

  audio.addEventListener('timeupdate', () => {
    current.textContent = formatTime(audio.currentTime);
    if (Number.isFinite(audio.duration) && !seek.matches(':active')) seek.value = (audio.currentTime / audio.duration) * 100;
  });

  audio.addEventListener('ended', () => {
    card.classList.remove('is-playing');
    button.querySelector('span').textContent = '▶';
    seek.value = 0;
    current.textContent = '0:00';
    kickDetector.reset();
  });

  button.addEventListener('click', async (event) => {
    event.stopPropagation();
    selectCard(card);
    cards.forEach((other) => {
      if (other === card) return;
      const otherAudio = other.querySelector('audio');
      otherAudio.pause();
      other.classList.remove('is-playing');
      other.querySelector('.play-button span').textContent = '▶';
    });

    if (!audio.paused) {
      audio.pause();
      card.classList.remove('is-playing');
      button.querySelector('span').textContent = '▶';
      return;
    }

    try {
      const analyser = ensureAudioGraph(audio);
      if (audioContext?.state === 'suspended') await audioContext.resume();
      activeAnalyser = analyser;
      activeAudio = audio;
      frequencyDb = new Float32Array(analyser.frequencyBinCount);
      frequencyBytes = new Uint8Array(analyser.frequencyBinCount);
      kickDetector.reset();
      nextStatue();
      await audio.play();
      card.classList.add('is-playing');
      button.querySelector('span').textContent = 'Ⅱ';
    } catch {
      audioStatus.textContent = 'Playback could not start.';
    }
  });

  seek.addEventListener('input', () => {
    if (Number.isFinite(audio.duration)) audio.currentTime = (Number(seek.value) / 100) * audio.duration;
    kickDetector.reset();
  });
});

const idleProfiles = cards.map((_, cardIndex) => Array.from({ length: 72 }, (_, index) => {
  const wave = Math.abs(Math.sin(index * 0.39 + cardIndex * 1.7));
  const pulse = Math.abs(Math.cos(index * 0.13 - cardIndex));
  return 0.1 + wave * pulse * 0.34;
}));

function drawSpectrum(card, cardIndex, liveValues) {
  const canvas = card.querySelector('.spectrum');
  const context = canvas.getContext('2d');
  const width = canvas.width;
  const height = canvas.height;
  const isActive = card.classList.contains('is-playing') && card.querySelector('audio') === activeAudio && liveValues;
  const target = isActive ? liveValues : idleProfiles[cardIndex];
  const smooth = smoothSpectra[cardIndex];

  for (let index = 0; index < smooth.length; index += 1) {
    const response = target[index] > smooth[index] ? 0.25 : 0.08;
    smooth[index] += (target[index] - smooth[index]) * response;
  }

  context.clearRect(0, 0, width, height);
  context.save();
  context.fillStyle = isActive ? 'rgba(255, 255, 255, 0.94)' : 'rgba(255, 255, 255, 0.38)';
  context.shadowColor = 'rgba(255, 255, 255, 0.92)';
  context.shadowBlur = isActive ? 13 : 0;
  const gap = 5;
  const barWidth = (width - gap * 71) / 72;
  smooth.forEach((value, index) => {
    const floor = isActive ? 7 : 4;
    const barHeight = Math.max(floor, value * height * (isActive ? 0.98 : 0.5));
    context.fillRect(index * (barWidth + gap), (height - barHeight) / 2, barWidth, barHeight);
  });
  context.restore();
}

function updateBackdropMotion(now, bass, kick) {
  const idleX = Math.sin(now * 0.00013) * 3;
  const idleY = Math.cos(now * 0.0001) * 2;
  const shakeX = Math.sin(now * 0.087) * kick * 4.2;
  const shakeY = Math.cos(now * 0.073) * kick * 2.6;
  backdrops.style.setProperty('--motion-x', `${idleX + shakeX}px`);
  backdrops.style.setProperty('--motion-y', `${idleY + shakeY}px`);
  backdrops.style.setProperty('--impact-scale', String(1.032 + bass * 0.006 + kick * 0.014));
  backdrops.style.setProperty('--impact-light', String(0.54 + kick * 0.08));
}

function animate(now) {
  const deltaTime = Math.min(0.1, (now - lastFrameAt) / 1000 || 1 / 60);
  lastFrameAt = now;
  let kick = 0;
  let liveValues = null;

  if (activeAnalyser && activeAudio && !activeAudio.paused && frequencyDb && frequencyBytes) {
    activeAnalyser.getFloatFrequencyData(frequencyDb);
    activeAnalyser.getByteFrequencyData(frequencyBytes);
    const kickAmplitude = bandAmplitude(frequencyDb, audioContext.sampleRate, activeAnalyser.fftSize, 40, 110);
    const bassAmplitude = clamp(bandAmplitude(frequencyDb, audioContext.sampleRate, activeAnalyser.fftSize, 25, 180) * 5);
    kick = kickDetector.update(kickAmplitude, deltaTime, now / 1000, 1.25);
    bassEnvelope += (bassAmplitude - bassEnvelope) * (1 - Math.exp(-deltaTime / (bassAmplitude > bassEnvelope ? 0.04 : 0.18)));
    liveValues = Array.from({ length: 72 }, (_, index) => {
      const normalized = index / 71;
      const sourceIndex = Math.min(frequencyBytes.length - 1, Math.floor((normalized ** 1.75) * frequencyBytes.length * 0.72));
      return clamp((frequencyBytes[sourceIndex] / 255) ** 0.78 * 1.18);
    });
  } else {
    bassEnvelope *= Math.exp(-deltaTime / 0.22);
    kickDetector.reset();
  }

  if (body.dataset.view === 'listen' && now - lastSlideAt > 7200) nextStatue();
  updateBackdropMotion(now, bassEnvelope, kick);
  cards.forEach((card, index) => drawSpectrum(card, index, liveValues));
  requestAnimationFrame(animate);
}

showStatue(0);
requestAnimationFrame(animate);
