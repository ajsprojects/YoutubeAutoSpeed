// ==UserScript==
// @name         YouTube Auto Speed + Cinema Mode
// @namespace    http://tampermonkey.net/
// @version      1.3
// @description  Auto-set playback speed and cinema mode on YouTube. Shift+S for settings window.
// @author       ajsprojects
// @match        https://www.youtube.com/*
// @grant        GM_getValue
// @grant        GM_setValue
// ==/UserScript==

(function () {
    'use strict';

    if (!location.hostname.includes('youtube.com')) return;

    const config = {
        enabled: GM_getValue('enabled', true),
        speed: GM_getValue('speed', 1.5),
        cinemaMode: GM_getValue('cinemaMode', true),
        skipMusic: GM_getValue('skipMusic', true),
        debug: false
    };

    let settingsPanel;
    let lastVideo = null;
    let currentVideoId = null;
    let settingsAppliedForCurrentVideo = false;
    let cinemaModeApplied = false;

    function log(msg, ...args) {
        if (config.debug) console.log('[Youtube AutoSpeed]', msg, ...args);
    }

    log('Script initialized');
    log('Config:', config);

    function getVideoId() {
        return new URLSearchParams(window.location.search).get('v');
    }

    function isTheaterMode() {
        return (
            document.documentElement.hasAttribute('theater-mode') ||
            document.querySelector('ytd-watch-flexy[theater]') !== null ||
            !!document.querySelector('ytd-watch-flexy')?.hasAttribute('theater')
        );
    }

    function isMusicVideo() {
        try {
            const playerResponse = window.ytplayer?.config?.args?.player_response;
            if (playerResponse) {
                const data = JSON.parse(playerResponse);
                if (data?.videoDetails?.category === 'Music') return true;
            }
        } catch (e) {}

        const channelName = (
            document.querySelector('#channel-name a, ytd-channel-name a')?.innerText || ''
        ).toLowerCase();
        if (channelName.includes(' - topic') || channelName.includes('music')) return true;

        const hasMusicSection = [...document.querySelectorAll(
            'ytd-metadata-row-container-renderer, ytd-info-section-renderer'
        )].some(el => el.innerText.toLowerCase().includes('music in this video'));
        if (hasMusicSection) return true;

        for (const el of document.querySelectorAll('span.yt-core-attributed-string, yt-formatted-string#title')) {
            if (el.innerText.trim().toLowerCase() === 'music') return true;
        }

        return false;
    }

    function applyCinemaMode() {
        if (!config.cinemaMode || !config.enabled) return false;
        if (isTheaterMode()) {
            log('Already in theater mode');
            cinemaModeApplied = true;
            return true;
        }

        const theaterBtn = document.querySelector('.ytp-size-button');
        if (theaterBtn) {
            log('Clicking theater button');
            theaterBtn.click();
            setTimeout(() => {
                cinemaModeApplied = isTheaterMode();
                log('Theater mode after click:', cinemaModeApplied);
            }, 300);
            return true;
        }

        log('Theater button not found');
        return false;
    }

    function applySpeed(video) {
        const music = config.skipMusic && isMusicVideo();
        const targetSpeed = music ? 1 : config.speed;
        if (video.playbackRate !== targetSpeed) {
            video.playbackRate = targetSpeed;
            log('Speed set to ' + targetSpeed + 'x' + (music ? ' (music)' : ''));
        }
    }

    function applySettings() {
        if (!config.enabled) return;

        const video = document.querySelector('video');
        if (!video) return;

        const videoId = getVideoId();

        if (videoId !== currentVideoId || video !== lastVideo) {
            log('New video detected, resetting flags');
            currentVideoId = videoId;
            lastVideo = video;
            settingsAppliedForCurrentVideo = false;
            cinemaModeApplied = false;
        }

        if (!settingsAppliedForCurrentVideo) {
            log('Applying settings for video:', videoId);
            settingsAppliedForCurrentVideo = true;
            applySpeed(video);
        }

        if (config.cinemaMode && !cinemaModeApplied) {
            setTimeout(() => {
                if (!isTheaterMode()) {
                    applyCinemaMode();
                } else {
                    cinemaModeApplied = true;
                }
            }, 600);
        }
    }

    function watchSpeed() {
        setInterval(() => {
            if (!config.enabled) return;
            const video = document.querySelector('video');
            if (!video) return;
            const music = config.skipMusic && isMusicVideo();
            const target = music ? 1 : config.speed;
            if (Math.abs(video.playbackRate - target) > 0.01) {
                log('Speed drift detected (' + video.playbackRate + '), correcting to ' + target);
                video.playbackRate = target;
            }
        }, 2000);
    }

    function makeCheckboxLabel(text, checked, extraStyle) {
        const label = document.createElement('label');
        label.style.cssText = 'display: block; margin-bottom: 8px;' + (extraStyle || '');

        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = checked;

        label.appendChild(cb);
        label.appendChild(document.createTextNode(' ' + text));
        return { label, cb };
    }

    function createGUI() {
        log('Creating GUI');

        settingsPanel = document.createElement('div');
        settingsPanel.id = 'yt-auto-settings-panel';
        settingsPanel.style.cssText = `
            position: fixed;
            top: 80px;
            right: 20px;
            background: #111;
            color: #fff;
            padding: 15px;
            border: 1px solid #444;
            border-radius: 6px;
            z-index: 9999;
            font-size: 14px;
            width: 220px;
            display: none;
        `;

        const { label: enableLabel, cb: enableCb } = makeCheckboxLabel('Enable Script', config.enabled, 'font-weight: bold;');
        enableCb.id = 'yt-enabled-toggle';
        settingsPanel.appendChild(enableLabel);

        const hr = document.createElement('hr');
        hr.style.cssText = 'border: 0.5px solid #444; margin: 8px 0;';
        settingsPanel.appendChild(hr);

        const { label: cinemaLabel, cb: cinemaCb } = makeCheckboxLabel('Auto Cinema Mode', config.cinemaMode);
        cinemaCb.id = 'yt-cinema-toggle';
        settingsPanel.appendChild(cinemaLabel);

        const { label: musicLabel, cb: musicCb } = makeCheckboxLabel('Auto-disable for Music Videos', config.skipMusic);
        musicCb.id = 'yt-skip-music-toggle';
        settingsPanel.appendChild(musicLabel);

        const speedLabelEl = document.createElement('label');
        speedLabelEl.style.cssText = 'display: block;';
        speedLabelEl.appendChild(document.createTextNode('Speed: '));
        const speedValueSpan = document.createElement('span');
        speedValueSpan.id = 'yt-speed-value';
        speedValueSpan.textContent = config.speed + 'x';
        speedLabelEl.appendChild(speedValueSpan);
        settingsPanel.appendChild(speedLabelEl);

        const slider = document.createElement('input');
        slider.type = 'range';
        slider.id = 'yt-speed-slider';
        slider.min = '0.25';
        slider.max = '2';
        slider.step = '0.05';
        slider.value = String(config.speed);
        slider.style.width = '100%';
        settingsPanel.appendChild(slider);

        const hint = document.createElement('div');
        hint.style.cssText = 'margin-top: 10px; font-size: 12px; opacity: 0.6;';
        hint.textContent = '\uD83D\uDD01 Shift + S to toggle this panel';
        settingsPanel.appendChild(hint);

        document.body.appendChild(settingsPanel);
        log('GUI created and added to DOM');

        function updateControlsState() {
            const disabled = !config.enabled;
            [cinemaCb, musicCb, slider].forEach(el => {
                el.disabled = disabled;
                el.parentElement.style.opacity = disabled ? '0.5' : '1';
            });
        }
        updateControlsState();

        enableCb.addEventListener('change', function () {
            config.enabled = this.checked;
            GM_setValue('enabled', config.enabled);
            log('Script enabled: ' + config.enabled);
            const video = document.querySelector('video');
            if (config.enabled) {
                lastVideo = null;
                settingsAppliedForCurrentVideo = false;
                cinemaModeApplied = false;
                applySettings();
            } else if (video) {
                video.playbackRate = 1;
                log('Playback speed reset to 1x');
            }
            updateControlsState();
        });

        cinemaCb.addEventListener('change', function () {
            config.cinemaMode = this.checked;
            GM_setValue('cinemaMode', config.cinemaMode);
            log('Cinema mode: ' + config.cinemaMode);
            cinemaModeApplied = false;
            applySettings();
        });

        musicCb.addEventListener('change', function () {
            config.skipMusic = this.checked;
            GM_setValue('skipMusic', config.skipMusic);
            log('Skip music: ' + config.skipMusic);
            settingsAppliedForCurrentVideo = false;
            applySettings();
        });

        slider.addEventListener('input', function () {
            const val = parseFloat(this.value);
            config.speed = val;
            GM_setValue('speed', val);
            speedValueSpan.textContent = val.toFixed(2) + 'x';
            log('Speed changed to ' + val + 'x');
            const video = document.querySelector('video');
            if (video && config.enabled) {
                const music = config.skipMusic && isMusicVideo();
                video.playbackRate = music ? 1 : val;
            }
        });

        // Shift+S
        window.addEventListener('keydown', function (e) {
            const tag = document.activeElement?.tagName;
            const isTyping = tag === 'INPUT' || tag === 'TEXTAREA' || document.activeElement?.isContentEditable;
            if (isTyping) return;

            if (e.shiftKey && e.key.toLowerCase() === 's') {
                e.stopPropagation();
                const visible = settingsPanel.style.display !== 'none';
                settingsPanel.style.display = visible ? 'none' : 'block';
                log('Settings panel ' + (visible ? 'hidden' : 'shown'));
            }
        }, true);
    }

    function setupNavigation() {
        let lastUrl = location.href;

        setInterval(() => {
            if (location.href !== lastUrl) {
                log('URL changed: ' + lastUrl + ' -> ' + location.href);
                lastUrl = location.href;
                lastVideo = null;
                settingsAppliedForCurrentVideo = false;
                cinemaModeApplied = false;
                currentVideoId = null;
                setTimeout(applySettings, 800);
            }
        }, 500);

        document.addEventListener('yt-navigate-finish', () => {
            log('yt-navigate-finish fired');
            lastVideo = null;
            settingsAppliedForCurrentVideo = false;
            cinemaModeApplied = false;
            currentVideoId = null;
            setTimeout(applySettings, 800);
        });
    }

    const observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
            for (const node of mutation.addedNodes) {
                if (node.nodeName === 'VIDEO') {
                    log('Video element added to DOM');
                    lastVideo = null;
                    settingsAppliedForCurrentVideo = false;
                    setTimeout(applySettings, 300);
                    return;
                }
            }
        }
    });

    function startObserver() {
        const container = document.querySelector('#movie_player, .html5-video-player, #player-container');
        if (container) {
            observer.observe(container, { childList: true, subtree: true });
            log('MutationObserver started');
        } else {
            setTimeout(startObserver, 500);
        }
    }

    function init() {
        log('Initializing script');
        createGUI();
        applySettings();
        setupNavigation();
        startObserver();
        watchSpeed();
        log('Initialization complete');
    }

    if (document.readyState === 'loading') {
        log('DOM loading, waiting for DOMContentLoaded');
        document.addEventListener('DOMContentLoaded', init);
    } else {
        log('DOM already loaded, initializing immediately');
        init();
    }

    window.addEventListener('load', () => {
        log('Window load event, applying settings after 1s');
        setTimeout(applySettings, 1000);
    });

})();
