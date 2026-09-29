const body = document.body;
const navButtons = [...document.querySelectorAll('.mode-button')];
const views = [...document.querySelectorAll('.view')];
const backdropLayers = [...document.querySelectorAll('.backdrop')];
const cards = [...document.querySelectorAll('.track-card')];
const audioStatus = document.getElementById('audio-status');

let activeCard = cards[0];
let audioContext = null;
let activeAnalyser = null;
let activeAudio = null;
const audioNodes = new WeakMap();

function setBackdrop(id) {
  body.dataset.backdrop = id;
  backdropLayers.forEach((layer) => layer.classList.toggle('is-visible', layer.dataset.backdropId === id));
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
  if (id === 'listen') setBackdrop(activeCard.dataset.backdropTarget);
  if (id === 'stream') setBackdrop('ocean');
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
  if (body.dataset.view === 'listen') setBackdrop(card.dataset.backdropTarget);
}

function ensureAudioGraph(audio) {
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (!AudioContext) return null;
  if (!audioContext) audioContext = new AudioContext();
  if (audioNodes.has(audio)) return audioNodes.get(audio).analyser;
  const source = audioContext.createMediaElementSource(audio);
  const analyser = audioContext.createAnalyser();
  analyser.fftSize = 256;
  analyser.smoothingTimeConstant = 0.82;
  source.connect(analyser);
  analyser.connect(audioContext.destination);
  audioNodes.set(audio, { source, analyser });
  activeAudio = audio;
  return analyser;
}

cards.forEach((card) => {
  const audio = card.querySelector('audio');
  const button = card.querySelector('.play-button');
  const seek = card.querySelector('.seek');
  const current = card.querySelector('.current-time');
  const duration = card.querySelector('.duration');
  const meta = card.querySelector('.track-copy p');

  card.addEventListener('click', (event) => {
    if (!event.target.closest('button, input')) selectCard(card);
  });

  audio.addEventListener('loadedmetadata', () => {
    button.disabled = false;
    seek.disabled = false;
    duration.textContent = formatTime(audio.duration);
    meta.textContent = `PRIVATE MASTER · ${formatTime(audio.duration)}`;
    audioStatus.textContent = 'Three private masters. One-tap playback.';
  });

  audio.addEventListener('error', () => {
    button.disabled = true;
    seek.disabled = true;
    meta.textContent = 'MP3 SLOT READY';
    audioStatus.textContent = 'Audio interface ready. Add the three masters to activate playback.';
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
      await audio.play();
      activeAnalyser = analyser;
      activeAudio = audio;
      card.classList.add('is-playing');
      button.querySelector('span').textContent = 'Ⅱ';
    } catch {
      audioStatus.textContent = 'This master could not start. Try again or replace the MP3.';
    }
  });

  seek.addEventListener('input', () => {
    if (Number.isFinite(audio.duration)) audio.currentTime = (Number(seek.value) / 100) * audio.duration;
  });
});

const idleProfiles = cards.map((_, cardIndex) => {
  return Array.from({ length: 72 }, (_, index) => {
    const wave = Math.abs(Math.sin(index * 0.39 + cardIndex * 1.7));
    const pulse = Math.abs(Math.cos(index * 0.13 - cardIndex));
    return 0.16 + wave * pulse * 0.48;
  });
});

function drawSpectrum(card, cardIndex) {
  const canvas = card.querySelector('.spectrum');
  const context = canvas.getContext('2d');
  const width = canvas.width;
  const height = canvas.height;
  const isActive = card.classList.contains('is-playing') && card.querySelector('audio') === activeAudio && activeAnalyser;
  let values = idleProfiles[cardIndex];

  if (isActive) {
    const data = new Uint8Array(activeAnalyser.frequencyBinCount);
    activeAnalyser.getByteFrequencyData(data);
    values = Array.from({ length: 72 }, (_, index) => data[Math.floor((index / 72) * data.length)] / 255);
  }

  context.clearRect(0, 0, width, height);
  const gap = 5;
  const barWidth = (width - gap * 71) / 72;
  values.forEach((value, index) => {
    const floor = isActive ? 8 : 5;
    const barHeight = Math.max(floor, value * height * (isActive ? 0.96 : 0.52));
    context.fillStyle = isActive ? 'rgba(240, 25, 53, 0.96)' : 'rgba(255, 255, 255, 0.47)';
    context.fillRect(index * (barWidth + gap), (height - barHeight) / 2, barWidth, barHeight);
  });
}

function animate() {
  cards.forEach(drawSpectrum);
  requestAnimationFrame(animate);
}

animate();
