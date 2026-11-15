/* Official YouTube IFrame API only. No audio extraction, hidden playback or API key. */
'use strict';
(() => {
  const root = document.getElementById('lorianoMini');
  if (!root || !window.LorianoQueue) return;
  const PLAYLIST = 'PLw0Eei7VXrvLJuQGHTo56dq0bGX9cKhy-';
  const WORKER_JSON = 'https://loriano-playlist-sync.subinan0204.workers.dev/api/playlist';
  const KEY = 'loriano-mini-player-v1';
  const $ = selector => root.querySelector(selector);
  const allowed = id => typeof id === 'string' && /^[\w-]{11}$/.test(id) && id !== 'F5jQv9RPmhE';
  const cleanTracks = rows => [...new Map((Array.isArray(rows) ? rows : []).filter(track => allowed(track?.id)).map(track => [track.id, { id: track.id, title: String(track.title || '').slice(0, 500) }])).values()];
  let publicSnapshot = null, publicSnapshotAt = 0, publicSnapshotRequest = null;
  async function getPublicSnapshot(force = false) {
    if (!force && publicSnapshot && Date.now() - publicSnapshotAt < 60000) return publicSnapshot;
    if (publicSnapshotRequest) return publicSnapshotRequest;
    publicSnapshotRequest = (async () => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);
      let data;
      try {
        const response = await fetch(WORKER_JSON, { credentials: 'omit', cache: force ? 'no-store' : 'default', signal: controller.signal });
        if (!response.ok) throw new Error('Playlist feed unavailable');
        data = await response.json();
      } finally { clearTimeout(timeout); }
      if (data.schema !== 1 || data.playlistId !== PLAYLIST || !Array.isArray(data.tracks) || !data.tracks.length || data.count !== data.tracks.length) throw new Error('Invalid playlist feed');
      const unique = new Map();
      for (const track of data.tracks) {
        if (!allowed(track?.id) || unique.has(track.id)) throw new Error('Invalid or duplicate playlist ID');
        const publishedAt = Number.isFinite(Date.parse(track.publishedAt)) ? track.publishedAt : new Date(0).toISOString();
        const thumbnail = /^https:\/\/(i\.ytimg\.com|yt3\.ggpht\.com)\//i.test(track.thumbnail || '') ? track.thumbnail : 'https://i.ytimg.com/vi/' + track.id + '/mqdefault.jpg';
        unique.set(track.id, { id: track.id, title: String(track.title || 'YouTube 영상').slice(0, 500), description: String(track.description || '').slice(0, 10000), publishedAt, thumbnail, duration: Math.max(0, Number(track.duration) || 0), shorts: !!track.shorts, views: Math.max(0, Number(track.views) || 0), likes: Math.max(0, Number(track.likes) || 0), comments: Math.max(0, Number(track.comments) || 0), tags: Array.isArray(track.tags) ? track.tags.slice(0, 100).map(tag => String(tag).slice(0, 100)) : [], sample: false });
      }
      if (unique.size !== data.count) throw new Error('Incomplete playlist feed');
      const trustedCount = publicSnapshot?.count || window.LorianoPlaylistCatalog?.tracks?.length || 205;
      if (unique.size < trustedCount) throw new Error('Playlist count decreased; keeping last verified list');
      publicSnapshot = { schema: 1, playlistId: PLAYLIST, updatedAt: String(data.updatedAt || '최신'), count: unique.size, tracks: [...unique.values()] };
      publicSnapshotAt = Date.now();
      return publicSnapshot;
    })().finally(() => { publicSnapshotRequest = null; });
    return publicSnapshotRequest;
  }
  const legacyToggle = $('#mpExpand');
  legacyToggle?.remove();
  const closeButton = document.createElement('button');
  closeButton.type = 'button'; closeButton.id = 'mpClose'; closeButton.className = 'mp-close';
  closeButton.setAttribute('aria-label', '영상 패널 닫기'); closeButton.title = '영상 패널 닫기'; closeButton.textContent = '×';
  $('#mpMode')?.parentNode?.append(closeButton);
  const ui = { title: $('#mpTitle'), note: $('#mpNote'), play: $('#mpPlay'), previous: $('#mpPrevious'), next: $('#mpNext'), stop: $('#mpStop'), mode: $('#mpMode'), range: $('#mpSeek'), elapsed: $('#mpElapsed'), total: $('#mpTotal'), stage: $('#mpStage'), close: $('#mpClose'), storage: $('#mpStorage') };
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
  if (!allowed(saved.current)) saved = { ...saved, current: '', title: '', position: 0, duration: 0 };
  if (Array.isArray(saved.history)) {
    const cursor = Number.isInteger(saved.cursor) ? saved.cursor : saved.history.length - 1;
    saved = { ...saved, cursor: Math.max(0, saved.history.slice(0, cursor + 1).filter(allowed).length - 1), history: saved.history.filter(allowed) };
  }
  if (Array.isArray(saved.visited)) saved = { ...saved, visited: saved.visited.filter(allowed) };
  let mode = window.LorianoQueue.modes.includes(saved.mode) ? saved.mode : 'shuffle';
  let position = Math.max(0, Number(saved.position) || 0);
  let duration = Math.max(0, Number(saved.duration) || 0);
  let title = typeof saved.title === 'string' ? saved.title.slice(0, 500) : '';
  const catalog = window.LorianoPlaylistCatalog?.playlist === PLAYLIST ? window.LorianoPlaylistCatalog : null;
  // Playback candidates always belong to the designated public playlist, never personal storage.
  let tracks = [], catalogInitialized = false, catalogRevision = 0, publicRefresh = null, archiveRetry;
  let queue = new window.LorianoQueue(tracks.map(track => track.id), { ...saved, mode });
  // Preserve the saved position until the authoritative queue is available.
  title = title || tracks.find(track => track.id === queue.current)?.title || '';
  let manual = null, manualRevision = 0;
  const activeId = () => manual?.id || queue.current;
  const manualNote = () => '개별 영상 · 랜덤 후보' + queue.ids.length + '곡 별도';
  let playlistNote = '지정 재생목록 연결 중';
  let userInteracted = false;
  root.addEventListener('click', () => { userInteracted = true; }, true);
  root.addEventListener('input', () => { userInteracted = true; }, true);
  let player, detail, apiPromise, preparing, ready = false, intent = false, playing = false;
  let selected = '', switching = false, movingSeek = false, lastPersist = 0, observedFrame;
  let failed = new Set(), lastError = '', apiTimer, playerGeneration = 0, cancelPreparation;
  const time = value => {
    const n = Math.max(0, Math.floor(Number(value) || 0));
    return (n >= 3600 ? Math.floor(n / 3600) + ':' + String(Math.floor(n % 3600 / 60)).padStart(2, '0') : Math.floor(n / 60)) + ':' + String(n % 60).padStart(2, '0');
  };
  const note = text => { ui.note.textContent = text; ui.note.title = text; };
  function render() {
    ui.stage.classList.toggle('mp-portrait', !!manual?.portrait);
    ui.title.textContent = title || '수빈이의 찬양 피아노 아카이브';
    ui.title.title = ui.title.textContent;
    ui.mode.textContent = modes[mode][0];
    ui.mode.title = '재생 모드: ' + modes[mode][1] + ' · 눌러서 변경';
    ui.mode.setAttribute('aria-label', '재생 모드: ' + modes[mode][0] + ', 눌러서 변경');
    ui.play.innerHTML = playing ? icons.pause : icons.play;
    ui.play.setAttribute('aria-label', playing ? '일시정지' : '재생');
    ui.play.title = playing ? '일시정지' : '재생';
    ui.previous.disabled = manual ? !queue.ids.length : !queue || queue.cursor <= 0;
    $('#mpCatalogInfo').textContent = manual ? manualNote() : playlistNote;
    ui.next.disabled = !queue?.ids.length;
    ui.stop.disabled = !ready || !activeId();
    ui.range.disabled = !ready || !duration || switching;
    ui.range.max = String(duration || 1);
    if (!movingSeek) ui.range.value = String(Math.min(position, duration || 0));
    ui.range.setAttribute('aria-valuetext', time(position) + ' / ' + time(duration));
    ui.elapsed.textContent = time(position);
    ui.total.textContent = time(duration);
  }
  function persist() {
    if (!userInteracted) return;
    try {
      localStorage.setItem(KEY, JSON.stringify({ version: 1, playlist: PLAYLIST, ...(catalogInitialized ? queue.snapshot() : saved), mode, title: manual ? (tracks.find(track => track.id === queue.current)?.title || '') : title, position: manual ? 0 : position, duration: manual ? 0 : duration, manual: manual ? { id: manual.id, title, position, duration } : null, updatedAt: Date.now() }));
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
    ui.stage.hidden = !open;
    root.classList.toggle('mp-overlay-open', open);
    // The original top bar never moves into the floating video.
    ui.close.disabled = !open;
  }
  function closePanel() {
    ++manualRevision;
    metadata();
    ++playerGeneration;
    cancelPreparation?.(); cancelPreparation = null;
    intent = false; playing = false; switching = false; ready = false; preparing = null;
    const previousPlayer = player; player = null; selected = ''; lastError = '';
    try { previousPlayer?.stopVideo(); } catch {}
    try { previousPlayer?.destroy(); } catch {}
    $('#mpVideo').innerHTML = '<div id="mpYouTube"></div>';
    expand(false); note('영상 패널을 닫고 재생을 중단했어요.'); persist(); render();
  }
  function applyCatalog(snapshot, source) {
    const incoming = cleanTracks(snapshot?.tracks);
    const wasCurrent = queue?.current || '';
    const old = catalogInitialized ? queue.snapshot() : { ...saved, mode };
    const previousCurrent = catalogInitialized ? wasCurrent : saved.current;
    tracks = incoming;
    queue = new window.LorianoQueue(tracks.map(track => track.id), { ...old, mode });
    catalogInitialized = true;
    const removed = previousCurrent && queue.current !== previousCurrent;
    if (!manual && removed) { position = 0; duration = 0; title = ''; }
    if (!manual && !previousCurrent && queue.current) { position = 0; duration = 0; }
    const currentTrack = tracks.find(track => track.id === queue.current);
    if (!manual && (!playing || removed)) title = currentTrack?.title || '';
    playlistNote = '지정 재생목록 · ' + tracks.length + '곡 · ' + (snapshot?.updatedAt || '기준 목록');
    if (!manual && removed && ready) {
      intent = false; playing = false;
      if (queue.current) choose(queue.current, 0, false);
      else { switching = false; selected = ''; player.stopVideo(); }
    }
    if (!ready && !preparing && !intent) note('재생 버튼을 누르면 찬양이 시작돼요.');
    persist(); render();
  }
  async function refreshCatalog(force = false) {
    if (!catalogInitialized) {
      const fallback = publicSnapshot || catalog;
      if (fallback) applyCatalog(fallback, 'public');
    }
    if (!publicRefresh) publicRefresh = (async () => {
      try {
        const data = await getPublicSnapshot(force);
        // Do not remap an actively playing shuffle/history mid-track.
        if (!playing && !intent) applyCatalog(data, 'public');
        else { playlistNote = '지정 재생목록 · ' + data.count + '곡'; render(); }
        return true;
      } catch {
        playlistNote = '동기화 실패 · 마지막 정상 재생목록 ' + tracks.length + '곡 유지';
        if (!playing && !intent) note(playlistNote);
        render(); return false;
      } finally { publicRefresh = null; }
    })();
    if (force || !catalogInitialized) await publicRefresh;
    return catalogInitialized && queue.ids.length > 0;
  }
  function visible() {
    if (ui.stage.hidden || document.hidden) return false;
    const r = $('#mpVideo').getBoundingClientRect();
    const area = Math.max(0, Math.min(r.right, innerWidth) - Math.max(r.left, 0)) * Math.max(0, Math.min(r.bottom, innerHeight) - Math.max(r.top, 0));
    return Math.min(r.width, r.height) >= 90 && Math.max(r.width, r.height) >= 160 && area >= r.width * r.height * 0.5;
  }
  function pauseDetail() {
    try { detail?.pauseVideo(); } catch { /* Removed archive route. */ }
    const frame = document.getElementById('archiveVideoPlayer');
    frame?.contentWindow?.postMessage(JSON.stringify({ event: 'command', func: 'pauseVideo', args: [] }), 'https://www.youtube.com');
  }
  async function verifyManual(id) {
    if (!allowed(id)) throw new Error('개별 영상 주소를 확인하지 못했어요.');
    const rows = await window.ArchiveEngine?.getVideos();
    const row = Array.isArray(rows) ? rows.find(row => row?.id === id && !row.sample) : null;
    if (!row) throw new Error('개인 아카이브에서 영상을 확인하지 못했어요.');
    return { id, title: String(row.title || '').slice(0, 500), duration: Math.max(0, Number(row.duration) || 0), portrait: row.videoType === 'short' && Number.isInteger(row.aspectEvidence?.width) && row.aspectEvidence.width > 0 && Number.isInteger(row.aspectEvidence?.height) && row.aspectEvidence.height > 0 && row.aspectEvidence.width * 16 === row.aspectEvidence.height * 9 };
  }
  async function selectManual(id) {
    userInteracted = true;
    ui.close.disabled = false; // A pending archive lookup must remain cancellable.
    const revision = ++manualRevision;
    try {
      const row = await verifyManual(id);
      if (revision !== manualRevision) return;
      if (preparing) closePanel();
      metadata(); pauseDetail();
      manual = row; position = 0; duration = row.duration; title = row.title;
      lastError = ''; expand(true); intent = true;
      if (ready) choose(id, 0, true);
      else await prepare();
    } catch (error) { if (revision === manualRevision) { ui.close.disabled = ui.stage.hidden; note(error.message); render(); } }
  }
  function detailManualButton(frame) {
    const id = /^#video[/]([\w-]{11})(?:$|[?&/])/.exec(location.hash)?.[1];
    let button = document.getElementById('mpManualDetail');
    if (!frame || !allowed(id)) { button?.remove(); return; }
    if (!button) {
      button = document.createElement('button'); button.id = 'mpManualDetail'; button.type = 'button';
      button.textContent = '미니 플레이어로 보기';
      button.addEventListener('click', () => selectManual(button.getAttribute('data-mini-video')));
      frame.parentNode?.append(button);
    }
    if (button.getAttribute('data-mini-video') !== id) button.setAttribute('data-mini-video', id);
  }
  function bindDetail() {
    const frame = document.getElementById('archiveVideoPlayer');
    detailManualButton(frame);
    if (frame === observedFrame) return;
    try { detail?.pauseVideo(); } catch {}
    detail = null;
    if (!frame) { observedFrame = null; return; }
    if (!window.YT?.Player) { loadAPI().then(bindDetail).catch(() => {}); return; }
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
    if (data.video_id !== activeId()) return;
    if (data.title) title = data.title;
    const total = player.getDuration();
    if (total > 0) duration = total;
    const current = player.getCurrentTime();
    // A restored cue may report zero before its first user-initiated playback.
    if (playing || current > 0) position = current;
    render();
  }
  function choose(id, start = 0, autoplay = false) {
    if (!allowed(id) || (manual ? id !== manual.id : !queue?.ids.includes(id))) return;
    selected = id;
    switching = true;
    intent = autoplay;
    playing = false;
    position = Math.max(0, start);
    duration = manual ? (duration || manual.duration) : id === saved.current ? Math.max(0, Number(saved.duration) || 0) : 0;
    title = manual ? manual.title : tracks.find(track => track.id === id)?.title || (id === saved.current ? String(saved.title || '') : '');
    note('곡을 준비하고 있어요…');
    render(); persist();
    if (!ready) { switching = false; intent = false; note('재생 버튼을 누르면 찬양이 시작돼요.'); render(); return; }
    player.cueVideoById({ videoId: id, startSeconds: position });
    // Read-only metadata; queue ownership stays with refreshCatalog().
    Promise.resolve().then(() => window.ArchiveEngine?.getVideos()).then(rows => {
      if (selected !== id || !Array.isArray(rows)) return;
      const row = rows.find(row => row.id === id && !row.sample);
      if (row) { title = title || row.title; duration = duration || Number(row.duration) || 0; render(); }
    }).catch(() => {});
  }
  function advance(direction, autoplay) {
    ++manualRevision;
    if (!queue?.ids.length) return;
    if (manual) { manual = null; position = 0; duration = 0; choose(queue.current, 0, autoplay); return; }
    const id = direction < 0 ? queue.previous() : queue.next();
    if (!id) {
      pause(direction < 0 ? '이전 재생 이력이 없어요.' : '순차 재생을 마쳤어요. 다시 들으려면 재생을 눌러 주세요.');
      if (direction > 0) { position = 0; if (ready) player.cueVideoById({ videoId: activeId(), startSeconds: 0 }); }
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
      note(manual ? manualNote() : queue.ids.length + '곡 · ' + modes[mode][1]);
      metadata();
    } else if (state === 2 && !switching) {
      playing = false; intent = false; metadata(); note('일시정지 · 마지막 위치를 기억해요.');
    } else if (state === 0 && !switching && (playing || intent)) {
      playing = false; position = 0;
      if (manual) { intent = false; note(manualNote() + ' · 재생 완료'); }
      else if (visible()) advance(1, true);
      else pause('다음 곡은 재생 버튼을 눌러 이어 들어요.');
    }
    render(); persist();
  }
  function playerError(event) {
    switching = false; intent = false; playing = false;
    const messages = { 2: '영상 주소를 확인할 수 없어요.', 5: '브라우저에서 영상을 재생할 수 없어요.', 100: '삭제되었거나 비공개인 영상이에요.', 101: '사이트 내 재생이 제한된 영상이에요.', 150: '사이트 내 재생이 제한된 영상이에요.', 153: 'YouTube가 사이트 출처를 확인하지 못했어요.' };
    lastError = messages[event.data] || 'YouTube 재생 중 오류가 발생했어요.';
    failed.add(activeId());
    note(lastError + ' 다음 곡 또는 YouTube 링크를 이용해 주세요.');
    // Never spin through unavailable tracks or retry with an unofficial endpoint.
    render(); persist();
  }
  async function prepare() {
    if (ready && activeId()) return;
    if (preparing) return preparing;
    const generation = ++playerGeneration;
    const active = () => generation === playerGeneration;
    const operation = (async () => {
      note('YouTube 재생목록을 연결하고 있어요…');
      const confirmed = manual || await refreshCatalog();
      if (!active()) return;
      if (!confirmed) throw new Error('지정 재생목록을 확인하지 못했어요. 잠시 후 다시 눌러 주세요.');
      if (!manual && !queue.ids.length && publicRefresh) await publicRefresh;
      if (!active()) return;
      if (!activeId()) throw new Error('지정 재생목록에 재생할 영상이 없어요. 잠시 후 다시 눌러 주세요.');
      await loadAPI();
      if (!active()) return;
      bindDetail();
      await new Promise((resolve, reject) => {
        let settled = false;
        const timeout = setTimeout(() => finish(new Error('재생목록 연결이 늦어요. 다시 시도하거나 YouTube에서 열어 주세요.')), 25000);
        const finish = error => {
          if (settled) return; settled = true; clearTimeout(timeout);
          if (active()) cancelPreparation = null;
          if (error) reject(error); else resolve();
        };
        cancelPreparation = () => finish(new Error('영상 패널을 닫았어요.'));
        player = new YT.Player('mpYouTube', {
          width: '100%', height: '100%',
          videoId: activeId(),
          playerVars: { autoplay: 0, controls: 1, playsinline: 1, origin: location.origin },
          events: {
            onReady: () => {
              if (!active() || settled) return;
              ready = true;
              choose(activeId(), position, intent);
              finish();
            },
            onStateChange: event => { if (active()) stateChanged(event); },
            onError: event => { if (active()) { playerError(event); if (!ready) finish(new Error(lastError)); } },
            onAutoplayBlocked: () => { if (active()) pause('브라우저가 재생을 기다리고 있어요. 재생 버튼이나 영상의 재생을 눌러 주세요.'); }
          }
        });
      });
    })().catch(error => {
      if (!active()) return;
      intent = false; playing = false; ready = false; switching = false;
      // Ignore any late events from the failed instance as well as from a closed one.
      ++playerGeneration;
      try { player?.destroy(); } catch {}
      player = null; selected = '';
      $('#mpVideo').innerHTML = '<div id="mpYouTube"></div>';
      note(error.message); render();
      throw error;
    }).finally(() => { if (preparing === operation) preparing = null; });
    preparing = operation;
    return operation;
  }
  ui.play.addEventListener('click', async () => {
    if (playing || intent) { pause('일시정지 · 마지막 위치를 기억해요.'); return; }
    pauseDetail();
    expand(true);
    intent = true;
    const generation = playerGeneration;
    const confirmed = manual || await refreshCatalog();
    if (generation !== playerGeneration || ui.stage.hidden || !intent) return;
    if (!confirmed) { pause('지정 재생목록을 확인하지 못했어요. 잠시 후 다시 눌러 주세요.'); return; }
    if (!activeId() || !ready) {
      try { await prepare(); } catch { /* Already shown in the compact status. */ }
      return;
    }
    if (lastError) { choose(activeId(), position, true); return; }
    if (visible()) { player.playVideo(); note('재생을 시작하고 있어요…'); }
  });
  ui.stop.addEventListener('click', () => {
    if (!ready || !queue) return;
    pause(); position = 0; switching = true;
    player.stopVideo();
    player.cueVideoById({ videoId: activeId(), startSeconds: 0 });
    note('정지 · 처음부터 다시 재생할 수 있어요.'); render(); persist();
  });
  ui.previous.addEventListener('click', () => advance(-1, playing || intent));
  ui.next.addEventListener('click', () => advance(1, playing || intent));
  ui.mode.addEventListener('click', () => {
    mode = window.LorianoQueue.modes[(window.LorianoQueue.modes.indexOf(mode) + 1) % 3];
    queue?.setMode(mode); render(); persist();
    note('재생 모드: ' + modes[mode][0] + (queue ? ' · ' + queue.ids.length + '곡' : ''));
  });
  ui.close.addEventListener('click', closePanel);
  ui.close.disabled = true;
  refreshCatalog();
  setInterval(() => refreshCatalog(true), 10 * 60 * 1000);
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
        player.cueVideoById({ videoId: activeId(), startSeconds: position });
      } else player.seekTo(position, true);
    }
    movingSeek = false; render(); persist();
  });
  window.addEventListener('hashchange', () => {
    bindDetail();
    if (location.hash.startsWith('#video/')) pause('아카이브 영상을 열어 음악을 일시정지했어요.');
  });
  window.addEventListener('pagehide', () => { pause(); persist(); });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) pause('다른 화면으로 이동해 일시정지했어요.');
  });
  const checkVisibility = () => { if ((playing || (intent && ready)) && !visible()) pause('영상이 보이지 않아 일시정지했어요.'); };
  window.addEventListener('scroll', checkVisibility, { passive: true });
  window.addEventListener('resize', checkVisibility, { passive: true });
  let catalogTimer;
  const archiveView = document.getElementById('view');
  if (archiveView) new MutationObserver(() => {
    bindDetail();

  }).observe(archiveView, { childList: true, subtree: true });
  setInterval(() => {
    metadata(); checkVisibility();
    if (playing && Date.now() - lastPersist > 4000) { persist(); lastPersist = Date.now(); }
  }, 500);
  if (allowed(saved.manual?.id)) {
    const revision = manualRevision;
    verifyManual(saved.manual.id).then(row => {
      if (userInteracted || revision !== manualRevision) return;
      manual = row; title = row.title;
      position = Math.max(0, Number(saved.manual.position) || 0);
      duration = Math.max(0, Number(saved.manual.duration) || row.duration);
      note(manualNote() + ' · 재생을 눌러 이어 들어요.'); render();
    }).catch(() => {});
  }
  bindDetail();
  note(saved.current ? '마지막으로 들은 곡 · 재생을 눌러 이어 들어요.' : '재생을 눌러 작은 찬양을 시작해 보세요.');
  render();
})();
