/* Official YouTube IFrame API only. No audio extraction, hidden playback or API key. */
'use strict';
(() => {
  const root = document.getElementById('lorianoMini');
  if (!root || !window.LorianoQueue) return;
  const PLAYLIST = 'PLw0Eei7VXrvLJuQGHTo56dq0bGX9cKhy-';
  const KEY = 'loriano-mini-player-v1';
  const $ = selector => root.querySelector(selector);
  const ui = { title: $('#mpTitle'), note: $('#mpNote'), play: $('#mpPlay'), previous: $('#mpPrevious'), next: $('#mpNext'), stop: $('#mpStop'), mode: $('#mpMode'), range: $('#mpSeek'), elapsed: $('#mpElapsed'), total: $('#mpTotal'), stage: $('#mpStage'), expand: $('#mpExpand'), storage: $('#mpStorage') };
  const modes = { shuffle: ['랜덤', 'Shuffle'], sequential: ['순차', 'Sequential'], repeat: ['전체 반복', 'Repeat Playlist'] };
  const icons = {
    play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 5 10 7-10 7Z" fill="currentColor" stroke="none"/></svg>',
    pause: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14M16 5v14" stroke-width="4"/></svg>'
  };
  let saved = {};
  try {
    const value = JSON.parse(localStorage.getItem(KEY) || '{}');
    if (value && value.version === 1 && value.playlist === PLAYLIST) saved = value;
  } catch { ui.storage.hidden = false; }
  let mode = window.LorianoQueue.modes.includes(saved.mode) ? saved.mode : 'shuffle';
  let position = Math.max(0, Number(saved.position) || 0);
  let duration = Math.max(0, Number(saved.duration) || 0);
  let title = typeof saved.title === 'string' ? saved.title.slice(0, 500) : '';
  const catalog = window.LorianoPlaylistCatalog?.playlist === PLAYLIST ? window.LorianoPlaylistCatalog : null;
  let tracks = catalog?.tracks || [];
  let queue = new window.LorianoQueue(tracks.map(track => track.id), { ...saved, mode });
  if (queue.current !== saved.current) { position = 0; duration = 0; title = ''; }
  title = title || tracks.find(track => track.id === queue.current)?.title || '';
  let playlistNote = catalog ? '목록 기준 ' + catalog.updatedAt : '재생목록 연결 전';
  let player, detail, apiPromise, preparing, ready = false, intent = false, playing = false;
  let selected = '', switching = false, movingSeek = false, lastPersist = 0, observedFrame;
  let failed = new Set(), lastError = '', apiTimer;
  const time = value => {
    const n = Math.max(0, Math.floor(Number(value) || 0));
    return (n >= 3600 ? Math.floor(n / 3600) + ':' + String(Math.floor(n % 3600 / 60)).padStart(2, '0') : Math.floor(n / 60)) + ':' + String(n % 60).padStart(2, '0');
  };
  const note = text => { ui.note.textContent = text; ui.note.title = text; };
  function render() {
    ui.title.textContent = title || '수빈이의 찬양 피아노 아카이브';
    ui.title.title = ui.title.textContent;
    ui.mode.textContent = modes[mode][0];
    ui.mode.title = '재생 모드: ' + modes[mode][1] + ' · 눌러서 변경';
    ui.mode.setAttribute('aria-label', '재생 모드: ' + modes[mode][0] + ', 눌러서 변경');
    ui.play.innerHTML = playing ? icons.pause : icons.play;
    ui.play.setAttribute('aria-label', playing ? '일시정지' : '재생');
    ui.play.title = playing ? '일시정지' : '재생';
    ui.previous.disabled = !queue || queue.cursor <= 0;
    $('#mpCatalogInfo').textContent = playlistNote;
    ui.next.disabled = !queue?.ids.length;
    ui.stop.disabled = !ready || !queue;
    ui.range.disabled = !ready || !duration || switching;
    ui.range.max = String(duration || 1);
    if (!movingSeek) ui.range.value = String(Math.min(position, duration || 0));
    ui.range.setAttribute('aria-valuetext', time(position) + ' / ' + time(duration));
    ui.elapsed.textContent = time(position);
    ui.total.textContent = time(duration);
  }
  function persist() {
    try {
      localStorage.setItem(KEY, JSON.stringify({ version: 1, playlist: PLAYLIST, ...(queue ? queue.snapshot() : saved), mode, title, position, duration, updatedAt: Date.now() }));
    } catch { ui.storage.hidden = false; }
  }
  function pause(message) {
    intent = false;
    if (ready) player.pauseVideo();
    playing = false;
    if (message) note(message);
    persist(); render();
  }
  function expand(open) {
    if (!open) pause('영상 패널을 닫아 일시정지했어요.');
    ui.stage.hidden = !open;
    ui.expand.setAttribute('aria-expanded', String(open));
    ui.expand.setAttribute('aria-label', open ? '영상 패널 닫기' : '영상 패널 열기');
    if (open) ui.stage.scrollIntoView({ block: 'nearest', behavior: 'instant' });
  }
  function visible() {
    if (ui.stage.hidden || document.hidden) return false;
    const r = $('#mpVideo').getBoundingClientRect();
    const area = Math.max(0, Math.min(r.right, innerWidth) - Math.max(r.left, 0)) * Math.max(0, Math.min(r.bottom, innerHeight) - Math.max(r.top, 0));
    return r.width >= 200 && r.height >= 200 && area >= r.width * r.height * 0.5;
  }
  function pauseDetail() {
    try { detail?.pauseVideo(); } catch { /* Removed archive route. */ }
    const frame = document.getElementById('archiveVideoPlayer');
    frame?.contentWindow?.postMessage(JSON.stringify({ event: 'command', func: 'pauseVideo', args: [] }), 'https://www.youtube.com');
  }
  function bindDetail() {
    const frame = document.getElementById('archiveVideoPlayer');
    if (frame === observedFrame) return;
    detail = null;
    if (!frame) { observedFrame = null; return; }
    if (!window.YT?.Player) return;
    detail = new YT.Player(frame, { events: { onStateChange: event => {
      if (event.data === 1) pause('아카이브 영상을 재생해 음악을 일시정지했어요.');
    } } });
    observedFrame = frame;
  }
  function loadAPI() {
    if (window.YT?.Player) return Promise.resolve();
    if (apiPromise) return apiPromise;
    apiPromise = new Promise((resolve, reject) => {
      const previous = window.onYouTubeIframeAPIReady;
      let finished = false;
      const done = () => { if (!finished) { finished = true; clearTimeout(apiTimer); resolve(); } };
      window.onYouTubeIframeAPIReady = () => { try { previous?.(); } finally { done(); } };
      const script = document.createElement('script');
      script.src = 'https://www.youtube.com/iframe_api';
      script.async = true;
      script.onerror = () => { clearTimeout(apiTimer); reject(new Error('YouTube에 연결하지 못했어요. 연결 확인 후 다시 눌러 주세요.')); };
      apiTimer = setTimeout(() => reject(new Error('YouTube 연결이 늦어요. 연결 확인 후 다시 눌러 주세요.')), 20000);
      document.head.append(script);
    }).catch(error => { apiPromise = null; throw error; });
    return apiPromise;
  }
  function metadata() {
    if (!ready || !queue || switching) return;
    const data = player.getVideoData?.() || {};
    if (data.video_id !== queue.current) return;
    if (data.title) title = data.title;
    const total = player.getDuration();
    if (total > 0) duration = total;
    const current = player.getCurrentTime();
    // A restored cue may report zero before its first user-initiated playback.
    if (playing || current > 0) position = current;
    render();
  }
  function choose(id, start = 0, autoplay = false) {
    if (!id) return;
    selected = id;
    switching = true;
    intent = autoplay;
    playing = false;
    position = Math.max(0, start);
    duration = id === saved.current ? Math.max(0, Number(saved.duration) || 0) : 0;
    title = tracks.find(track => track.id === id)?.title || (id === saved.current ? String(saved.title || '') : '');
    note('곡을 준비하고 있어요…');
    render(); persist();
    if (!ready) { switching = false; intent = false; note('재생 버튼을 누르면 찬양이 시작돼요.'); render(); return; }
    player.cueVideoById({ videoId: id, startSeconds: position });
    // Read-only archive metadata is an optional fallback, never a playlist source.
    Promise.resolve(window.ArchiveEngine?.getVideos()).then(rows => {
      if (selected !== id || !Array.isArray(rows)) return;
      const row = rows.find(row => row.id === id && !row.sample);
      if (row) { title = title || row.title; duration = duration || Number(row.duration) || 0; render(); }
    }).catch(() => {});
  }
  function advance(direction, autoplay) {
    if (!queue) return;
    const id = direction < 0 ? queue.previous() : queue.next();
    if (!id) {
      pause(direction < 0 ? '이전 재생 이력이 없어요.' : '순차 재생을 마쳤어요. 다시 들으려면 재생을 눌러 주세요.');
      if (direction > 0) { position = 0; if (ready) player.cueVideoById({ videoId: queue.current, startSeconds: 0 }); }
      render(); persist(); return;
    }
    choose(id, 0, autoplay);
  }
  function stateChanged(event) {
    if (!queue || !ready) return;
    const state = event.data;
    const data = player.getVideoData?.() || {};
    if (data.video_id && data.video_id !== selected) return;
    if (state === 5) {
      switching = false;
      metadata();
      if (intent && visible()) { pauseDetail(); player.playVideo(); }
      else { intent = false; note('재생 버튼을 누르면 찬양이 시작돼요.'); }
    } else if (state === 1) {
      switching = false;
      if (!visible()) { pause('영상이 보이지 않아 일시정지했어요.'); return; }
      pauseDetail(); intent = true; playing = true; failed.clear(); lastError = '';
      note(queue.ids.length + '곡 · ' + modes[mode][1]);
      metadata();
    } else if (state === 2 && !switching) {
      playing = false; intent = false; metadata(); note('일시정지 · 마지막 위치를 기억해요.');
    } else if (state === 0 && !switching && (playing || intent)) {
      playing = false; position = 0;
      if (visible()) advance(1, true);
      else pause('다음 곡은 재생 버튼을 눌러 이어 들어요.');
    }
    render(); persist();
  }
  function playerError(event) {
    switching = false; intent = false; playing = false;
    const messages = { 2: '영상 주소를 확인할 수 없어요.', 5: '브라우저에서 영상을 재생할 수 없어요.', 100: '삭제되었거나 비공개인 영상이에요.', 101: '사이트 내 재생이 제한된 영상이에요.', 150: '사이트 내 재생이 제한된 영상이에요.', 153: 'YouTube가 사이트 출처를 확인하지 못했어요.' };
    lastError = messages[event.data] || 'YouTube 재생 중 오류가 발생했어요.';
    failed.add(queue?.current);
    note(lastError + ' 다음 곡 또는 YouTube 링크를 이용해 주세요.');
    // Never spin through unavailable tracks or retry with an unofficial endpoint.
    render(); persist();
  }
  async function refreshPlaylist() {
    // Reuse an already configured key. Never require or embed a new credential.
    let apiKey;
    try { apiKey = window.ArchiveEngine?.settings()?.apiKey; } catch {}
    if (!apiKey) return;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    try {
      const fresh = []; let pageToken = ''; const seenTokens = new Set();
      do {
        if (seenTokens.has(pageToken)) throw new Error('Repeated playlist page');
        seenTokens.add(pageToken);
        const url = new URL('https://www.googleapis.com/youtube/v3/playlistItems');
        for (const [key, value] of Object.entries({ part: 'snippet,contentDetails', playlistId: PLAYLIST, maxResults: '50', key: apiKey, ...(pageToken ? { pageToken } : {}) })) url.searchParams.set(key, value);
        const response = await fetch(url, { signal: controller.signal, credentials: 'omit' });
        if (!response.ok) throw new Error('Playlist refresh unavailable');
        const data = await response.json();
        for (const item of data.items || []) {
          const id = item.contentDetails?.videoId;
          if (/^[\w-]{11}$/.test(id || '') && !['Private video', 'Deleted video'].includes(item.snippet?.title)) fresh.push({ id, title: item.snippet?.title || '' });
        }
        pageToken = data.nextPageToken || '';
      } while (pageToken);
      if (fresh.length) {
        const old = queue.snapshot(); const oldId = queue.current;
        tracks = fresh; queue = new window.LorianoQueue(fresh.map(track => track.id), { ...old, mode });
        if (queue.current !== oldId) { position = 0; duration = 0; title = ''; }
        title = tracks.find(track => track.id === queue.current)?.title || title;
        playlistNote = '공식 API로 전체 목록 갱신 · ' + fresh.length + '곡';
      }
    } catch {
      playlistNote = '목록 갱신 불가 · 저장된 ' + tracks.length + '곡 사용 (' + (catalog?.updatedAt || '날짜 미상') + ')';
    } finally { clearTimeout(timeout); render(); }
  }
  async function prepare() {
    if (ready && queue) return;
    if (preparing) return preparing;
    preparing = (async () => {
      note('YouTube 재생목록을 연결하고 있어요…');
      await refreshPlaylist();
      await loadAPI();
      bindDetail();
      await new Promise((resolve, reject) => {
        let settled = false;
        const timeout = setTimeout(() => finish(new Error('재생목록 연결이 늦어요. 다시 시도하거나 YouTube에서 열어 주세요.')), 25000);
        const finish = error => {
          if (settled) return; settled = true; clearTimeout(timeout);
          if (error) reject(error); else resolve();
        };
        player = new YT.Player('mpYouTube', {
          width: '480', height: '270',
          videoId: queue.current || undefined,
          playerVars: { autoplay: 0, controls: 1, playsinline: 1, origin: location.origin, ...(queue.ids.length ? {} : { listType: 'playlist', list: PLAYLIST }) },
          events: {
            onReady: () => {
              ready = true;
              const started = Date.now();
              const read = () => {
                if (settled) return;
                const ids = queue.ids.length ? queue.ids : player.getPlaylist() || [];
                if (ids.length) {
                  if (!queue.ids.length) { queue = new window.LorianoQueue(ids, { ...saved, mode }); playlistNote = 'IFrame 제공 목록 ' + ids.length + '곡 · 전체 갱신에는 설정의 API 키가 필요해요.'; }
                  choose(queue.current, position, intent);
                  finish();
                } else if (Date.now() - started < 18000) setTimeout(read, 200);
                else finish(new Error('공개 재생목록을 불러오지 못했어요. YouTube에서 공개 상태를 확인해 주세요.'));
              };
              read();
            },
            onStateChange: stateChanged,
            onError: event => { playerError(event); if (!queue) finish(new Error(lastError)); },
            onAutoplayBlocked: () => pause('브라우저가 재생을 기다리고 있어요. 재생 버튼이나 영상의 재생을 눌러 주세요.')
          }
        });
      });
    })().catch(error => {
      intent = false; playing = false; ready = false;
      try { player?.destroy(); } catch {}
      $('#mpVideo').innerHTML = '<div id="mpYouTube"></div>';
      note(error.message); render();
      throw error;
    }).finally(() => { preparing = null; });
    return preparing;
  }
  ui.play.addEventListener('click', async () => {
    if (playing || intent) { pause('일시정지 · 마지막 위치를 기억해요.'); return; }
    pauseDetail();
    expand(true);
    intent = true;
    if (!queue?.ids.length || !ready) {
      try { await prepare(); } catch { /* Already shown in the compact status. */ }
      return;
    }
    if (lastError) { choose(queue.current, position, true); return; }
    if (visible()) { player.playVideo(); note('재생을 시작하고 있어요…'); }
  });
  ui.stop.addEventListener('click', () => {
    if (!ready || !queue) return;
    pause(); position = 0; switching = true;
    player.stopVideo();
    player.cueVideoById({ videoId: queue.current, startSeconds: 0 });
    note('정지 · 처음부터 다시 재생할 수 있어요.'); render(); persist();
  });
  ui.previous.addEventListener('click', () => advance(-1, playing || intent));
  ui.next.addEventListener('click', () => advance(1, playing || intent));
  ui.mode.addEventListener('click', () => {
    mode = window.LorianoQueue.modes[(window.LorianoQueue.modes.indexOf(mode) + 1) % 3];
    queue?.setMode(mode); render(); persist();
    note('재생 모드: ' + modes[mode][0] + (queue ? ' · ' + queue.ids.length + '곡' : ''));
  });
  ui.expand.addEventListener('click', async () => {
    const open = ui.stage.hidden;
    expand(open);
    if (open && !ready) { try { await prepare(); } catch {} }
  });
  ui.range.addEventListener('input', () => {
    movingSeek = true; ui.elapsed.textContent = time(ui.range.value);
    ui.range.setAttribute('aria-valuetext', time(ui.range.value) + ' / ' + time(duration));
  });
  ui.range.addEventListener('change', () => {
    position = Math.max(0, Math.min(duration, Number(ui.range.value)));
    if (ready) {
      if (player.getPlayerState() === 5 || player.getPlayerState() === -1) {
        // Seeking a CUED video via seekTo would start it without pressing Play.
        intent = false; switching = true;
        player.cueVideoById({ videoId: queue.current, startSeconds: position });
      } else player.seekTo(position, true);
    }
    movingSeek = false; render(); persist();
  });
  window.addEventListener('hashchange', () => {
    if (location.hash.startsWith('#video/')) pause('아카이브 영상을 열어 음악을 일시정지했어요.');
  });
  window.addEventListener('pagehide', () => { pause(); persist(); });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) pause('다른 화면으로 이동해 일시정지했어요.');
  });
  const checkVisibility = () => { if ((playing || (intent && ready)) && !visible()) pause('영상이 보이지 않아 일시정지했어요.'); };
  window.addEventListener('scroll', checkVisibility, { passive: true });
  window.addEventListener('resize', checkVisibility, { passive: true });
  new MutationObserver(bindDetail).observe(document.getElementById('view'), { childList: true, subtree: true });
  setInterval(() => {
    metadata(); checkVisibility();
    if (playing && Date.now() - lastPersist > 4000) { persist(); lastPersist = Date.now(); }
  }, 500);
  note(saved.current ? '마지막으로 들은 곡 · 재생을 눌러 이어 들어요.' : '재생을 눌러 작은 찬양을 시작해 보세요.');
  render();
})();
