(() => {
  const wrap = document.getElementById('cc-wrap');
  const button = document.getElementById('cc');
  const menu = document.getElementById('cc-menu');
  if (!wrap || !button || !menu) return;

  const STYLE_KEY = 'subtitleStyle';
  const ALWAYS_KEY = 'subtitleAlwaysShow';
  const defaults = {
    font: 'system-ui, sans-serif', size: 100, color: '#ffffff', background: '#000000',
    backgroundOpacity: 90, bold: false, italic: false,
  };
  let style = { ...defaults };
  let alwaysShow = true;
  let menuOpen = false;
  let menuDirty = true;
  const attached = new WeakSet();
  wrap.hidden = true;
  menu.hidden = true;
  button.setAttribute('aria-expanded', 'false');

  const playerStreams = () => (typeof streams === 'undefined' ? [] : streams);
  const current = () => playerStreams()[0];
  const hlsTracks = (stream) => stream?.hls?.subtitleTracks ?? [];
  const nativeTracks = (stream) => {
    const list = stream?.video?.textTracks;
    if (!list) return [];
    return Array.from(list).filter((track) => track.kind === 'subtitles' || track.kind === 'captions');
  };

  function applyStyle() {
    const opacity = Math.max(0, Math.min(100, Number(style.backgroundOpacity))) / 100;
    const rgb = style.background.match(/[\da-f]{2}/gi)?.map((part) => parseInt(part, 16)) ?? [0, 0, 0];
    for (const video of document.querySelectorAll('video')) {
      video.style.setProperty('--subtitle-font', style.font);
      video.style.setProperty('--subtitle-size', `${style.size}%`);
      video.style.setProperty('--subtitle-color', style.color);
      video.style.setProperty('--subtitle-background', `rgba(${rgb.join(', ')}, ${opacity})`);
      video.classList.toggle('subtitle-bold', !!style.bold);
      video.classList.toggle('subtitle-italic', !!style.italic);
    }
  }
  function saveStyle() {
    applyStyle();
    chrome.storage.local.set({ [STYLE_KEY]: style }).catch((err) => console.warn('[stream-sniffer] subtitle style save failed:', err));
  }
  chrome.storage.local.get([STYLE_KEY, ALWAYS_KEY]).then((saved) => {
    style = { ...defaults, ...(saved[STYLE_KEY] || {}) };
    alwaysShow = saved[ALWAYS_KEY] !== false;
    applyStyle();
    markMenuDirty();
    render();
    if (alwaysShow) enableAvailableSubtitles(current());
  }).catch((err) => console.warn('[stream-sniffer] subtitle settings load failed:', err));

  function trackName(track, index) {
    return String(track?.name || track?.lang || track?.label || track?.title || `Subtitle ${index + 1}`).trim() || `Subtitle ${index + 1}`;
  }
  function setNativeTrack(stream, active) {
    for (const track of nativeTracks(stream)) track.mode = track === active ? 'showing' : 'disabled';
  }
  function enableAvailableSubtitles(stream) {
    if (!stream?.hls) return;
    const hls = stream.hls;
    const tracks = hlsTracks(stream);
    if (tracks.length) {
      hls.subtitleDisplay = true;
      if (hls.subtitleTrack < 0) hls.subtitleTrack = 0;
      setNativeTrack(stream, null);
      return;
    }
    const tracksOnVideo = nativeTracks(stream);
    if (tracksOnVideo.length && !tracksOnVideo.some((track) => track.mode === 'showing')) {
      setNativeTrack(stream, tracksOnVideo[0]);
    }
  }
  function turnOff() {
    const stream = current();
    if (!stream?.hls) return;
    stream.hls.subtitleTrack = -1;
    setNativeTrack(stream, null);
    markMenuDirty();
    render();
  }
  function chooseHls(index) {
    const stream = current();
    if (!stream?.hls) return;
    setNativeTrack(stream, null);
    stream.hls.subtitleDisplay = true;
    stream.hls.subtitleTrack = index;
    markMenuDirty();
    render();
  }
  function chooseNative(track) {
    const stream = current();
    if (!stream?.hls) return;
    stream.hls.subtitleTrack = -1;
    setNativeTrack(stream, track);
    markMenuDirty();
    render();
  }

  function makeLabel(text, control) {
    const label = document.createElement('label');
    const caption = document.createElement('span');
    caption.textContent = text;
    label.append(caption, control);
    return label;
  }
  function addTrackOption(list, text, selected, onSelect, language = '') {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'cc-track';
    item.setAttribute('role', 'menuitemradio');
    item.setAttribute('aria-checked', String(selected));
    const name = document.createElement('span');
    name.textContent = text;
    item.append(name);
    if (language) {
      const lang = document.createElement('span');
      lang.className = 'cc-language';
      lang.textContent = language;
      item.append(lang);
    }
    item.addEventListener('click', onSelect);
    list.append(item);
  }
  function addSelect(panel, label, options, value, onChange) {
    const select = document.createElement('select');
    for (const [text, optionValue] of options) {
      const option = document.createElement('option');
      option.textContent = text;
      option.value = String(optionValue);
      select.append(option);
    }
    select.value = String(value);
    select.addEventListener('change', () => onChange(select.value));
    panel.append(makeLabel(label, select));
  }

  function markMenuDirty() {
    menuDirty = true;
    if (menuOpen) renderMenu();
  }
  function renderMenu() {
    if (!menuOpen || !menuDirty) return;
    menuDirty = false;
    const stream = current();
    const hs = hlsTracks(stream);
    const ns = nativeTracks(stream);
    const selected = stream?.hls?.subtitleTrack ?? -1;
    const activeNative = ns.find((track) => track.mode === 'showing');
    const tracks = document.createElement('div');
    tracks.className = 'cc-tracks';
    addTrackOption(tracks, 'Off', selected < 0 && !activeNative, turnOff);
    hs.forEach((track, i) => addTrackOption(tracks, trackName(track, i), selected === i, () => chooseHls(i), track.lang || ''));
    ns.forEach((track, i) => addTrackOption(tracks, trackName(track, i), activeNative === track, () => chooseNative(track), track.language || ''));
    if (!hs.length && !ns.length) {
      const empty = document.createElement('p');
      empty.className = 'cc-empty';
      empty.textContent = 'No subtitle tracks are exposed by this stream. Captions provided only by the source website are not part of the captured stream.';
      tracks.append(empty);
    }

    const panel = document.createElement('section');
    panel.className = 'cc-style';
    const title = document.createElement('h3');
    title.textContent = 'Subtitle appearance';
    panel.append(title);

    const auto = document.createElement('input');
    auto.type = 'checkbox';
    auto.checked = alwaysShow;
    auto.addEventListener('change', () => {
      alwaysShow = auto.checked;
      chrome.storage.local.set({ [ALWAYS_KEY]: alwaysShow }).catch((err) => console.warn('[stream-sniffer] subtitle setting save failed:', err));
      if (alwaysShow) enableAvailableSubtitles(current());
      else turnOff();
      markMenuDirty();
    });
    panel.append(makeLabel('Always show when available', auto));

    addSelect(panel, 'Font', [
      ['System sans-serif', 'system-ui, sans-serif'], ['Arial', 'Arial, sans-serif'],
      ['Verdana', 'Verdana, sans-serif'], ['Trebuchet MS', 'Trebuchet MS, sans-serif'],
      ['Georgia', 'Georgia, serif'], ['Times New Roman', 'Times New Roman, serif'],
      ['Courier New', 'Courier New, monospace'], ['Monospace', 'monospace'],
    ], style.font, (value) => { style.font = value; saveStyle(); });
    addSelect(panel, 'Font size', [['50%', 50], ['75%', 75], ['90%', 90], ['100%', 100], ['125%', 125], ['150%', 150], ['175%', 175], ['200%', 200]], style.size, (value) => {
      style.size = Number(value); saveStyle();
    });

    const color = document.createElement('input');
    color.type = 'color'; color.value = style.color;
    color.addEventListener('input', () => { style.color = color.value; saveStyle(); });
    panel.append(makeLabel('Text color', color));
    const background = document.createElement('input');
    background.type = 'color'; background.value = style.background;
    background.addEventListener('input', () => { style.background = background.value; saveStyle(); });
    panel.append(makeLabel('Background color', background));
    const opacity = document.createElement('input');
    opacity.type = 'range'; opacity.min = '0'; opacity.max = '100'; opacity.step = '5'; opacity.value = String(style.backgroundOpacity);
    opacity.addEventListener('input', () => { style.backgroundOpacity = Number(opacity.value); saveStyle(); });
    panel.append(makeLabel(`Background opacity: ${style.backgroundOpacity}%`, opacity));
    const bold = document.createElement('input');
    bold.type = 'checkbox'; bold.checked = !!style.bold;
    bold.addEventListener('change', () => { style.bold = bold.checked; saveStyle(); });
    panel.append(makeLabel('Bold', bold));
    const italic = document.createElement('input');
    italic.type = 'checkbox'; italic.checked = !!style.italic;
    italic.addEventListener('change', () => { style.italic = italic.checked; saveStyle(); });
    panel.append(makeLabel('Italic', italic));
    const reset = document.createElement('button');
    reset.type = 'button'; reset.textContent = 'Reset appearance';
    reset.addEventListener('click', () => { style = { ...defaults }; saveStyle(); markMenuDirty(); });
    panel.append(reset);
    menu.replaceChildren(tracks, panel);
  }

  function render() {
    const stream = current();
    wrap.hidden = !stream?.hls || !!stream.casting;
    if (wrap.hidden) {
      menuOpen = false;
      menu.hidden = true;
      button.setAttribute('aria-expanded', 'false');
      return;
    }
    const hs = hlsTracks(stream);
    const ns = nativeTracks(stream);
    const selected = stream.hls.subtitleTrack ?? -1;
    const activeNative = ns.find((track) => track.mode === 'showing');
    const activeTrack = selected >= 0 ? hs[selected] : activeNative;
    button.dataset.active = String(!!activeTrack);
    button.title = activeTrack ? `Subtitles: ${trackName(activeTrack, Math.max(0, hs.indexOf(activeTrack)))}` : 'Subtitles';
    button.setAttribute('aria-label', button.title);
    renderMenu();
  }

  button.addEventListener('click', () => {
    if (wrap.hidden) return;
    menuOpen = !menuOpen;
    menu.hidden = !menuOpen;
    button.setAttribute('aria-expanded', String(menuOpen));
    if (menuOpen) { menuDirty = true; renderMenu(); }
  });
  // Use click (not pointerdown) so native select/color controls can receive their own pointer events
  // without the outside-click handler closing the panel before the browser opens its picker.
  document.addEventListener('click', (event) => {
    if (!wrap.contains(event.target) && menuOpen) {
      menuOpen = false;
      menu.hidden = true;
      button.setAttribute('aria-expanded', 'false');
    }
  });
  document.addEventListener('keydown', (event) => {
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
      const update = () => {
        if (alwaysShow) enableAvailableSubtitles(stream);
        if (stream === current()) { markMenuDirty(); render(); }
      };
      for (const event of [Hls.Events.SUBTITLE_TRACKS_UPDATED, Hls.Events.SUBTITLE_TRACK_SWITCH, Hls.Events.SUBTITLE_TRACK_LOADED]) {
        if (event) hls.on(event, update);
      }
      stream.video.textTracks?.addEventListener?.('addtrack', update);
      if (alwaysShow) enableAvailableSubtitles(stream);
    }
    render();
  }, 300);

  applyStyle();
  render();
})();
