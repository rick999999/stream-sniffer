(() => {
  // HLS subtitle tracks are controlled by hls.js. Also expose TextTracks already attached to the
  // video, since some sources expose their captions natively rather than through the HLS manifest.
  const wrap = document.getElementById('cc-wrap');
  const button = document.getElementById('cc');
  const menu = document.getElementById('cc-menu');
  if (!wrap || !button || !menu) return;

  const STYLE_KEY = 'subtitleStyle';
  const ALWAYS_KEY = 'subtitleAlwaysShow';
  const styleDefaults = {
    font: 'system-ui, sans-serif', size: 100, color: '#ffffff', background: '#000000',
    backgroundOpacity: 75, bold: false, italic: false,
  };
  let style = { ...styleDefaults };
  let alwaysShow = true;
  let menuOpen = false;
  const attached = new WeakSet();
  wrap.hidden = true;
  menu.hidden = true;
  button.setAttribute('aria-expanded', 'false');

  const playerStreams = () => (typeof streams === 'undefined' ? [] : streams);
  const current = () => playerStreams()[0];
  const hlsTracks = (stream) => stream?.hls?.subtitleTracks ?? [];
  const nativeTracks = (stream) => {
    if (!stream?.video?.textTracks) return [];
    return Array.from(stream.video.textTracks).filter((track) => ['subtitles', 'captions'].includes(track.kind));
  };
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

  chrome.storage.local.get([STYLE_KEY, ALWAYS_KEY]).then((saved) => {
    style = { ...styleDefaults, ...(saved[STYLE_KEY] || {}) };
    alwaysShow = saved[ALWAYS_KEY] !== false;
    applyStyle();
    render();
    if (alwaysShow) enableAvailableSubtitles(current());
  }).catch((err) => console.warn('[stream-sniffer] could not load subtitle settings:', err));

  function persist(key, value) {
    chrome.storage.local.set({ [key]: value }).catch((err) => console.warn(`[stream-sniffer] could not save ${key}:`, err));
  }
  function saveStyle() {
    applyStyle();
    persist(STYLE_KEY, style);
  }
  // Keep the text exactly as the playlist/track provides it; do not translate or prefer a language.
  function trackName(track, index) {
    return String(track?.name || track?.lang || track?.label || track?.title || `Subtitle ${index + 1}`).trim() || `Subtitle ${index + 1}`;
  }

  function setNativeTrack(stream, selectedTrack) {
    for (const track of nativeTracks(stream)) {
      track.mode = track === selectedTrack ? 'showing' : 'disabled';
    }
  }

  function enableAvailableSubtitles(stream) {
    if (!stream?.hls) return;
    const hls = stream.hls;
    const hs = hlsTracks(stream);
    const ns = nativeTracks(stream);
    if (hs.length) {
      // Preserve an explicit user choice; if none is active yet, use the playlist's first track.
      if (hls.subtitleTrack < 0) hls.subtitleTrack = 0;
      hls.subtitleDisplay = true;
      setNativeTrack(stream, null);
    } else if (ns.length) {
      setNativeTrack(stream, ns.find((track) => track.mode === 'showing') || ns[0]);
    }
  }

  function selectHlsTrack(index) {
    const stream = current();
    if (!stream?.hls) return;
    setNativeTrack(stream, null);
    stream.hls.subtitleDisplay = true;
    stream.hls.subtitleTrack = index;
    render();
  }
  function selectNativeTrack(track) {
    const stream = current();
    if (!stream?.hls) return;
    stream.hls.subtitleTrack = -1;
    setNativeTrack(stream, track);
    render();
  }
  function turnOffSubtitles() {
    const stream = current();
    if (!stream?.hls) return;
    stream.hls.subtitleTrack = -1;
    setNativeTrack(stream, null);
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
    const hs = hlsTracks(stream);
    const ns = nativeTracks(stream);
    const selectedHls = stream?.hls?.subtitleTrack ?? -1;
    const activeNative = ns.find((track) => track.mode === 'showing');
    const trackList = document.createElement('div');
    trackList.className = 'cc-tracks';

    trackList.append(menuButton('Off', selectedHls < 0 && !activeNative, turnOffSubtitles));
    hs.forEach((track, index) => {
      trackList.append(menuButton(trackName(track, index), selectedHls === index, () => selectHlsTrack(index), track?.lang || ''));
    });
    ns.forEach((track, index) => {
      trackList.append(menuButton(trackName(track, index), activeNative === track, () => selectNativeTrack(track), track.language || ''));
    });
    if (!hs.length && !ns.length) {
      const empty = document.createElement('div');
      empty.className = 'cc-empty';
      empty.textContent = 'No subtitle tracks are currently exposed by this stream. If the original site has separate captions, they are not included in the captured stream.';
      trackList.append(empty);
    }

    const stylePanel = document.createElement('section');
    stylePanel.className = 'cc-style';
    const heading = document.createElement('h3');
    heading.textContent = 'Subtitle appearance';
    stylePanel.append(heading);

    const always = document.createElement('input');
    always.type = 'checkbox';
    always.checked = alwaysShow;
    always.addEventListener('change', () => {
      alwaysShow = always.checked;
      persist(ALWAYS_KEY, alwaysShow);
      if (alwaysShow) enableAvailableSubtitles(current());
      else turnOffSubtitles();
      render();
    });
    stylePanel.append(makeLabel('Always show subtitles when available', always));

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
    reset.addEventListener('click', () => { style = { ...styleDefaults }; saveStyle(); buildMenu(); });
    stylePanel.append(reset);
    menu.replaceChildren(trackList, stylePanel);
  }

  function render() {
    const stream = current();
    // Always offer the control while a stream is playing, including before track discovery.
    wrap.hidden = !stream?.hls || !!stream.casting;
    if (wrap.hidden) {
      menu.hidden = true;
      button.setAttribute('aria-expanded', 'false');
      return;
    }
    const hs = hlsTracks(stream);
    const ns = nativeTracks(stream);
    const selected = stream.hls.subtitleTrack ?? -1;
    const selectedNative = ns.find((track) => track.mode === 'showing');
    button.dataset.active = String(selected >= 0 || !!selectedNative);
    const selectedTrack = selected >= 0 && hs[selected] ? hs[selected] : selectedNative;
    button.title = selectedTrack ? `Subtitles: ${trackName(selectedTrack, Math.max(0, hs.indexOf(selectedTrack)))}` : 'Subtitles';
    button.setAttribute('aria-label', button.title);
    if (!menu.hidden) buildMenu();
  }

  button.addEventListener('click', () => {
    if (wrap.hidden) return;
    menuOpen = !menuOpen;
    menu.hidden = !menuOpen;
    button.setAttribute('aria-expanded', String(menuOpen));
    if (menuOpen) buildMenu();
  });
  addEventListener('pointerdown', (event) => {
    if (!wrap.contains(event.target)) {
      menuOpen = false;
      menu.hidden = true;
      button.setAttribute('aria-expanded', 'false');
    }
  });
  addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && menuOpen) {
      menuOpen = false;
      menu.hidden = true;
      button.setAttribute('aria-expanded', 'false');
    }
  });

  setInterval(() => {
    for (const stream of playerStreams()) {
      const hls = stream.hls;
      if (!hls || attached.has(hls)) continue;
      attached.add(hls);
      for (const event of [Hls.Events.SUBTITLE_TRACKS_UPDATED, Hls.Events.SUBTITLE_TRACK_SWITCH, Hls.Events.SUBTITLE_TRACK_LOADED]) {
        if (event) hls.on(event, () => {
          if (alwaysShow) enableAvailableSubtitles(stream);
          if (stream === current()) render();
        });
      }
      stream.video.textTracks?.addEventListener?.('addtrack', () => {
        if (alwaysShow) enableAvailableSubtitles(stream);
        if (stream === current()) render();
      });
    }
    if (alwaysShow) {
      for (const stream of playerStreams()) {
        if (stream.hls && stream === current()) enableAvailableSubtitles(stream);
      }
    }
    render();
  }, 300);

  applyStyle();
  render();
})();
