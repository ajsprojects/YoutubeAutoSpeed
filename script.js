// ==UserScript==
// @name         YouTube Auto Speed + Cinema Mode
// @namespace    http://tampermonkey.net/
// @version      1.2
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

    function log(msg) {
        if (config.debug) console.log('[Youtube AutoSpeed]', msg);
    }

    log('Script initialized');
    log('Config:', config);

    function getVideoId() {
        const urlParams = new URLSearchParams(window.location.search);
        const id = urlParams.get('v');
        return id;
    }

    function isTheaterMode() {
        const hasAttr = document.documentElement.hasAttribute('theater-mode');
        const hasElement = document.querySelector('ytd-watch-flexy[theater]') !== null;
        const flexyTheater = document.querySelector('ytd-watch-flexy')?.hasAttribute('theater');

        const result = hasAttr || hasElement || flexyTheater;
        return result;
    }

    function isMusicVideo() {
        try {
            const playerData = window.ytplayer?.config?.args?.player_response ? JSON.parse(window.ytplayer.config.args.player_response) : null;
            if (playerData?.videoDetails?.category === 'Music') {
                log('Music video detected via player data category');
                return true;
            }
        } catch (e) {
        }

        const channelName = document.querySelector('#channel-name a, ytd-channel-name a')?.innerText || '';
        const name = channelName.toLowerCase();

        if (name.includes(' - topic') || name.includes('music')) {
            log(`Music video detected via channel name: ${channelName}`);
            return true;
        }

        const hasMusicSection = [...document.querySelectorAll('ytd-metadata-row-container-renderer, ytd-info-section-renderer')]
            .some(el => el.innerText.toLowerCase().includes('music in this video'));
        if (hasMusicSection) {
            log('Music video detected via music section');
            return true;
        }

        const musicHeaders = document.querySelectorAll('span.yt-core-attributed-string, yt-formatted-string#title');
        for (const header of musicHeaders) {
            if (header.innerText.trim().toLowerCase() === 'music') {
                log('Music video detected via music header');
                return true;
            }
        }

        if (location.hostname.includes('music.youtube.com')) {
            log('Music video detected via music.youtube.com domain');
            return true;
        }

        log('Not a music video');
        return false;
    }

    function applyCinemaMode() {
        log('applyCinemaMode() called');

        if (!config.cinemaMode) {
            log('Cinema mode disabled in config');
            return false;
        }

        if (!config.enabled) {
            log('Script disabled in config');
            return false;
        }

        if (isTheaterMode()) {
            log('Already in cinema mode');
            return true;
        }

        const video = document.querySelector('video');
        if (!video) {
            log('No video element found');
            return false;
        }

        log('Dispatching "t" key event for cinema mode');
        const keyEvent = new KeyboardEvent('keydown', {
            key: 't',
            code: 'KeyT',
            keyCode: 84,
            which: 84,
            bubbles: true,
            cancelable: true
        });

        document.dispatchEvent(keyEvent);
        log('Cinema mode "t" key event dispatched');

        setTimeout(() => {
            log(`Cinema mode status after key press: ${isTheaterMode()}`);
        }, 200);

        return true;
    }

    function applySettings() {
        if (!config.enabled) {
            log('Script disabled, skipping applySettings');
            return;
        }

        const video = document.querySelector('video');
        if (!video) {
            return;
        }

        const videoId = getVideoId();

        if (videoId !== currentVideoId) {
            log(`New video detected: ${currentVideoId} -> ${videoId}`);
            currentVideoId = videoId;
            lastVideo = null;
            settingsAppliedForCurrentVideo = false;
        }

        if (video !== lastVideo) {
            log('New video element detected, applying settings');
            lastVideo = video;
            settingsAppliedForCurrentVideo = false;
        }

        if (settingsAppliedForCurrentVideo) {
            return;
        }

        log('Applying settings for current video');
        settingsAppliedForCurrentVideo = true;

        const music = config.skipMusic && isMusicVideo();
        const targetSpeed = music ? 1 : config.speed;

        video.playbackRate = targetSpeed;
        log(`Playback speed set to ${targetSpeed}x ${music ? '(music video)' : ''}`);

        if (config.cinemaMode) {
            setTimeout(() => {
                if (!isTheaterMode()) {
                    log('Attempting cinema mode');
                    applyCinemaMode();
                } else {
                    log('Already in cinema mode');
                }
            }, 500);
        }
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

        settingsPanel.innerHTML = `
            <label style="display: block; margin-bottom: 8px; font-weight: bold;">
                <input type="checkbox" id="yt-enabled-toggle" ${config.enabled ? 'checked' : ''}>
                Enable Script
            </label>
            <hr style="border: 0.5px solid #444; margin: 8px 0;">
            <label style="display: block; margin-bottom: 8px;">
                <input type="checkbox" id="yt-cinema-toggle" ${config.cinemaMode ? 'checked' : ''}>
                Auto Cinema Mode
            </label>
            <label style="display: block; margin-bottom: 8px;">
                <input type="checkbox" id="yt-skip-music-toggle" ${config.skipMusic ? 'checked' : ''}>
                Auto-disable for Music Videos
            </label>
            <label style="display: block;">Speed: <span id="yt-speed-value">${config.speed}x</span></label>
            <input type="range" id="yt-speed-slider" min="0.25" max="2" step="0.05" value="${config.speed}" style="width: 100%;">
            <div style="margin-top: 10px; font-size: 12px; opacity: 0.6;">🔁 Shift + S to toggle this panel</div>
        `;

        document.body.appendChild(settingsPanel);
        log('GUI created and added to DOM');

        function updateControlsState() {
            const disabled = !config.enabled;
            const elements = [
                document.getElementById('yt-cinema-toggle'),
                document.getElementById('yt-skip-music-toggle'),
                document.getElementById('yt-speed-slider')
            ];
            elements.forEach(el => {
                if (el) {
                    el.disabled = disabled;
                    el.parentElement.style.opacity = disabled ? 0.5 : 1;
                }
            });
        }

        updateControlsState();

        document.getElementById('yt-enabled-toggle').addEventListener('change', function () {
            config.enabled = this.checked;
            GM_setValue('enabled', config.enabled);
            log(`Script enabled: ${config.enabled}`);

            const video = document.querySelector('video');
            if (config.enabled) {
                lastVideo = null;
                settingsAppliedForCurrentVideo = false;
                applySettings();
            } else if (video) {
                video.playbackRate = 1;
                log('Playback speed reset to 1x (script disabled)');
            }
            updateControlsState();
        });

        document.getElementById('yt-cinema-toggle').addEventListener('change', function () {
            config.cinemaMode = this.checked;
            GM_setValue('cinemaMode', config.cinemaMode);
            log(`Cinema mode setting: ${config.cinemaMode}`);
            settingsAppliedForCurrentVideo = false;
            applySettings();
        });

        document.getElementById('yt-skip-music-toggle').addEventListener('change', function () {
            config.skipMusic = this.checked;
            GM_setValue('skipMusic', config.skipMusic);
            log(`Auto-disable for music videos ${config.skipMusic ? 'enabled' : 'disabled'}`);
            settingsAppliedForCurrentVideo = false;
            applySettings();
        });

        document.getElementById('yt-speed-slider').addEventListener('input', function () {
            const val = parseFloat(this.value);
            config.speed = val;
            GM_setValue('speed', val);
            document.getElementById('yt-speed-value').textContent = val.toFixed(2) + 'x';
            log(`Speed changed to ${val}x`);

            // Immediately apply new speed to current video
            const video = document.querySelector('video');
            if (video && config.enabled) {
                const music = config.skipMusic && isMusicVideo();
                video.playbackRate = music ? 1 : val;
            }
        });

        document.addEventListener('keydown', function (e) {
            if (e.shiftKey && e.key.toLowerCase() === 's') {
                settingsPanel.style.display = settingsPanel.style.display === 'none' ? 'block' : 'none';
                log(`Settings panel ${settingsPanel.style.display === 'none' ? 'hidden' : 'shown'}`);
            }
        });
    }

    function setupSPANavigation() {
        log('Setting up SPA navigation detection');

        let lastUrl = location.href;
        setInterval(() => {
            if (location.href !== lastUrl) {
                log(`URL changed: ${lastUrl} -> ${location.href}`);
                lastUrl = location.href;
                lastVideo = null;
                settingsAppliedForCurrentVideo = false;
                currentVideoId = null;
                applySettings();
            }
        }, 500);

        document.addEventListener('yt-navigate-finish', () => {
            log('YouTube navigation event detected');
            lastVideo = null;
            settingsAppliedForCurrentVideo = false;
            currentVideoId = null;
            applySettings();
        });
    }

    // Watch for new video elements being added
    const observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
            for (const node of mutation.addedNodes) {
                if (node.tagName === 'VIDEO') {
                    log('Video element added to DOM');
                    applySettings();
                    return;
                }
            }
        }
    });

    function startObserver() {
        const playerContainer = document.querySelector('#movie_player, .html5-video-player, #player-container');
        if (playerContainer) {
            observer.observe(playerContainer, {
                childList: true,
                subtree: true
            });
            log('MutationObserver started - watching for new video elements only');
        } else {
            log('Player container not found, retrying in 500ms');
            setTimeout(startObserver, 500);
        }
    }

    function init() {
        log('Initializing script');
        createGUI();
        applySettings();
        setupSPANavigation();
        startObserver();
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
        log('Window load event fired, applying settings after 1s delay');
        setTimeout(applySettings, 1000);
    });
})();