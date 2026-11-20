// ==UserScript==
// @name         YouTube Auto Speed + Cinema Mode
// @namespace    http://tampermonkey.net/
// @version      2.0
// @description  Auto-set playback speed and theater mode on YouTube. Skips live streams and music. Shift+S for settings.
// @author       ajsprojects
// @match        https://www.youtube.com/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// ==/UserScript==

(function () {
    'use strict';

    const DEFAULTS = {
        enabled: true,
        speed: 1.5,
        cinemaMode: true,
        skipLive: true,
        skipMusic: true,
        debug: false,
    };

    const config = {};
    for (const [key, value] of Object.entries(DEFAULTS)) config[key] = GM_getValue(key, value);

    function setConfig(key, value) {
        config[key] = value;
        GM_setValue(key, value);
    }

    const ENFORCE_MS = 5000;        // window after load where we correct YouTube resetting the speed
    const MAX_CORRECTIONS = 10;     // safety cap so we never fight YouTube in a loop

    const MUSIC_TITLE_RE = /\b(official\s+(music\s+)?video|official\s+audio|official\s+lyric|lyrics?\s+video|music\s+video|remix|visuali[sz]er|full\s+album|\(audio\)|\[audio\])/i;
    const MUSIC_LABEL_RE = /\b(records|recordings|vevo|music|label|entertainment)\b/i;
    const NOT_MUSIC_RE = /\b(tutorial|lesson|how\s+to|review|reaction|explained|breakdown|interview|podcast|documentary)\b/i;

    const state = {
        videoId: null,        // video we last handled
        speedRun: 0,          // incremented to cancel stale speed tasks
        cinemaRun: 0,         // incremented to cancel stale cinema tasks
        targetRate: null,     // rate we want enforced right now (null = don't touch)
        speedActive: false,   // true when the target is the user's custom speed (not a skipped video)
        enforceUntil: 0,
        corrections: 0,
    };

    const observedPlayers = new WeakSet();
    const observedVideos = new WeakSet();
    let panel = null;
    let statusEl = null;

    const log = (...args) => { if (config.debug) console.log('[YT AutoSpeed]', ...args); };

    function setStatus(text) {
        log('Status:', text);
        if (statusEl) statusEl.textContent = text;
    }

    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

    /** Polls check until it returns true, the task is cancelled, or timeout hits. */
    async function waitFor(check, isCancelled, timeout = 15000, interval = 250) {
        const end = Date.now() + timeout;
        while (Date.now() < end) {
            if (isCancelled()) return null;
            const result = check();
            if (result) return result;
            await sleep(interval);
        }
        return null;
    }

    const isWatchPage = () => location.pathname === '/watch';
    const getVideoId = () => new URLSearchParams(location.search).get('v');
    const getPlayer = () => document.querySelector('#movie_player');
    const getVideo = (player) => (player || document).querySelector('video.html5-main-video') || document.querySelector('video');

    function safeCall(obj, method) {
        try { return obj?.[method]?.() ?? null; } catch (e) { return null; }
    }

    /** Reads video info from YouTube's own player API (more reliable than scraping the DOM). */
    function getVideoInfo(player) {
        const response = safeCall(player, 'getPlayerResponse');
        const data = safeCall(player, 'getVideoData');
        const details = response?.videoDetails || null;
        return {
            id: details?.videoId || data?.video_id || null,
            details,
            data,
            category: response?.microformat?.playerMicroformatRenderer?.category || null,
        };
    }

    function setRate(video, rate) {
        if (Math.abs(video.playbackRate - rate) > 0.01) {
            video.playbackRate = rate;
            log(`Playback rate set to ${rate}x`);
        }
    }

    /** Returns a reason string if the video is a live stream / premiere, otherwise null. */
    function detectLive({ player, video, info }) {
        if (info.details?.isLive) return 'videoDetails.isLive';
        if (info.details?.isUpcoming) return 'upcoming premiere/stream';
        if (info.data?.isLive) return 'videoData.isLive';
        if (player.classList.contains('ytp-live')) return 'live player UI';
        if (video.duration === Infinity) return 'infinite duration';
        return null;
    }

    /** Returns a reason string if the video looks like music, otherwise null. */
    function detectMusic({ info }) {
        const { details, data, category } = info;
        const title = details?.title || data?.title || '';
        const author = details?.author || data?.author || '';
        const description = details?.shortDescription || '';

        if (details?.musicVideoType) return `musicVideoType ${details.musicVideoType}`;
        if (/ - topic$/i.test(author)) return 'auto-generated Topic channel';
        if (/^provided to youtube by/i.test(description)) return 'auto-generated music description';
        if (/vevo$/i.test(author)) return 'VEVO channel';
        if (category === 'Music' && !NOT_MUSIC_RE.test(title)) return 'category Music';
        if (MUSIC_TITLE_RE.test(title) && MUSIC_LABEL_RE.test(author)) return 'title + channel pattern';
        return null;
    }

    function decideSpeed(ctx) {
        if (config.skipLive) {
            const why = detectLive(ctx);
            if (why) return { rate: 1, skipped: `live stream (${why})` };
        }
        if (config.skipMusic) {
            const why = detectMusic(ctx);
            if (why) return { rate: 1, skipped: `music (${why})` };
        }
        return { rate: config.speed, skipped: null };
    }

    async function applySpeed(reason) {
        const run = ++state.speedRun;
        const cancelled = () => run !== state.speedRun;

        state.targetRate = null;
        state.speedActive = false;

        if (!config.enabled) return setStatus('Disabled');
        if (!isWatchPage()) return setStatus('Idle (not on a video page)');

        const videoId = getVideoId();
        log(`Applying speed (${reason}) for`, videoId);

        // Wait until the player reports THIS video (not the previous one) is finished
        const ctx = await waitFor(() => {
            const player = getPlayer();
            const video = getVideo(player);
            if (!player || !video) return null;
            const info = getVideoInfo(player);
            return info.id === videoId ? { player, video, info } : null;
        }, cancelled, 90000, 400);

        if (!ctx) return log('Speed task cancelled or timed out');

        watchVideo(ctx.video);

        const { rate, skipped } = decideSpeed(ctx);
        state.targetRate = rate;
        state.speedActive = !skipped;
        state.enforceUntil = Date.now() + ENFORCE_MS;
        state.corrections = 0;
        setRate(ctx.video, rate);

        setStatus(skipped ? `1x – skipped: ${skipped}` : `Playing at ${rate}x`);
    }

    function resetSpeed() {
        state.speedRun++;
        state.targetRate = null;
        state.speedActive = false;
        const video = getVideo(getPlayer());
        if (video) setRate(video, 1);
    }

    /** YouTube sometimes resets the rate right after loading. Correct it briefly, then leave the user alone. */
    function onRateChange(event) {
        const video = event.target;
        if (state.targetRate === null) return;
        if (Date.now() > state.enforceUntil || state.corrections >= MAX_CORRECTIONS) return;
        if (Math.abs(video.playbackRate - state.targetRate) > 0.01) {
            state.corrections++;
            log(`Rate changed to ${video.playbackRate}x externally, restoring ${state.targetRate}x`);
            video.playbackRate = state.targetRate;
        }
    }

    function watchVideo(video) {
        if (observedVideos.has(video)) return;
        observedVideos.add(video);
        video.addEventListener('ratechange', onRateChange);
        // New media loaded: open another short enforcement window
        video.addEventListener('loadedmetadata', () => {
            if (state.targetRate === null) return;
            state.enforceUntil = Date.now() + ENFORCE_MS;
            state.corrections = 0;
        });
    }

    const isTheater = () => !!document.querySelector('ytd-watch-flexy')?.hasAttribute('theater');

    async function applyCinema() {
        const run = ++state.cinemaRun;
        const cancelled = () => run !== state.cinemaRun;

        if (!config.enabled || !config.cinemaMode || !isWatchPage()) return;

        const button = await waitFor(() => {
            const btn = document.querySelector('#movie_player .ytp-size-button');
            const flexy = document.querySelector('ytd-watch-flexy');
            // getClientRects is empty when the button is hidden (e.g. narrow window)
            return btn && flexy && btn.getClientRects().length ? btn : null;
        }, cancelled, 10000);

        if (!button) return log('Theater button unavailable, skipping cinema mode');

        await sleep(400); // let YouTube finish applying its own saved layout first

        for (let attempt = 1; attempt <= 2; attempt++) {
            if (cancelled() || document.fullscreenElement) return;
            if (isTheater()) return log('Theater mode active');

            log(`Clicking theater button (attempt ${attempt})`);
            button.click();
            button.blur(); // don't leave focus on the button, so Space/Enter can't toggle it again
            await sleep(600);
        }

        if (!isTheater()) log('Could not enable theater mode');
    }

    function onNavigation(reason) {
        if (!isWatchPage()) {
            state.videoId = null;
            state.speedRun++;
            state.cinemaRun++;
            state.targetRate = null;
            return setStatus('Idle (not on a video page)');
        }

        const id = getVideoId();
        if (id === state.videoId) return log(`Same video (${reason}), nothing to do`);

        state.videoId = id;
        log(`New video ${id} (${reason})`);
        applySpeed(reason);
        applyCinema();
    }

    function h(tag, props = {}, ...children) {
        const node = document.createElement(tag);
        const { style, ...rest } = props;
        if (style) node.style.cssText = style;
        Object.assign(node, rest);
        node.append(...children);
        return node;
    }

    function checkbox(label, key, onChange, style = '') {
        const input = h('input', { type: 'checkbox', checked: config[key] });
        input.addEventListener('change', () => {
            setConfig(key, input.checked);
            log(`${key}:`, input.checked);
            onChange?.();
        });
        const row = h('label', { style: `display:block;margin-bottom:8px;${style}` }, input, ` ${label}`);
        return { row, input };
    }

    function createPanel() {
        const enabledCb = checkbox('Enable Script', 'enabled', () => {
            if (config.enabled) {
                applySpeed('enabled');
                applyCinema();
            } else {
                resetSpeed();
                setStatus('Disabled');
            }
            updateDisabledState();
        }, 'font-weight:bold;');

        const cinemaCb = checkbox('Auto Cinema Mode', 'cinemaMode', () => config.cinemaMode && applyCinema());
        const liveCb = checkbox('Skip live streams', 'skipLive', () => applySpeed('setting changed'));
        const musicCb = checkbox('Skip music videos', 'skipMusic', () => applySpeed('setting changed'));
        const debugCb = checkbox('Debug logging', 'debug');

        const speedValue = h('span', { textContent: `${config.speed.toFixed(2)}x` });
        const slider = h('input', {
            type: 'range', min: '0.25', max: '3', step: '0.05', value: String(config.speed),
            style: 'width:100%;',
        });
        slider.addEventListener('input', () => {
            const value = parseFloat(slider.value);
            setConfig('speed', value);
            speedValue.textContent = `${value.toFixed(2)}x`;
            if (config.enabled && state.speedActive) {
                state.targetRate = value;
                const video = getVideo(getPlayer());
                if (video) setRate(video, value);
            }
        });
        slider.addEventListener('change', () => config.enabled && applySpeed('speed changed'));

        statusEl = h('div', { style: 'margin-top:10px;font-size:12px;opacity:0.8;', textContent: 'Idle' });

        panel = h('div', {
                id: 'yt-auto-settings-panel',
                style: `position:fixed;top:80px;right:20px;width:230px;padding:15px;z-index:9999;display:none;
                    background:#111;color:#fff;border:1px solid #444;border-radius:6px;font-size:14px;`,
            },
            enabledCb.row,
            h('hr', { style: 'border:0.5px solid #444;margin:8px 0;' }),
            cinemaCb.row, liveCb.row, musicCb.row,
            h('label', { style: 'display:block;' }, 'Speed: ', speedValue),
            slider,
            h('div', { style: 'margin-top:8px;' }, debugCb.row),
            statusEl,
            h('div', { style: 'margin-top:8px;font-size:12px;opacity:0.6;', textContent: 'Shift + S to toggle this panel' }),
        );
        document.body.appendChild(panel);

        function updateDisabledState() {
            for (const control of [cinemaCb, liveCb, musicCb, debugCb]) {
                control.input.disabled = !config.enabled;
                control.row.style.opacity = config.enabled ? '1' : '0.5';
            }
            slider.disabled = !config.enabled;
        }
        updateDisabledState();
    }

    function togglePanel() {
        if (!panel) return;
        panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
    }

    function isTextInput(el) {
        if (!el) return false;
        if (el.isContentEditable || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') return true;
        return el.tagName === 'INPUT' && !['checkbox', 'range', 'button'].includes(el.type);
    }

    function onKeydown(event) {
        if (!event.shiftKey || event.ctrlKey || event.altKey || event.metaKey || event.code !== 'KeyS') return;
        if (isTextInput(event.composedPath?.()[0] ?? event.target)) return;
        event.preventDefault();
        event.stopPropagation();
        togglePanel();
    }


    function init() {
        log('Initializing', config);
        createPanel();
        window.addEventListener('keydown', onKeydown, true);
        window.addEventListener('yt-navigate-finish', () => onNavigation('yt-navigate-finish'), true);
        if (typeof GM_registerMenuCommand === 'function') GM_registerMenuCommand('Toggle settings panel', togglePanel);
        onNavigation('init');
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();