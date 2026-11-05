(() => {
  // HLS subtitle tracks are exposed by hls.js, not Chrome's native control UI. Always show the
  // CC button while a stream is playing; if the HLS manifest has no tracks, explain that in-menu.
  const wrap = document.getElementById('cc-wrap');
  const button = document.getElementById('cc');
  const menu = document.getElementById('cc-menu');
  if (!wrap || !button || !menu) return;

  const SETTINGS_KEY = 'subtitleStyle';
  const defaults = {
    font: 'system-ui, sans-serif', size: 100, color: '#ffffff', background: '#000000',
    backgroundOpacity: 75, bold: false, italic: false,
  };
  let style = { ...defaults };
  const attached = new WeakSet();
  wrap.hidden = true;
  menu.hidden = true;
  button.setAttribute('aria-expanded', 'false');

  const playerStreams = () => (typeof streams === 'undefined' ? [] : streams);
  const current = () => playerStreams()[0];
  const tracksFor = (stream) => stream?.hls?.subtitleTracks ?? [];
  const applyStyle = () => {
    const opacity = Math.max(0, Math.min(100, Number(style.backgroundOpacity))) / 100;
    const background = style.background || '#000000';
    const rgb = background.match(/[\da-f]{2}/gi)?.map((part) => parseInt(part, 16)) ?? [0, 0, 0];
    for (const video of document.querySelectorAll('video')) {
      video.style.setProperty('--subtitle-font', style.font);
      video.style.setProperty('--subtitle-size', `${style.size}%`);
      video.style.setProperty('--subtitle-color', style.color);
      video.style.setProperty('--subtitle-background', `rgba(${rgb.join(', ')}, ${opacity})`);
      video.classList.toggle('subtitle-bold', !!style.bold);
      video.classList.toggle('subtitle-italic', !!style.italic);
    }
  };

  chrome.storage.local.get(SETTINGS_KEY).then((saved) => {
    style = { ...defaults, ...(saved[SETTINGS_KEY] || {}) };
    applyStyle();
    render();
  }).catch((err) => console.warn('[stream-sniffer] could not load subtitle appearance:', err));

  function saveStyle() {
    applyStyle();
    chrome.storage.local.set({ [SETTINGS_KEY]: style }).catch((err) => {
      console.warn('[stream-sniffer] could not save subtitle appearance:', err);
    });
  }

  // Preserve the labels and language tags advertised by the stream; don't prefer or translate any language.
  function trackName(track, index) {
    return String(track?.name || track?.lang || track?.title || `Subtitle ${index + 1}`).trim() || `Subtitle ${index + 1}`;
  }

  function selectTrack(index) {
    const stream = current();
    if (!stream?.hls) return;
    stream.hls.subtitleDisplay = true;
    stream.hls.subtitleTrack = index;
    render();
  }

  function menuButton(label, selected, onClick, hint = '') {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'cc-track';
    item.setAttribute('role', 'menuitemradio');
    item.setAttribute('aria-checked', String(selected));
    const text = document.createElement('span');
    text.textContent = label;
    item.append(text);
    if (hint) {
      const lang = document.createElement('span');
      lang.className = 'rate';
      lang.textContent = hint.toUpperCase();
      item.append(lang);
    }
    item.addEventListener('click', onClick);
    return item;
  }

  function makeLabel(text, control) {
    const label = document.createElement('label');
    const name = document.createElement('span');
    name.textContent = text;
    label.append(name, control);
    return label;
  }

  function makeSelect(options, value, onChange) {
    const select = document.createElement('select');
    for (const [label, val] of options) {
      const option = document.createElement('option');
      option.textContent = label;
      option.value = val;
      select.append(option);
    }
    select.value = String(value);
    select.addEventListener('change', () => onChange(select.value));
    return select;
  }

  function buildMenu() {
    const stream = current();
    const tracks = tracksFor(stream);
    const selected = stream?.hls?.subtitleTrack ?? -1;
    const trackList = document.createElement('div');
    trackList.className = 'cc-tracks';
    if (!tracks.length) {
      const empty = document.createElement('div');
      empty.className = 'cc-empty';
      empty.textContent = 'No subtitle tracks are listed in this HLS stream.';
      trackList.append(empty);
    } else {
      trackList.append(menuButton('Off', selected < 0, () => selectTrack(-1)));
      tracks.forEach((track, index) => {
        trackList.append(menuButton(trackName(track, index), selected === index, () => selectTrack(index), track?.lang || ''));
      });
    }

    const stylePanel = document.createElement('section');
    stylePanel.className = 'cc-style';
    const heading = document.createElement('h3');
    heading.textContent = 'Subtitle appearance';
    stylePanel.append(heading);

    const font = makeSelect([
      ['System sans-serif', 'system-ui, sans-serif'], ['Arial', 'Arial, sans-serif'],
      ['Serif', 'Georgia, serif'], ['Monospace', 'monospace'],
    ], style.font, (value) => { style.font = value; saveStyle(); });
    stylePanel.append(makeLabel('Font', font));
    const size = makeSelect([['75%', 75], ['90%', 90], ['100%', 100], ['125%', 125], ['150%', 150], ['175%', 175]], style.size, (value) => {
      style.size = Number(value); saveStyle();
    });
    stylePanel.append(makeLabel('Font size', size));

    const color = document.createElement('input');
    color.type = 'color'; color.value = style.color; color.setAttribute('aria-label', 'Subtitle text color');
    color.addEventListener('input', () => { style.color = color.value; saveStyle(); });
    stylePanel.append(makeLabel('Text color', color));
    const background = document.createElement('input');
    background.type = 'color'; background.value = style.background; background.setAttribute('aria-label', 'Subtitle background color');
    background.addEventListener('input', () => { style.background = background.value; saveStyle(); });
    stylePanel.append(makeLabel('Background', background));
    const opacity = document.createElement('input');
    opacity.type = 'range'; opacity.min = '0'; opacity.max = '100'; opacity.step = '5';
    opacity.value = String(style.backgroundOpacity); opacity.setAttribute('aria-label', 'Subtitle background opacity');
    opacity.addEventListener('input', () => { style.backgroundOpacity = Number(opacity.value); saveStyle(); });
    stylePanel.append(makeLabel('Background opacity', opacity));
    const bold = document.createElement('input');
    bold.type = 'checkbox'; bold.checked = !!style.bold;
    bold.addEventListener('change', () => { style.bold = bold.checked; saveStyle(); });
    stylePanel.append(makeLabel('Bold', bold));
    const italic = document.createElement('input');
    italic.type = 'checkbox'; italic.checked = !!style.italic;
    italic.addEventListener('change', () => { style.italic = italic.checked; saveStyle(); });
    stylePanel.append(makeLabel('Italic', italic));
    const reset = document.createElement('button');
    reset.type = 'button'; reset.textContent = 'Reset appearance';
    reset.addEventListener('click', () => { style = { ...defaults }; saveStyle(); buildMenu(); });
    stylePanel.append(reset);
    menu.replaceChildren(trackList, stylePanel);
  }

  function render() {
    const stream = current();
    // Don't hide CC just because subtitleTracks hasn't loaded yet or the playlist lacks tracks.
    wrap.hidden = !stream?.hls || !!stream.casting;
    if (wrap.hidden) {
      menu.hidden = true;
      button.setAttribute('aria-expanded', 'false');
      return;
    }
    const tracks = tracksFor(stream);
    const selected = stream.hls.subtitleTrack ?? -1;
    button.dataset.active = String(selected >= 0);
    button.title = selected >= 0 && tracks[selected]
      ? `Subtitles: ${trackName(tracks[selected], selected)}`
      : tracks.length ? 'Subtitles: Off' : 'Subtitles (track availability shown in menu)';
    button.setAttribute('aria-label', button.title);
    if (!menu.hidden) buildMenu();
  }

  button.addEventListener('click', () => {
    if (wrap.hidden) return;
    menu.hidden = !menu.hidden;
    button.setAttribute('aria-expanded', String(!menu.hidden));
    if (!menu.hidden) buildMenu();
  });
  addEventListener('pointerdown', (event) => {
    if (!wrap.contains(event.target)) {
      menu.hidden = true;
      button.setAttribute('aria-expanded', 'false');
    }
  });
  addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !menu.hidden) {
      menu.hidden = true;
      button.setAttribute('aria-expanded', 'false');
    }
  });

  // StartStream creates Hls instances dynamically; attach to track events and poll only for current
  // player state transitions. The CC control is available even before track discovery completes.
  setInterval(() => {
    for (const stream of playerStreams()) {
      const hls = stream.hls;
      if (!hls || attached.has(hls)) continue;
      attached.add(hls);
      for (const event of [Hls.Events.SUBTITLE_TRACKS_UPDATED, Hls.Events.SUBTITLE_TRACK_SWITCH, Hls.Events.SUBTITLE_TRACK_LOADED]) {
        if (event) hls.on(event, () => stream === current() && render());
      }
    }
    render();
  }, 300);

  applyStyle();
  render();
})();
