// ==UserScript==
// @name         YouTube Auto Speed + Cinema Mode
// @namespace    http://tampermonkey.net/
// @version      1.0
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
        skipMusic: GM_getValue('skipMusic', true)
    };

    let settingsPanel;
    let lastVideo = null;
    let cinemaModeAttempts = 0;
    let currentVideoId = null;

    function log(msg) {
        if (config.debug) console.log('[Youtube AutoSpeed]', msg);
    }

    function getVideoId() {
        const urlParams = new URLSearchParams(window.location.search);
        return urlParams.get('v');
    }

    function isTheaterMode() {
        return (document.documentElement.hasAttribute('theater-mode') || document.querySelector('ytd-watch-flexy[theater]') !== null);
    }

    function isMusicVideo() {
        try {
            const playerData = window.ytplayer?.config?.args?.player_response ? JSON.parse(window.ytplayer.config.args.player_response) : null;
            if (playerData?.videoDetails?.category === 'Music') return true;
        } catch (_) {
        }

        const channelName = document.querySelector('#channel-name a, ytd-channel-name a')?.innerText || '';
        if (channelName.includes(' - Topic')) return true;

        const hasMusicSection = [...document.querySelectorAll('ytd-metadata-row-container-renderer, ytd-info-section-renderer')]
            .some(el => el.innerText.toLowerCase().includes('music in this video'));
        if (hasMusicSection) return true;

        const musicHeaders = document.querySelectorAll('span.yt-core-attributed-string, yt-formatted-string#title');
        for (const header of musicHeaders) {
            if (header.innerText.trim().toLowerCase() === 'music') return true;
        }

        if (location.hostname.includes('music.youtube.com')) return true;

        return false;
    }

    function applyCinemaMode() {
        if (!config.cinemaMode || !config.enabled) return false;

        if (isTheaterMode()) {
            log('Already in cinema mode');
            return true;
        }

        const cinemaBtn = document.querySelector('.ytp-size-button');
        if (cinemaBtn) {
            cinemaBtn.click();
            log('Cinema mode enabled');
            return true;
        }

        return false;
    }

    function applySettings() {
        if (!config.enabled) return;

        const video = document.querySelector('video');
        if (!video) return;

        const videoId = getVideoId();

        if (videoId !== currentVideoId) {
            currentVideoId = videoId;
            cinemaModeAttempts = 0;
            lastVideo = null;
        }

        if (video !== lastVideo) {
            lastVideo = video;
        }

        const music = config.skipMusic && isMusicVideo();
        if (music) {
            if (Math.abs(video.playbackRate - 1) > 0.01) {
                video.playbackRate = 1;
                log("Music video detected — playback speed set to 1x");
            }
        } else {
            if (Math.abs(video.playbackRate - config.speed) > 0.01) {
                video.playbackRate = config.speed;
                log(`Playback speed set to ${config.speed}x`);
            }
        }

        if (config.cinemaMode && cinemaModeAttempts < 10) {
            if (applyCinemaMode()) {
                cinemaModeAttempts = 999;
            } else {
                cinemaModeAttempts++;
            }
        }
    }

    function createGUI() {
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

        function updateControlsState() {
            const disabled = !config.enabled;
            const elements = [document.getElementById('yt-cinema-toggle'), document.getElementById('yt-skip-music-toggle'), document.getElementById('yt-speed-slider')];
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
            const video = document.querySelector('video');
            if (config.enabled) {
                lastVideo = null;
                cinemaModeAttempts = 0;
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
            cinemaModeAttempts = 0;
            applySettings();
        });

        document.getElementById('yt-skip-music-toggle').addEventListener('change', function () {
            config.skipMusic = this.checked;
            GM_setValue('skipMusic', config.skipMusic);
            log(`Auto-disable for music videos ${config.skipMusic ? 'enabled' : 'disabled'}`);
        });

        document.getElementById('yt-speed-slider').addEventListener('input', function () {
            const val = parseFloat(this.value);
            config.speed = val;
            GM_setValue('speed', val);
            document.getElementById('yt-speed-value').textContent = val.toFixed(2) + 'x';
            applySettings();
        });

        document.addEventListener('keydown', function (e) {
            if (e.shiftKey && e.key.toLowerCase() === 's') {
                settingsPanel.style.display = settingsPanel.style.display === 'none' ? 'block' : 'none';
                log(`Settings panel ${settingsPanel.style.display === 'none' ? 'hidden' : 'shown'}`);
            }
        });
    }

    function setupSPANavigation() {
        let lastUrl = location.href;
        setInterval(() => {
            if (location.href !== lastUrl) {
                lastUrl = location.href;
                lastVideo = null;
                cinemaModeAttempts = 0;
                currentVideoId = null;
                requestAnimationFrame(applySettings);
            }
        }, 500);

        document.addEventListener('yt-navigate-finish', () => {
            lastVideo = null;
            cinemaModeAttempts = 0;
            currentVideoId = null;
            requestAnimationFrame(applySettings);
        });
    }

    const observer = new MutationObserver(() => {
        requestAnimationFrame(applySettings);
    });
    observer.observe(document.body, {
        childList: true, subtree: true
    });

    function init() {
        createGUI();
        applySettings();
        setupSPANavigation();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    window.addEventListener('load', () => {
        setTimeout(applySettings, 1000);
    });
})();