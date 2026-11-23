/**
 * VIP Texas Hold'em - Client Video Game Engine (6-Character VIP Roster, 4 Seated Per Table)
 * Manages 3D POV visual rendering, character SVG seats, turn-by-turn AI playback, SFX, and state sync.
 */

(function () {
  'use strict';

  // =========================================================================
  // AUDIO SYNTHESIZER (Web Audio API - Procedural Casino Sounds)
  // =========================================================================
  const MUTE_STORAGE_KEY = 'high_roller_muted';

  function readSavedMutePreference() {
    try {
      return window.localStorage.getItem(MUTE_STORAGE_KEY) === 'true';
    } catch {
      return false;
    }
  }

  function writeSavedMutePreference(muted) {
    try {
      window.localStorage.setItem(MUTE_STORAGE_KEY, String(Boolean(muted)));
    } catch {
      // Ignore blocked storage
    }
  }

  class SoundFX {
    constructor() {
      this.ctx = null;
      this.muted = readSavedMutePreference();
      this.enabled = !this.muted;
      this.playedCount = 0;
    }

    init() {
      if (!this.ctx) {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        if (AudioContext) {
          this.ctx = new AudioContext();
        }
      }
      if (this.ctx && this.ctx.state === 'suspended') {
        this.ctx.resume();
      }
    }

    setMuted(muted) {
      this.muted = Boolean(muted);
      this.enabled = !this.muted;
      writeSavedMutePreference(this.muted);
      syncSoundToggleUI(this.muted);
      return this.enabled;
    }

    toggle() {
      return this.setMuted(!this.muted);
    }

    playCardDeal() {
      if (this.muted || !this.enabled) return;
      this.playedCount += 1;
      if (!this.ctx) return;
      const t = this.ctx.currentTime;
      const bufferSize = this.ctx.sampleRate * 0.12;
      const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        data[i] = Math.random() * 2 - 1;
      }
      const noise = this.ctx.createBufferSource();
      noise.buffer = buffer;

      const filter = this.ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(1200, t);
      filter.frequency.exponentialRampToValueAtTime(400, t + 0.12);
      filter.Q.value = 3;

      const gain = this.ctx.createGain();
      gain.gain.setValueAtTime(0.2, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.12);

      noise.connect(filter);
      filter.connect(gain);
      gain.connect(this.ctx.destination);
      noise.start(t);
    }

    playCardFlip() {
      if (this.muted || !this.enabled) return;
      this.playedCount += 1;
      if (!this.ctx) return;
      const t = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(450, t);
      osc.frequency.exponentialRampToValueAtTime(150, t + 0.08);

      gain.gain.setValueAtTime(0.3, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.08);

      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(t);
      osc.stop(t + 0.09);
    }

    playChipSound() {
      if (this.muted || !this.enabled) return;
      this.playedCount += 1;
      if (!this.ctx) return;
      const t = this.ctx.currentTime;
      [2400, 3100].forEach((freq, idx) => {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, t + idx * 0.02);

        gain.gain.setValueAtTime(0.25, t + idx * 0.02);
        gain.gain.exponentialRampToValueAtTime(0.001, t + idx * 0.02 + 0.07);

        osc.connect(gain);
        gain.connect(this.ctx.destination);
        osc.start(t + idx * 0.02);
        osc.stop(t + idx * 0.02 + 0.08);
      });
    }

    playKnock() {
      if (this.muted || !this.enabled) return;
      this.playedCount += 1;
      if (!this.ctx) return;
      const t = this.ctx.currentTime;
      [0, 0.09].forEach((delayMs) => {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(140, t + delayMs);
        osc.frequency.exponentialRampToValueAtTime(60, t + delayMs + 0.06);

        gain.gain.setValueAtTime(0.4, t + delayMs);
        gain.gain.exponentialRampToValueAtTime(0.001, t + delayMs + 0.06);

        osc.connect(gain);
        gain.connect(this.ctx.destination);
        osc.start(t + delayMs);
        osc.stop(t + delayMs + 0.07);
      });
    }

    playWin() {
      if (this.muted || !this.enabled) return;
      this.playedCount += 1;
      if (!this.ctx) return;
      const t = this.ctx.currentTime;
      const notes = [523.25, 659.25, 783.99, 1046.5];
      notes.forEach((freq, idx) => {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq, t + idx * 0.1);

        gain.gain.setValueAtTime(0.25, t + idx * 0.1);
        gain.gain.exponentialRampToValueAtTime(0.001, t + idx * 0.1 + 0.35);

        osc.connect(gain);
        gain.connect(this.ctx.destination);
        osc.start(t + idx * 0.1);
        osc.stop(t + idx * 0.1 + 0.38);
      });
    }

    playDefeat() {
      if (this.muted || !this.enabled) return;
      this.playedCount += 1;
      if (!this.ctx) return;
      const t = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(220, t);
      osc.frequency.exponentialRampToValueAtTime(110, t + 0.4);

      gain.gain.setValueAtTime(0.2, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.4);

      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(t);
      osc.stop(t + 0.42);
    }
  }

  // =========================================================================
  // 6 VIP OPPONENT CHARACTER & CHAIR SVG ARTWORK
  // =========================================================================
  const CHARACTER_ART = {
    // 1. Royal British Aristocrat with Top Hat & Monocle
    reginald: {
      chairSVG: `
        <svg viewBox="0 0 210 250" class="chair-svg" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <linearGradient id="regChairWood" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="#3b1e3f"/><stop offset="100%" stop-color="#17091a"/>
            </linearGradient>
            <linearGradient id="regLeather" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="#581c87"/><stop offset="55%" stop-color="#3b0764"/><stop offset="100%" stop-color="#1e0336"/>
            </linearGradient>
            <linearGradient id="regArm" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="#6b21a8"/><stop offset="100%" stop-color="#2e064f"/>
            </linearGradient>
          </defs>
          <path d="M 22 245 L 22 85 Q 22 18 105 12 Q 188 18 188 85 L 188 245 Z" fill="url(#regChairWood)" stroke="#ffd700" stroke-width="2.5"/>
          <path d="M 86 15 L 95 4 L 105 12 L 115 4 L 124 15 Z" fill="#ffd700" stroke="#b8860b" stroke-width="1"/>
          <path d="M 32 245 L 32 85 Q 32 26 105 22 Q 178 26 178 85 L 178 245 Z" fill="url(#regLeather)" stroke="#d97706" stroke-width="1.5"/>
          <path d="M 65 72 L 105 112 L 145 72 M 65 122 L 105 162 L 145 122" stroke="#c084fc" stroke-width="1.2" fill="none" opacity="0.35"/>
          <circle cx="105" cy="64" r="3" fill="#ffd700"/><circle cx="65" cy="102" r="3" fill="#ffd700"/><circle cx="145" cy="102" r="3" fill="#ffd700"/>
          <rect x="10" y="150" width="24" height="85" rx="6" fill="url(#regChairWood)" stroke="#ffd700" stroke-width="1.5"/>
          <rect x="6" y="144" width="32" height="16" rx="8" fill="url(#regArm)" stroke="#ffd700" stroke-width="1.5"/>
          <rect x="176" y="150" width="24" height="85" rx="6" fill="url(#regChairWood)" stroke="#ffd700" stroke-width="1.5"/>
          <rect x="172" y="144" width="32" height="16" rx="8" fill="url(#regArm)" stroke="#ffd700" stroke-width="1.5"/>
        </svg>`,
      avatarSVG: `
        <svg viewBox="0 0 180 230" class="character-svg" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <linearGradient id="regCoat" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="#3b0764"/><stop offset="100%" stop-color="#170529"/>
            </linearGradient>
            <linearGradient id="regSkin" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="#fce0c8"/><stop offset="100%" stop-color="#dda984"/>
            </linearGradient>
          </defs>
          <path d="M 18 162 Q 90 148 162 162 L 176 230 L 4 230 Z" fill="url(#regCoat)" />
          <polygon points="72,150 108,150 100,208 80,208" fill="#fef3c7" />
          <circle cx="90" cy="172" r="5" fill="#dc2626" stroke="#ffd700" stroke-width="1.5"/>
          <rect x="76" y="128" width="28" height="26" rx="5" fill="url(#regSkin)" />
          <ellipse cx="90" cy="100" rx="29" ry="33" fill="url(#regSkin)" />
          <path d="M 59 86 Q 55 100 62 108" stroke="#e2e8f0" stroke-width="6" fill="none" stroke-linecap="round"/>
          <path d="M 121 86 Q 125 100 118 108" stroke="#e2e8f0" stroke-width="6" fill="none" stroke-linecap="round"/>
          <!-- Tall Royal Top Hat -->
          <ellipse cx="90" cy="70" rx="46" ry="8" fill="#18181b" stroke="#3f3f46" stroke-width="1.2"/>
          <rect x="61" y="20" width="58" height="50" rx="4" fill="#18181b" />
          <rect x="61" y="57" width="58" height="9" fill="#991b1b" />
          <rect x="61" y="56" width="58" height="2" fill="#ffd700" />
          <!-- Eyes & Gleaming Golden Monocle -->
          <ellipse cx="78" cy="96" rx="3.5" ry="2.5" fill="#1f2937"/>
          <ellipse cx="102" cy="96" rx="3.5" ry="2.5" fill="#1f2937"/>
          <circle cx="102" cy="96" r="10.5" fill="rgba(224, 242, 254, 0.3)" stroke="#ffd700" stroke-width="2.2"/>
          <line x1="97" y1="90" x2="105" y2="100" stroke="#fff" stroke-width="1.5" opacity="0.7"/>
          <path d="M 112 101 Q 118 128 115 156" stroke="#ffd700" stroke-width="1.4" fill="none" stroke-dasharray="2 2"/>
          <!-- Distinguished Silver Handlebar Mustache -->
          <path d="M 90 110 Q 75 104 62 114 Q 75 122 90 115 Q 105 122 118 114 Q 105 104 90 110 Z" fill="#f1f5f9" stroke="#94a3b8" stroke-width="1"/>
          <path d="M 82 121 Q 90 125 98 121" stroke="#7c2d12" stroke-width="2" fill="none" stroke-linecap="round"/>
        </svg>`,
    },

    // 2. Rich Texan Oil-Boom Cowboy with Stetson Hat & Bolo Tie
    buck: {
      chairSVG: `
        <svg viewBox="0 0 210 250" class="chair-svg" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <linearGradient id="buckWood" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="#5c2d12"/><stop offset="100%" stop-color="#2b1205"/>
            </linearGradient>
            <linearGradient id="buckLeather" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="#9a4e1c"/><stop offset="55%" stop-color="#6e3511"/><stop offset="100%" stop-color="#3d1b07"/>
            </linearGradient>
            <linearGradient id="buckArm" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="#b45d24"/><stop offset="100%" stop-color="#52260b"/>
            </linearGradient>
          </defs>
          <path d="M 22 245 L 22 85 Q 22 18 105 14 Q 188 18 188 85 L 188 245 Z" fill="url(#buckWood)" stroke="#f59e0b" stroke-width="2.5"/>
          <!-- Golden Texas Star Crest -->
          <polygon points="105,6 108,13 115,13 109,17 111,24 105,20 99,24 101,17 95,13 102,13" fill="#ffd700" stroke="#92400e" stroke-width="0.8"/>
          <path d="M 32 245 L 32 85 Q 32 28 105 24 Q 178 28 178 85 L 178 245 Z" fill="url(#buckLeather)" stroke="#d97706" stroke-width="1.5"/>
          <circle cx="48" cy="60" r="2.5" fill="#ffd700"/><circle cx="162" cy="60" r="2.5" fill="#ffd700"/>
          <circle cx="48" cy="110" r="2.5" fill="#ffd700"/><circle cx="162" cy="110" r="2.5" fill="#ffd700"/>
          <rect x="10" y="150" width="24" height="85" rx="6" fill="url(#buckWood)" stroke="#f59e0b" stroke-width="1.5"/>
          <rect x="6" y="144" width="32" height="16" rx="8" fill="url(#buckArm)" stroke="#ffd700" stroke-width="1.5"/>
          <rect x="176" y="150" width="24" height="85" rx="6" fill="url(#buckWood)" stroke="#f59e0b" stroke-width="1.5"/>
          <rect x="172" y="144" width="32" height="16" rx="8" fill="url(#buckArm)" stroke="#ffd700" stroke-width="1.5"/>
        </svg>`,
      avatarSVG: `
        <svg viewBox="0 0 180 230" class="character-svg" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <linearGradient id="buckVest" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="#92400e"/><stop offset="100%" stop-color="#451a03"/>
            </linearGradient>
            <linearGradient id="buckSkin" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="#f4c298"/><stop offset="100%" stop-color="#cf8e60"/>
            </linearGradient>
            <linearGradient id="buckHat" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="#fef3c7"/><stop offset="100%" stop-color="#d6b98c"/>
            </linearGradient>
          </defs>
          <!-- Western Suede Jacket & Crisp Shirt -->
          <path d="M 18 162 Q 90 148 162 162 L 176 230 L 4 230 Z" fill="url(#buckVest)" />
          <polygon points="70,150 110,150 102,216 78,216" fill="#fffbeb" />
          <!-- Turquoise & Gold Bolo Tie -->
          <path d="M 78 152 L 90 174 L 102 152" stroke="#292524" stroke-width="2.5" fill="none"/>
          <line x1="87" y1="176" x2="85" y2="205" stroke="#292524" stroke-width="2"/>
          <line x1="93" y1="176" x2="95" y2="205" stroke="#292524" stroke-width="2"/>
          <ellipse cx="90" cy="174" rx="8" ry="10" fill="#14b8a6" stroke="#ffd700" stroke-width="2"/>
          <!-- Neck & Sun-Tanned Face -->
          <rect x="76" y="128" width="28" height="25" rx="5" fill="url(#buckSkin)" />
          <ellipse cx="90" cy="100" rx="29" ry="33" fill="url(#buckSkin)" />
          <!-- Big Texan Stetson Cowboy Hat -->
          <path d="M 32 76 Q 90 88 148 76 Q 152 68 134 65 Q 90 73 46 65 Q 28 68 32 76 Z" fill="url(#buckHat)" stroke="#a16207" stroke-width="1.5"/>
          <path d="M 52 70 Q 56 30 78 32 Q 90 40 102 32 Q 124 30 128 70 Z" fill="url(#buckHat)" stroke="#a16207" stroke-width="1.2"/>
          <path d="M 53 63 Q 90 70 127 63 L 128 70 Q 90 77 52 70 Z" fill="#78350f"/>
          <rect x="84" y="65" width="12" height="7" rx="1.5" fill="#ffd700"/>
          <!-- Twinkling Eyes & Bushy Brows -->
          <ellipse cx="78" cy="96" rx="3.5" ry="2.8" fill="#292524"/>
          <ellipse cx="102" cy="96" rx="3.5" ry="2.8" fill="#292524"/>
          <path d="M 71 89 Q 78 86 85 89" stroke="#573116" stroke-width="2.5" fill="none"/>
          <path d="M 95 89 Q 102 86 109 89" stroke="#573116" stroke-width="2.5" fill="none"/>
          <!-- Thick Cowboy Mustache & Big Grin -->
          <path d="M 68 114 Q 90 104 112 114 Q 102 122 90 116 Q 78 122 68 114 Z" fill="#573116"/>
          <path d="M 80 120 Q 90 128 100 120" stroke="#fff" stroke-width="3" fill="none" stroke-linecap="round"/>
        </svg>`,
    },

    // 3. Parody Australian Outback Adventurer ("Croc" Bruce)
    bruce: {
      chairSVG: `
        <svg viewBox="0 0 210 250" class="chair-svg" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <linearGradient id="bruceWood" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="#3f4a28"/><stop offset="100%" stop-color="#1c2210"/>
            </linearGradient>
            <linearGradient id="bruceLeather" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="#2e6b4e"/><stop offset="55%" stop-color="#1d4a35"/><stop offset="100%" stop-color="#0e291c"/>
            </linearGradient>
            <linearGradient id="bruceArm" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="#3a8260"/><stop offset="100%" stop-color="#173b2a"/>
            </linearGradient>
          </defs>
          <path d="M 22 245 L 22 85 Q 22 18 105 14 Q 188 18 188 85 L 188 245 Z" fill="url(#bruceWood)" stroke="#eab308" stroke-width="2.5"/>
          <circle cx="105" cy="14" r="6" fill="#eab308" stroke="#713f12" stroke-width="1.2"/>
          <path d="M 32 245 L 32 85 Q 32 28 105 24 Q 178 28 178 85 L 178 245 Z" fill="url(#bruceLeather)" stroke="#ca8a04" stroke-width="1.5"/>
          <rect x="10" y="150" width="24" height="85" rx="6" fill="url(#bruceWood)" stroke="#eab308" stroke-width="1.5"/>
          <rect x="6" y="144" width="32" height="16" rx="8" fill="url(#bruceArm)" stroke="#facc15" stroke-width="1.5"/>
          <rect x="176" y="150" width="24" height="85" rx="6" fill="url(#bruceWood)" stroke="#eab308" stroke-width="1.5"/>
          <rect x="172" y="144" width="32" height="16" rx="8" fill="url(#bruceArm)" stroke="#facc15" stroke-width="1.5"/>
        </svg>`,
      avatarSVG: `
        <svg viewBox="0 0 180 230" class="character-svg" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <linearGradient id="bruceShirt" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="#c2a46c"/><stop offset="100%" stop-color="#876d3e"/>
            </linearGradient>
            <linearGradient id="bruceSkin" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="#f3bf8f"/><stop offset="100%" stop-color="#cc8b56"/>
            </linearGradient>
          </defs>
          <!-- Khaki Outback Safari Shirt -->
          <path d="M 20 162 Q 90 148 160 162 L 174 230 L 6 230 Z" fill="url(#bruceShirt)" />
          <!-- Open Collar V-neck + Croc Tooth Necklace -->
          <polygon points="74,152 106,152 90,192" fill="url(#bruceSkin)" />
          <path d="M 76 164 Q 90 182 104 164" stroke="#451a03" stroke-width="2" fill="none"/>
          <polygon points="87,175 93,175 90,185" fill="#fefce8" stroke="#a16207" stroke-width="0.8"/>
          <!-- Neck & Rugged Grinning Face -->
          <rect x="78" y="126" width="24" height="28" rx="5" fill="url(#bruceSkin)" />
          <ellipse cx="90" cy="100" rx="28" ry="33" fill="url(#bruceSkin)" />
          <!-- Sun-Bleached Hair Under Hat -->
          <path d="M 59 86 Q 58 98 63 102" stroke="#eab308" stroke-width="6" fill="none" stroke-linecap="round"/>
          <path d="M 121 86 Q 122 98 117 102" stroke="#eab308" stroke-width="6" fill="none" stroke-linecap="round"/>
          <!-- Iconic Slouch Aussie Outback Hat with Croc-Tooth Band & Dangling Corks -->
          <ellipse cx="90" cy="72" rx="50" ry="10" fill="#784a22" stroke="#451a03" stroke-width="1.5"/>
          <path d="M 54 70 Q 58 36 90 36 Q 122 36 126 70 Z" fill="#8c5828" stroke="#451a03" stroke-width="1.2"/>
          <rect x="55" y="61" width="70" height="8" fill="#3f230d"/>
          <polygon points="75,62 79,62 77,69" fill="#fefce8"/>
          <polygon points="88,62 92,62 90,69" fill="#fefce8"/>
          <polygon points="101,62 105,62 103,69" fill="#fefce8"/>
          <!-- Iconic Aussie Hat Corks on Strings -->
          <line x1="45" y1="75" x2="43" y2="92" stroke="#d6d3d1" stroke-width="1.2"/>
          <rect x="40" y="92" width="6" height="8" rx="1.5" fill="#b45309"/>
          <line x1="135" y1="75" x2="137" y2="92" stroke="#d6d3d1" stroke-width="1.2"/>
          <rect x="134" y="92" width="6" height="8" rx="1.5" fill="#b45309"/>
          <!-- Eyes & Big Friendly Outback Grin -->
          <ellipse cx="78" cy="96" rx="3.5" ry="2.8" fill="#1e293b"/>
          <ellipse cx="102" cy="96" rx="3.5" ry="2.8" fill="#1e293b"/>
          <path d="M 76 113 Q 90 124 104 113 Z" fill="#ffffff" stroke="#7c2d12" stroke-width="1.5"/>
        </svg>`,
    },

    // 4. Elon Musk (Unmistakable likeness: buzzed undercut swept quiff, broad jaw & cheekbones, deep-set squinty eyes, wry smirk, black leather keynote jacket & Occupy Mars / X tee)
    elon: {
      chairSVG: `
        <svg viewBox="0 0 210 250" class="chair-svg" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <linearGradient id="elonFrame" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="#475569"/><stop offset="100%" stop-color="#090d16"/>
            </linearGradient>
            <linearGradient id="elonSeat" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="#1e293b"/><stop offset="55%" stop-color="#0f172a"/><stop offset="100%" stop-color="#020617"/>
            </linearGradient>
            <radialGradient id="marsOrb" cx="35%" cy="35%" r="65%">
              <stop offset="0%" stop-color="#fb923c"/><stop offset="65%" stop-color="#c2410c"/><stop offset="100%" stop-color="#7c2d12"/>
            </radialGradient>
          </defs>
          <!-- Futuristic Cybertruck / Dragon Capsule Angular Bucket Seat -->
          <polygon points="34,245 20,90 42,24 105,12 168,24 190,90 176,245" fill="url(#elonFrame)" stroke="#38bdf8" stroke-width="2.2"/>
          <polygon points="44,245 33,92 50,34 105,24 160,34 177,92 166,245" fill="url(#elonSeat)" stroke="#64748b" stroke-width="1.4"/>
          <!-- Mini Red Planet Mars Crest on Headrest -->
          <circle cx="105" cy="18" r="8" fill="url(#marsOrb)" stroke="#38bdf8" stroke-width="1.2"/>
          <line x1="74" y1="42" x2="136" y2="42" stroke="#38bdf8" stroke-width="2" opacity="0.7" stroke-linecap="round"/>
          <rect x="10" y="150" width="22" height="85" rx="5" fill="#0f172a" stroke="#38bdf8" stroke-width="1.5"/>
          <rect x="6" y="144" width="30" height="14" rx="5" fill="#1e293b" stroke="#94a3b8" stroke-width="1.5"/>
          <rect x="178" y="150" width="22" height="85" rx="5" fill="#0f172a" stroke="#38bdf8" stroke-width="1.5"/>
          <rect x="174" y="144" width="30" height="14" rx="5" fill="#1e293b" stroke="#94a3b8" stroke-width="1.5"/>
        </svg>`,
      avatarSVG: `
        <svg viewBox="0 0 180 230" class="character-svg" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <linearGradient id="elonLeather" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stop-color="#353944"/>
              <stop offset="45%" stop-color="#191b22"/>
              <stop offset="100%" stop-color="#090a0e"/>
            </linearGradient>
            <linearGradient id="elonSkin" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="#fde5d4"/>
              <stop offset="55%" stop-color="#f0c8ad"/>
              <stop offset="100%" stop-color="#d8a586"/>
            </linearGradient>
            <radialGradient id="elonCheek" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stop-color="#e59a7d" stop-opacity="0.34"/>
              <stop offset="100%" stop-color="#e59a7d" stop-opacity="0"/>
            </radialGradient>
            <linearGradient id="elonHairTop" x1="0" y1="0" x2="0.4" y2="1">
              <stop offset="0%" stop-color="#624734"/>
              <stop offset="50%" stop-color="#3d2b1e"/>
              <stop offset="100%" stop-color="#21160f"/>
            </linearGradient>
            <linearGradient id="elonUndercut" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="#433226"/>
              <stop offset="100%" stop-color="#78604e" stop-opacity="0.35"/>
            </linearGradient>
            <radialGradient id="elonMarsTee" cx="35%" cy="35%" r="65%">
              <stop offset="0%" stop-color="#fb923c"/>
              <stop offset="60%" stop-color="#c2410c"/>
              <stop offset="100%" stop-color="#7c2d12"/>
            </radialGradient>
          </defs>

          <!-- Broad Shouldered Matte-Black Leather Keynote / Bomber Jacket -->
          <path d="M 10 164 Q 35 146 64 147 L 116 147 Q 145 146 170 164 L 178 230 L 2 230 Z" fill="url(#elonLeather)" stroke="#474c59" stroke-width="1.2"/>
          <path d="M 20 165 Q 42 153 60 154" stroke="#646a7a" stroke-width="2" fill="none" opacity="0.5" stroke-linecap="round"/>
          <path d="M 160 165 Q 138 153 120 154" stroke="#646a7a" stroke-width="2" fill="none" opacity="0.5" stroke-linecap="round"/>
          <!-- Standing Moto Collar -->
          <path d="M 60 147 Q 66 137 74 144 L 71 159 L 58 155 Z" fill="#23262e" stroke="#525866" stroke-width="1"/>
          <path d="M 120 147 Q 114 137 106 144 L 109 159 L 122 155 Z" fill="#23262e" stroke="#525866" stroke-width="1"/>

          <!-- Black Crewneck "OCCUPY MARS / 𝕏" T-Shirt (Raised so Mars + 𝕏 show clearly above table rail!) -->
          <polygon points="68,147 112,147 107,228 73,228" fill="#09090c"/>
          <path d="M 72 148 Q 90 158 108 148" stroke="#3f3f46" stroke-width="1.8" fill="none"/>
          <circle cx="90" cy="171" r="12.5" fill="url(#elonMarsTee)"/>
          <path d="M 80 168 Q 90 163 100 169" stroke="#fed7aa" stroke-width="1.5" fill="none" opacity="0.55"/>
          <text x="90" y="176" font-size="13.5" font-weight="900" fill="#ffffff" text-anchor="middle" font-family="sans-serif">𝕏</text>
          <text x="90" y="193" font-size="6.5" font-weight="900" fill="#e2e8f0" letter-spacing="1.6" text-anchor="middle" font-family="sans-serif">MARS</text>

          <!-- Metallic Leather Jacket Lapels & Silver Zipper -->
          <polygon points="56,153 72,151 72,226 48,204" fill="#181a20" stroke="#3f434e" stroke-width="1"/>
          <polygon points="124,153 108,151 108,226 132,204" fill="#181a20" stroke="#3f434e" stroke-width="1"/>
          <line x1="72" y1="153" x2="72" y2="226" stroke="#94a3b8" stroke-width="1.4" stroke-dasharray="2.5 2"/>
          <line x1="108" y1="153" x2="108" y2="226" stroke="#94a3b8" stroke-width="1.4" stroke-dasharray="2.5 2"/>
          <!-- Silver SpaceX Starship Rocket Pin on Left Lapel -->
          <g transform="translate(122 169) rotate(22)">
            <path d="M 0 -9 Q 3.2 -3 3.2 6 L -3.2 6 Q -3.2 -3 0 -9 Z" fill="#f1f5f9" stroke="#64748b" stroke-width="0.6"/>
            <polygon points="-3.2,3 -6.5,8 -3.2,6.5" fill="#38bdf8"/>
            <polygon points="3.2,3 6.5,8 3.2,6.5" fill="#38bdf8"/>
            <polygon points="-1.6,6 1.6,6 0,10.5" fill="#f97316"/>
          </g>

          <!-- Thick Sturdy Neck & Chin Shadow -->
          <path d="M 73 125 L 107 125 L 110 150 Q 90 157 70 150 Z" fill="url(#elonSkin)"/>
          <path d="M 75 130 Q 90 139 105 130 Q 90 144 75 130 Z" fill="#b98362" opacity="0.45"/>

          <!-- Ears -->
          <path d="M 55 88 Q 50 93 52 103 Q 54 110 59 108 Z" fill="#e2b495" stroke="#c38e6d" stroke-width="0.8"/>
          <path d="M 125 88 Q 130 93 128 103 Q 126 110 121 108 Z" fill="#e2b495" stroke="#c38e6d" stroke-width="0.8"/>

          <!-- Sculpted Elon Head & Face Geometry:
               High broad forehead, prominent wide high cheekbones, strong square-rounded jaw & chin -->
          <path d="
            M 56 80
            Q 55 47 90 46
            Q 125 47 124 80
            L 124 99
            Q 124 115 115 126
            Q 106 136 90 137
            Q 74 136 65 126
            Q 56 115 56 99 Z"
            fill="url(#elonSkin)" stroke="#c79575" stroke-width="0.7"/>

          <!-- Forehead Expression Lines -->
          <path d="M 72 67 Q 90 65 108 67" stroke="#c99677" stroke-width="0.85" fill="none" opacity="0.42"/>
          <path d="M 76 72 Q 90 70.5 104 72" stroke="#c99677" stroke-width="0.75" fill="none" opacity="0.32"/>

          <!-- High Rounded Elon Cheekbones & Jaw Contour -->
          <ellipse cx="69" cy="101" rx="9.5" ry="6.2" fill="url(#elonCheek)"/>
          <ellipse cx="111" cy="101" rx="9.5" ry="6.2" fill="url(#elonCheek)"/>
          <path d="M 62 114 Q 70 129 84 134" stroke="#bd8867" stroke-width="1.2" fill="none" opacity="0.45"/>
          <path d="M 118 114 Q 110 129 96 134" stroke="#bd8867" stroke-width="1.2" fill="none" opacity="0.45"/>

          <!-- Iconic Elon Modern Hairstyle: Tightly Buzzed Faded Undercut Sides + Swept Textured Quiff -->
          <path d="M 55 91 L 54 68 Q 56 58 63 55 L 63 72 Q 59 79 59 91 Z" fill="url(#elonUndercut)"/>
          <path d="M 125 91 L 126 68 Q 124 58 117 55 L 117 72 Q 121 79 121 91 Z" fill="url(#elonUndercut)"/>
          <!-- Textured swept-over top quiff with realistic slightly elevated temples -->
          <path d="
            M 56 68
            Q 54 50 66 40
            Q 80 30 102 32
            Q 120 34 125 48
            Q 127 59 124 70
            Q 120 60 113 58
            Q 107 56 105 52
            Q 93 50 82 55
            Q 72 59 67 65
            Q 61 63 56 68 Z"
            fill="url(#elonHairTop)"/>
          <!-- Textured diagonal quiff strands & slight silver-brown highlights -->
          <path d="M 64 46 Q 84 34 116 45" stroke="#85654d" stroke-width="3.2" fill="none" stroke-linecap="round" opacity="0.82"/>
          <path d="M 70 53 Q 91 42 117 52" stroke="#664b38" stroke-width="2.2" fill="none" stroke-linecap="round" opacity="0.72"/>
          <path d="M 78 39 Q 99 34 114 41" stroke="#9e7d63" stroke-width="1.5" fill="none" stroke-linecap="round" opacity="0.65"/>

          <!-- Iconic Elon Eyebrows (Straight & Expressive, Right Brow Subtly Arched) -->
          <path d="M 65 82.5 Q 74 79.5 84 82.5" stroke="#3d2b1f" stroke-width="2.6" fill="none" stroke-linecap="round"/>
          <path d="M 96 81.5 Q 106 77 115 80.5" stroke="#3d2b1f" stroke-width="2.6" fill="none" stroke-linecap="round"/>

          <!-- Deep-Set Narrow / Slightly Squinty Focused Hazel-Blue Elon Eyes -->
          <path d="M 66 89 Q 75 84.5 84 89" stroke="#c38e6d" stroke-width="1.2" fill="none" opacity="0.65"/>
          <path d="M 67 90.5 Q 75 87 83 90.5 Q 75 93.3 67 90.5 Z" fill="#ffffff"/>
          <circle cx="75.5" cy="90.2" r="2.6" fill="#4b697d"/>
          <circle cx="75.5" cy="90.2" r="1.3" fill="#0f172a"/>
          <circle cx="76.4" cy="89.4" r="0.65" fill="#ffffff"/>
          <path d="M 66.5 90 Q 75 86.2 83.5 90" stroke="#261912" stroke-width="1.8" fill="none" stroke-linecap="round"/>
          <path d="M 68 94.5 Q 75 96.4 82 94.2" stroke="#c08c6b" stroke-width="1.15" fill="none" opacity="0.62"/>

          <path d="M 96 89 Q 105 84.5 114 89" stroke="#c38e6d" stroke-width="1.2" fill="none" opacity="0.65"/>
          <path d="M 97 90.5 Q 105 87 113 90.5 Q 105 93.3 97 90.5 Z" fill="#ffffff"/>
          <circle cx="104.5" cy="90.2" r="2.6" fill="#4b697d"/>
          <circle cx="104.5" cy="90.2" r="1.3" fill="#0f172a"/>
          <circle cx="105.4" cy="89.4" r="0.65" fill="#ffffff"/>
          <path d="M 96.5 90 Q 105 86.2 113.5 90" stroke="#261912" stroke-width="1.8" fill="none" stroke-linecap="round"/>
          <path d="M 98 94.2 Q 105 96.4 112 94.5" stroke="#c08c6b" stroke-width="1.15" fill="none" opacity="0.62"/>

          <!-- Classic Elon Broad Rounded Nose -->
          <path d="M 88 89 L 86.5 101" stroke="#c79270" stroke-width="1.2" fill="none" opacity="0.65"/>
          <path d="M 84 103.5 Q 90 107.5 96 103.5" stroke="#b57d5b" stroke-width="1.8" fill="none" stroke-linecap="round"/>
          <ellipse cx="86.5" cy="104" rx="1.6" ry="0.9" fill="#a8704e" opacity="0.65"/>
          <ellipse cx="93.5" cy="104" rx="1.6" ry="0.9" fill="#a8704e" opacity="0.65"/>

          <!-- Smiling Cheek Creases / Nasolabial Folds -->
          <path d="M 79 104 Q 73 111 73 118" stroke="#c18b6a" stroke-width="1.15" fill="none" opacity="0.52" stroke-linecap="round"/>
          <path d="M 101 104 Q 107 111 107 117" stroke="#c18b6a" stroke-width="1.15" fill="none" opacity="0.52" stroke-linecap="round"/>

          <!-- Signature Elon Confident Lopsided Keynote Smirk (Tight-Lipped, Right Corner Cocked Up!) -->
          <path d="M 77 116.5 Q 91 119.5 104 113.5" stroke="#7d4a3a" stroke-width="2.4" fill="none" stroke-linecap="round"/>
          <path d="M 82 119.5 Q 91 121.5 99 118.5" stroke="#c2856d" stroke-width="1.25" fill="none" stroke-linecap="round" opacity="0.72"/>
          <path d="M 103 111.5 Q 106.5 113.5 104.5 116" stroke="#a66f50" stroke-width="1.2" fill="none" stroke-linecap="round"/>

          <!-- Light Chin Scruff & Chin Cleft -->
          <path d="M 76 125 Q 90 134 104 125 Q 90 136 76 125 Z" fill="#5c4332" opacity="0.16"/>
          <path d="M 86 127 Q 90 129.5 94 127" stroke="#b98260" stroke-width="1.3" fill="none" opacity="0.65" stroke-linecap="round"/>
        </svg>`,
    },

    // 5. Parody Soviet Communist (Comrade Viktor)
    viktor: {
      chairSVG: `
        <svg viewBox="0 0 210 250" class="chair-svg" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <linearGradient id="vikWood" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="#450a0a"/><stop offset="100%" stop-color="#1a0303"/>
            </linearGradient>
            <linearGradient id="vikLeather" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="#991b1b"/><stop offset="55%" stop-color="#7f1d1d"/><stop offset="100%" stop-color="#450a0a"/>
            </linearGradient>
            <linearGradient id="vikArm" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="#b91c1c"/><stop offset="100%" stop-color="#450a0a"/>
            </linearGradient>
          </defs>
          <path d="M 22 245 L 22 85 Q 22 18 105 14 Q 188 18 188 85 L 188 245 Z" fill="url(#vikWood)" stroke="#facc15" stroke-width="2.5"/>
          <!-- Gold Star Crest -->
          <polygon points="105,5 108,12 116,12 110,17 112,24 105,20 98,24 100,17 94,12 102,12" fill="#facc15" stroke="#854d0e" stroke-width="0.8"/>
          <path d="M 32 245 L 32 85 Q 32 28 105 24 Q 178 28 178 85 L 178 245 Z" fill="url(#vikLeather)" stroke="#eab308" stroke-width="1.5"/>
          <rect x="10" y="150" width="24" height="85" rx="6" fill="url(#vikWood)" stroke="#facc15" stroke-width="1.5"/>
          <rect x="6" y="144" width="32" height="16" rx="8" fill="url(#vikArm)" stroke="#facc15" stroke-width="1.5"/>
          <rect x="176" y="150" width="24" height="85" rx="6" fill="url(#vikWood)" stroke="#facc15" stroke-width="1.5"/>
          <rect x="172" y="144" width="32" height="16" rx="8" fill="url(#vikArm)" stroke="#facc15" stroke-width="1.5"/>
        </svg>`,
      avatarSVG: `
        <svg viewBox="0 0 180 230" class="character-svg" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <linearGradient id="vikCoat" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="#4d5c3b"/><stop offset="100%" stop-color="#27301d"/>
            </linearGradient>
            <linearGradient id="vikSkin" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="#f7d6be"/><stop offset="100%" stop-color="#d4a07e"/>
            </linearGradient>
            <linearGradient id="vikFur" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="#64748b"/><stop offset="100%" stop-color="#334155"/>
            </linearGradient>
          </defs>
          <!-- Heavy Olive Soviet Greatcoat -->
          <path d="M 16 162 Q 90 148 164 162 L 178 230 L 2 230 Z" fill="url(#vikCoat)" />
          <!-- Red Shoulder Epaulettes & Gold Buttons -->
          <rect x="24" y="155" width="30" height="8" rx="2" fill="#dc2626" stroke="#facc15" stroke-width="1.2"/>
          <rect x="126" y="155" width="30" height="8" rx="2" fill="#dc2626" stroke="#facc15" stroke-width="1.2"/>
          <polygon points="74,152 106,152 100,174 80,174" fill="#991b1b" />
          <circle cx="80" cy="186" r="3.5" fill="#facc15"/><circle cx="100" cy="186" r="3.5" fill="#facc15"/>
          <circle cx="80" cy="206" r="3.5" fill="#facc15"/><circle cx="100" cy="206" r="3.5" fill="#facc15"/>
          <!-- Neck & Stern Face -->
          <rect x="76" y="128" width="28" height="25" rx="4" fill="url(#vikSkin)" />
          <ellipse cx="90" cy="100" rx="29" ry="32" fill="url(#vikSkin)" />
          <!-- Iconic Fur Ushanka Hat with Ear Flaps & Red/Gold Star -->
          <rect x="52" y="34" width="76" height="44" rx="14" fill="url(#vikFur)" stroke="#1e293b" stroke-width="1.5"/>
          <rect x="46" y="64" width="16" height="42" rx="7" fill="url(#vikFur)" stroke="#1e293b" stroke-width="1.2"/>
          <rect x="118" y="64" width="16" height="42" rx="7" fill="url(#vikFur)" stroke="#1e293b" stroke-width="1.2"/>
          <!-- Red Star Emblem on Ushanka -->
          <polygon points="90,46 93,53 101,53 95,58 97,65 90,61 83,65 85,58 79,53 87,53" fill="#dc2626" stroke="#facc15" stroke-width="1.2"/>
          <!-- Stern Bushy Eyebrows & Thick Mustache -->
          <ellipse cx="78" cy="96" rx="3.5" ry="2.5" fill="#1e293b"/>
          <ellipse cx="102" cy="96" rx="3.5" ry="2.5" fill="#1e293b"/>
          <path d="M 68 87 L 85 91" stroke="#334155" stroke-width="3.5" stroke-linecap="round"/>
          <path d="M 112 87 L 95 91" stroke="#334155" stroke-width="3.5" stroke-linecap="round"/>
          <path d="M 66 116 Q 90 104 114 116 Q 100 123 90 118 Q 80 123 66 116 Z" fill="#334155"/>
        </svg>`,
    },

    // 6. Rich Chinese High-Roller Lady (Madame Mei-Ling)
    meiling: {
      chairSVG: `
        <svg viewBox="0 0 210 250" class="chair-svg" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <linearGradient id="meiWood" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="#26080b"/><stop offset="100%" stop-color="#0d0204"/>
            </linearGradient>
            <linearGradient id="meiSilk" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="#be123c"/><stop offset="55%" stop-color="#881337"/><stop offset="100%" stop-color="#4c0519"/>
            </linearGradient>
            <linearGradient id="meiArm" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="#e11d48"/><stop offset="100%" stop-color="#4c0519"/>
            </linearGradient>
          </defs>
          <!-- Imperial Black Lacquer & Gold Silk VIP Chair -->
          <path d="M 22 245 L 22 85 Q 22 18 105 14 Q 188 18 188 85 L 188 245 Z" fill="url(#meiWood)" stroke="#ffd700" stroke-width="2.5"/>
          <circle cx="105" cy="15" r="8" fill="#10b981" stroke="#ffd700" stroke-width="2"/>
          <path d="M 32 245 L 32 85 Q 32 28 105 24 Q 178 28 178 85 L 178 245 Z" fill="url(#meiSilk)" stroke="#ffd700" stroke-width="1.5"/>
          <!-- Golden Imperial Medallion Motif -->
          <circle cx="105" cy="86" r="24" fill="none" stroke="#ffd700" stroke-width="1.4" opacity="0.45"/>
          <rect x="10" y="150" width="24" height="85" rx="6" fill="url(#meiWood)" stroke="#ffd700" stroke-width="1.5"/>
          <rect x="6" y="144" width="32" height="16" rx="8" fill="url(#meiArm)" stroke="#ffd700" stroke-width="1.5"/>
          <rect x="176" y="150" width="24" height="85" rx="6" fill="url(#meiWood)" stroke="#ffd700" stroke-width="1.5"/>
          <rect x="172" y="144" width="32" height="16" rx="8" fill="url(#meiArm)" stroke="#ffd700" stroke-width="1.5"/>
        </svg>`,
      avatarSVG: `
        <svg viewBox="0 0 180 230" class="character-svg" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <linearGradient id="meiQipao" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="#dc2626"/><stop offset="100%" stop-color="#7f1d1d"/>
            </linearGradient>
            <linearGradient id="meiSkin" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="#fee8d6"/><stop offset="100%" stop-color="#e8bea0"/>
            </linearGradient>
          </defs>
          <!-- Elegant High Hair Bun & Golden Jade Hairpin -->
          <circle cx="90" cy="46" r="19" fill="#18181b" />
          <line x1="56" y1="36" x2="128" y2="54" stroke="#ffd700" stroke-width="3" stroke-linecap="round"/>
          <circle cx="56" cy="36" r="5" fill="#10b981" stroke="#ffd700" stroke-width="1.5"/>
          <!-- Imperial Crimson & Gold Silk Qipao -->
          <path d="M 28 164 Q 90 148 152 164 L 166 230 L 14 230 Z" fill="url(#meiQipao)" stroke="#ffd700" stroke-width="1.5"/>
          <!-- Mandarin Collar with Gold Frog Clasp -->
          <rect x="75" y="140" width="30" height="18" rx="4" fill="#b91c1c" stroke="#ffd700" stroke-width="1.5"/>
          <path d="M 90 158 Q 112 168 124 188" stroke="#ffd700" stroke-width="2" fill="none"/>
          <!-- Luminous Jade Pendant Necklace -->
          <circle cx="90" cy="176" r="6" fill="#10b981" stroke="#ffd700" stroke-width="1.5"/>
          <!-- Neck & Poised Face -->
          <rect x="81" y="124" width="18" height="22" rx="4" fill="url(#meiSkin)" />
          <ellipse cx="90" cy="96" rx="26" ry="32" fill="url(#meiSkin)" />
          <!-- Sleek Jet-Black Parted Hair -->
          <path d="M 60 94 Q 60 56 90 54 Q 120 56 120 94 Q 112 70 90 68 Q 68 70 60 94 Z" fill="#18181b" />
          <!-- Jade & Gold Drop Earrings -->
          <circle cx="62" cy="108" r="3.5" fill="#10b981" stroke="#ffd700" stroke-width="1.2"/>
          <circle cx="118" cy="108" r="3.5" fill="#10b981" stroke="#ffd700" stroke-width="1.2"/>
          <!-- Poised Eyes & Crimson Lip Smile -->
          <path d="M 73 94 Q 78 90 84 94" stroke="#18181b" stroke-width="2.5" fill="none" stroke-linecap="round"/>
          <path d="M 96 94 Q 102 90 107 94" stroke="#18181b" stroke-width="2.5" fill="none" stroke-linecap="round"/>
          <path d="M 72 86 Q 78 83 84 86" stroke="#18181b" stroke-width="1.6" fill="none"/>
          <path d="M 96 86 Q 102 83 108 86" stroke="#18181b" stroke-width="1.6" fill="none"/>
          <path d="M 81 113 Q 90 119 99 113" stroke="#dc2626" stroke-width="2.8" fill="none" stroke-linecap="round"/>
        </svg>`,
    },

    // 7. Parody New York Italian Mobster (Don "Big Tony")
    tony: {
      chairSVG: `
        <svg viewBox="0 0 210 250" class="chair-svg" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <linearGradient id="tonyWood" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="#3b1510"/><stop offset="100%" stop-color="#140604"/>
            </linearGradient>
            <linearGradient id="tonyLeather" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="#27272a"/><stop offset="55%" stop-color="#18181b"/><stop offset="100%" stop-color="#09090b"/>
            </linearGradient>
            <linearGradient id="tonyArm" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="#3f3f46"/><stop offset="100%" stop-color="#18181b"/>
            </linearGradient>
          </defs>
          <!-- Classic Brooklyn Social Club Black Leather Chair -->
          <path d="M 22 245 L 22 85 Q 22 18 105 14 Q 188 18 188 85 L 188 245 Z" fill="url(#tonyWood)" stroke="#d4af37" stroke-width="2.5"/>
          <path d="M 86 15 Q 105 7 124 15 Q 105 22 86 15 Z" fill="#991b1b" stroke="#ffd700" stroke-width="1.2"/>
          <path d="M 32 245 L 32 85 Q 32 28 105 24 Q 178 28 178 85 L 178 245 Z" fill="url(#tonyLeather)" stroke="#b45309" stroke-width="1.5"/>
          <path d="M 65 72 L 105 112 L 145 72 M 65 122 L 105 162 L 145 122" stroke="#52525b" stroke-width="1.5" fill="none" opacity="0.6"/>
          <circle cx="105" cy="64" r="3" fill="#ffd700"/><circle cx="65" cy="102" r="3" fill="#ffd700"/><circle cx="145" cy="102" r="3" fill="#ffd700"/>
          <rect x="10" y="150" width="24" height="85" rx="6" fill="url(#tonyWood)" stroke="#d4af37" stroke-width="1.5"/>
          <rect x="6" y="144" width="32" height="16" rx="8" fill="url(#tonyArm)" stroke="#ffd700" stroke-width="1.5"/>
          <rect x="176" y="150" width="24" height="85" rx="6" fill="url(#tonyWood)" stroke="#d4af37" stroke-width="1.5"/>
          <rect x="172" y="144" width="32" height="16" rx="8" fill="url(#tonyArm)" stroke="#ffd700" stroke-width="1.5"/>
        </svg>`,
      avatarSVG: `
        <svg viewBox="0 0 180 230" class="character-svg" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <linearGradient id="tonySuit" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="#27272a"/><stop offset="100%" stop-color="#09090b"/>
            </linearGradient>
            <linearGradient id="tonySkin" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="#f2c49b"/><stop offset="100%" stop-color="#c98f63"/>
            </linearGradient>
          </defs>
          <!-- Classic Black Pinstripe Mobster Suit -->
          <path d="M 14 162 Q 90 146 166 162 L 178 230 L 2 230 Z" fill="url(#tonySuit)" />
          <!-- Pinstripes -->
          <g stroke="#71717a" stroke-width="1" opacity="0.45">
            <line x1="34" y1="158" x2="26" y2="230"/><line x1="50" y1="155" x2="44" y2="230"/>
            <line x1="66" y1="153" x2="62" y2="230"/><line x1="114" y1="153" x2="118" y2="230"/>
            <line x1="130" y1="155" x2="136" y2="230"/><line x1="146" y1="158" x2="154" y2="230"/>
          </g>
          <!-- Open-Collar White Shirt & Heavy Gold Chain -->
          <polygon points="68,150 112,150 100,208 80,208" fill="#f8fafc" />
          <path d="M 75 162 Q 90 184 105 162" stroke="#ffd700" stroke-width="3.2" fill="none"/>
          <path d="M 79 167 Q 90 186 101 167" stroke="#f59e0b" stroke-width="1.8" fill="none"/>
          <!-- Red Rose Boutonniere on Lapel -->
          <circle cx="122" cy="176" r="6" fill="#dc2626" stroke="#7f1d1d" stroke-width="1.2"/>
          <circle cx="122" cy="176" r="2.5" fill="#991b1b"/>
          <path d="M 122 182 L 120 190" stroke="#16a34a" stroke-width="2" stroke-linecap="round"/>
          <!-- Thick Neck & Broad Jaw Face -->
          <rect x="74" y="126" width="32" height="28" rx="6" fill="url(#tonySkin)" />
          <path d="M 59 95 Q 59 64 90 64 Q 121 64 121 95 Q 121 128 90 132 Q 59 128 59 95 Z" fill="url(#tonySkin)" />
          <!-- Classic Tilted Black Mafia Fedora -->
          <g transform="rotate(-4 90 66)">
            <ellipse cx="90" cy="70" rx="48" ry="9" fill="#18181b" stroke="#3f3f46" stroke-width="1.2"/>
            <path d="M 56 68 Q 62 34 80 38 Q 90 42 100 38 Q 118 34 124 68 Z" fill="#18181b" stroke="#27272a" stroke-width="1"/>
            <rect x="57" y="59" width="66" height="8" fill="#e5e7eb"/>
            <rect x="57" y="65" width="66" height="2" fill="#991b1b"/>
          </g>
          <!-- Thick Dark Eyebrows & Cool Dark Shades -->
          <path d="M 65 84 L 84 87" stroke="#18181b" stroke-width="3.2" stroke-linecap="round"/>
          <path d="M 115 84 L 96 87" stroke="#18181b" stroke-width="3.2" stroke-linecap="round"/>
          <rect x="64" y="88" width="23" height="14" rx="3" fill="#09090b" stroke="#d4af37" stroke-width="1.4"/>
          <rect x="93" y="88" width="23" height="14" rx="3" fill="#09090b" stroke="#d4af37" stroke-width="1.4"/>
          <line x1="87" y1="93" x2="93" y2="93" stroke="#d4af37" stroke-width="2"/>
          <!-- Wiseguy Smirk & Cigar with Smoke Wisp -->
          <path d="M 78 115 Q 90 119 103 113" stroke="#6b341a" stroke-width="2.5" fill="none" stroke-linecap="round"/>
          <g transform="rotate(14 102 115)">
            <rect x="100" y="112" width="24" height="5.5" rx="2" fill="#78350f" stroke="#451a03" stroke-width="0.8"/>
            <rect x="121" y="112" width="4" height="5.5" rx="1" fill="#f97316"/>
          </g>
          <path d="M 127 114 Q 134 104 129 94 Q 137 86 132 76" stroke="#e5e7eb" stroke-width="1.8" fill="none" opacity="0.55" stroke-linecap="round"/>
        </svg>`,
    },

    // 8. Parody Rich Middle Eastern Sheikh (Sheikh Tariq)
    tariq: {
      chairSVG: `
        <svg viewBox="0 0 210 250" class="chair-svg" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <linearGradient id="tariqGoldFrame" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="#fde047"/><stop offset="50%" stop-color="#d97706"/><stop offset="100%" stop-color="#78350f"/>
            </linearGradient>
            <linearGradient id="tariqIvorySilk" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="#fefce8"/><stop offset="55%" stop-color="#f5e6c8"/><stop offset="100%" stop-color="#c9b28a"/>
            </linearGradient>
            <linearGradient id="tariqArm" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="#fef08a"/><stop offset="100%" stop-color="#b45309"/>
            </linearGradient>
          </defs>
          <!-- 24-Karat Gold & Royal Ivory Arabian Palace Throne -->
          <path d="M 22 245 L 22 88 Q 22 32 105 8 Q 188 32 188 88 L 188 245 Z" fill="url(#tariqGoldFrame)" stroke="#fef08a" stroke-width="2.5"/>
          <path d="M 33 245 L 33 90 Q 33 42 105 22 Q 177 42 177 90 L 177 245 Z" fill="url(#tariqIvorySilk)" stroke="#d97706" stroke-width="1.8"/>
          <!-- Golden Geometric Filigree & Diamond Crest -->
          <polygon points="105,6 112,15 105,24 98,15" fill="#10b981" stroke="#fef08a" stroke-width="1.5"/>
          <path d="M 65 78 L 105 118 L 145 78 M 65 128 L 105 168 L 145 128" stroke="#d97706" stroke-width="1.4" fill="none" opacity="0.45"/>
          <circle cx="105" cy="68" r="3" fill="#d97706"/><circle cx="65" cy="108" r="3" fill="#d97706"/><circle cx="145" cy="108" r="3" fill="#d97706"/>
          <rect x="10" y="150" width="24" height="85" rx="6" fill="url(#tariqGoldFrame)" stroke="#fef08a" stroke-width="1.5"/>
          <rect x="6" y="144" width="32" height="16" rx="8" fill="url(#tariqArm)" stroke="#fef08a" stroke-width="1.5"/>
          <rect x="176" y="150" width="24" height="85" rx="6" fill="url(#tariqGoldFrame)" stroke="#fef08a" stroke-width="1.5"/>
          <rect x="172" y="144" width="32" height="16" rx="8" fill="url(#tariqArm)" stroke="#fef08a" stroke-width="1.5"/>
        </svg>`,
      avatarSVG: `
        <svg viewBox="0 0 180 230" class="character-svg" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <linearGradient id="tariqBisht" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="#1e1b18"/><stop offset="100%" stop-color="#090807"/>
            </linearGradient>
            <linearGradient id="tariqThobe" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="#ffffff"/><stop offset="100%" stop-color="#e2e8f0"/>
            </linearGradient>
            <linearGradient id="tariqSkin" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="#e6b68a"/><stop offset="100%" stop-color="#b98153"/>
            </linearGradient>
          </defs>
          <!-- Flowing Black Ceremonial Bisht Cloak with Rich Gold Embroidery -->
          <path d="M 14 162 Q 90 146 166 162 L 178 230 L 2 230 Z" fill="url(#tariqBisht)" />
          <!-- Crisp White Thobe Center -->
          <polygon points="62,150 118,150 112,230 68,230" fill="url(#tariqThobe)" />
          <!-- Ornate 24k Gold Bisht Border Trim -->
          <path d="M 60 152 L 66 230" stroke="#ffd700" stroke-width="7" />
          <path d="M 120 152 L 114 230" stroke="#ffd700" stroke-width="7" />
          <path d="M 55 152 L 61 230" stroke="#b45309" stroke-width="1.5" stroke-dasharray="4 3"/>
          <path d="M 125 152 L 119 230" stroke="#b45309" stroke-width="1.5" stroke-dasharray="4 3"/>
          <!-- Golden Tassel Collar Clasp -->
          <circle cx="90" cy="166" r="4" fill="#ffd700" stroke="#92400e" stroke-width="1"/>
          <line x1="90" y1="170" x2="90" y2="195" stroke="#ffd700" stroke-width="2" stroke-dasharray="3 2"/>
          <!-- Back Drape of Snowy-White Ghutra Headscarf -->
          <path d="M 46 86 Q 38 145 48 182 L 132 182 Q 142 145 134 86 Q 130 46 90 44 Q 50 46 46 86 Z" fill="url(#tariqThobe)" stroke="#cbd5e1" stroke-width="1.2"/>
          <!-- Neck & Golden-Olive Face -->
          <rect x="78" y="124" width="24" height="26" rx="4" fill="url(#tariqSkin)" />
          <ellipse cx="90" cy="96" rx="26" ry="32" fill="url(#tariqSkin)" />
          <!-- Front Ghutra Fold Framing the Face -->
          <path d="M 54 78 Q 90 66 126 78 Q 132 52 90 46 Q 48 52 54 78 Z" fill="#ffffff" stroke="#e2e8f0" stroke-width="1"/>
          <!-- Double Royal Black & Gold Agal Cord -->
          <rect x="52" y="54" width="76" height="8" rx="4" fill="#18181b" stroke="#ffd700" stroke-width="1.5"/>
          <rect x="53" y="61" width="74" height="7" rx="3.5" fill="#09090b" stroke="#d4af37" stroke-width="1.2"/>
          <!-- Gold-Rimmed Luxury Aviator Sunglasses -->
          <path d="M 65 86 L 86 86 L 84 99 Q 74 103 65 96 Z" fill="#18181b" stroke="#ffd700" stroke-width="1.8"/>
          <path d="M 115 86 L 94 86 L 96 99 Q 106 103 115 96 Z" fill="#18181b" stroke="#ffd700" stroke-width="1.8"/>
          <line x1="86" y1="88" x2="94" y2="88" stroke="#ffd700" stroke-width="2"/>
          <line x1="69" y1="88" x2="75" y2="97" stroke="#fef08a" stroke-width="1.5" opacity="0.65"/>
          <line x1="99" y1="88" x2="105" y2="97" stroke="#fef08a" stroke-width="1.5" opacity="0.65"/>
          <!-- Regal Neatly Trimmed Dark Beard & Mustache -->
          <path d="M 65 102 Q 66 128 90 132 Q 114 128 115 102 Q 110 118 90 120 Q 70 118 65 102 Z" fill="#18181b" />
          <path d="M 74 111 Q 90 105 106 111 Q 98 115 90 113 Q 82 115 74 111 Z" fill="#18181b" />
          <!-- Generous Billionaire Smile -->
          <path d="M 81 116 Q 90 122 99 116" stroke="#ffffff" stroke-width="2.6" fill="none" stroke-linecap="round"/>
        </svg>`,
    },
  };

  // =========================================================================
  // ACCESSIBLE CARD RENDERING HELPERS
  // =========================================================================
  const ACCESSIBLE_RANK_NAMES = {
    A: 'Ace',
    K: 'King',
    Q: 'Queen',
    J: 'Jack',
  };

  const ACCESSIBLE_SUIT_NAMES = {
    '♠': 'Spades',
    '♥': 'Hearts',
    '♦': 'Diamonds',
    '♣': 'Clubs',
  };

  function formatAccessibleCardName(card) {
    if (!card || card.str === '??' || !card.value || !card.suit) {
      return 'Face-down card';
    }
    const rankName = ACCESSIBLE_RANK_NAMES[card.value] || String(card.value);
    const suitName = ACCESSIBLE_SUIT_NAMES[card.suit] || String(card.suit);
    return `${rankName} of ${suitName}`;
  }

  function escapeHTMLAttr(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  // Card Suit HTML Renderer (uses sharp vector SVG for diamonds)
  function renderSuitHTML(suit) {
    if (suit === '♦') {
      return '<svg class="suit-icon-svg diamond-svg" viewBox="0 0 24 28" fill="currentColor" aria-hidden="true"><path d="M 12 1.5 L 21.5 14 L 12 26.5 L 2.5 14 Z"/></svg>';
    }
    return suit;
  }

  // Face-Down Card Back HTML Generator
  function renderCardBackHTML() {
    return '<div class="card card-back" role="img" aria-label="Face-down card"><div class="card-back-pattern" aria-hidden="true"></div></div>';
  }

  // Card HTML Generator
  function renderCardHTML(cardData, isBestFive = false) {
    if (!cardData || cardData.str === '??') {
      return renderCardBackHTML();
    }
    const suitMarkup = renderSuitHTML(cardData.suit);
    const accessibleName = escapeHTMLAttr(formatAccessibleCardName(cardData));
    const highlightClass = isBestFive ? ' best-five-highlight' : '';
    const badgeMarkup = isBestFive ? '<span class="best-five-badge" title="Best 5-Card Hand" aria-hidden="true">★</span>' : '';
    return `
      <div class="card ${cardData.color} flipping${highlightClass}" role="img" aria-label="${accessibleName}" data-card="${cardData.str}">
        ${badgeMarkup}
        <div class="card-top-idx" aria-hidden="true">
          <span class="card-val" aria-hidden="true">${cardData.value}</span>
          <span class="card-suit" aria-hidden="true">${suitMarkup}</span>
        </div>
        <div class="card-center-suit" aria-hidden="true">${suitMarkup}</div>
        <div class="card-bottom-idx" aria-hidden="true">
          <span class="card-val" aria-hidden="true">${cardData.value}</span>
          <span class="card-suit" aria-hidden="true">${suitMarkup}</span>
        </div>
      </div>
    `;
  }

  if (typeof globalThis !== 'undefined') {
    globalThis.__POKER_CARD_A11Y__ = {
      formatAccessibleCardName,
      renderSuitHTML,
      renderCardBackHTML,
      renderCardHTML,
    };
  }

  if (typeof document === 'undefined') {
    return;
  }

  // =========================================================================
  // CLIENT CONTROLLER
  // =========================================================================
  const sfx = new SoundFX();
  window.__POKER_SFX__ = sfx;
  let currentState = null;
  let activeHotkeys = {};
  let isActionLocked = false;
  let isPlayingTurns = false;
  let skipCurrentPlayback = false;
  let skipPlaybackHadFocus = false;
  let activeDelayCancel = null;
  let renderedRosterKey = '';
  let pickedOpponentIds = [];
  let pickerBuilt = false;
  let pickerOpenedManually = false;

  const TURN_SPEED_STORAGE_KEY = 'high_roller_turn_speed';
  const SPEED_PRESETS = [
    { id: '1x', label: '⚡ Speed: 1x', multiplier: 1.0 },
    { id: '2x', label: '⚡ Speed: 2x', multiplier: 0.5 },
    { id: '4x', label: '⚡ Speed: 4x', multiplier: 0.25 },
  ];

  function parseQueryTurnSpeed() {
    try {
      const params = new URLSearchParams(window.location.search || '');
      const raw = params.get('turnSpeed');
      if (raw === null || raw === '') return null;
      const trimmed = raw.trim().toLowerCase();
      const preset = SPEED_PRESETS.find((p) => p.id === trimmed);
      if (preset) {
        return { presetId: preset.id, multiplier: preset.multiplier };
      }
      const num = Number(trimmed);
      if (Number.isFinite(num) && num >= 0) {
        const matchedPreset = SPEED_PRESETS.find((p) => Math.abs(p.multiplier - num) < 1e-6);
        return {
          presetId: matchedPreset ? matchedPreset.id : null,
          multiplier: num,
        };
      }
    } catch {
      // ignore URL parse error
    }
    return null;
  }

  function loadInitialSpeedPresetId(queryOverride) {
    if (queryOverride && queryOverride.presetId) {
      return queryOverride.presetId;
    }
    try {
      const saved = window.localStorage ? window.localStorage.getItem(TURN_SPEED_STORAGE_KEY) : null;
      if (saved && SPEED_PRESETS.some((p) => p.id === saved)) {
        return saved;
      }
    } catch {
      // ignore storage errors
    }
    return '1x';
  }

  const initialQueryTurnSpeed = parseQueryTurnSpeed();
  let queryTurnSpeedOverride = initialQueryTurnSpeed ? initialQueryTurnSpeed.multiplier : null;
  let currentSpeedPresetId = loadInitialSpeedPresetId(initialQueryTurnSpeed);

  function getTurnSpeedMultiplier() {
    if (queryTurnSpeedOverride !== null) {
      return queryTurnSpeedOverride;
    }
    if (typeof window.__POKER_TURN_SPEED__ === 'number' && Number.isFinite(window.__POKER_TURN_SPEED__)) {
      return window.__POKER_TURN_SPEED__;
    }
    const preset = SPEED_PRESETS.find((p) => p.id === currentSpeedPresetId) || SPEED_PRESETS[0];
    return preset.multiplier;
  }

  const SPEAKER_ICONS = {
    Dealer: '🤵',
    Reginald: '🎩',
    Buck: '🤠',
    Bruce: '🦘',
    Elon: '🚀',
    Viktor: '⭐',
    'Mei-Ling': '🐉',
    Tony: '🤌',
    Tariq: '👑',
    You: '👤',
    System: '🎰',
  };

  function delay(ms) {
    if (skipCurrentPlayback) {
      return Promise.resolve();
    }
    const speed = getTurnSpeedMultiplier();
    const waitMs = Math.max(0, Math.round(ms * speed));
    if (waitMs <= 0) {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (activeDelayCancel === finish) {
          activeDelayCancel = null;
        }
        resolve();
      };
      const timer = setTimeout(finish, waitMs);
      activeDelayCancel = finish;
    });
  }

  function triggerSkipPlayback() {
    if (!isPlayingTurns) return;
    if (
      elSkipPlaybackBtn &&
      (document.activeElement === elSkipPlaybackBtn || elSkipPlaybackBtn.contains(document.activeElement))
    ) {
      skipPlaybackHadFocus = true;
    }
    skipCurrentPlayback = true;
    if (typeof activeDelayCancel === 'function') {
      activeDelayCancel();
    }
  }

  // DOM Elements
  const elHandCount = document.getElementById('stat-hand-count');
  const elStatPosition = document.getElementById('stat-position');
  const elDifficulty = document.getElementById('stat-difficulty');
  const elSoundToggle = document.getElementById('sound-toggle');
  const elSoundIcon = document.getElementById('sound-icon');
  const elPotsToggleBtn = document.getElementById('pots-toggle-btn');
  const elPickOpponentsBtn = document.getElementById('pick-opponents-btn');
  const elSpeedToggleBtn = document.getElementById('speed-toggle-btn');
  const elSkipPlaybackBtn = document.getElementById('skip-playback-btn');

  // Hidable Table Pots Window Elements
  const elPotsWindow = document.getElementById('pots-window');
  const elPotsWindowClose = document.getElementById('pots-window-close');
  const elPotsWindowTotal = document.getElementById('pots-window-total');
  const elPotsWindowBody = document.getElementById('pots-window-body');

  // Opponent Selection Modal Elements (Native <dialog>)
  const elOppModalOverlay = document.getElementById('opponent-modal-overlay');
  const elOppPickerGrid = document.getElementById('opponent-picker-grid');
  const elOppSelectCount = document.getElementById('opponent-select-count');
  const elBtnCancelOpps = document.getElementById('btn-cancel-opponents');
  const elBtnRandomOpps = document.getElementById('btn-random-opponents');
  const elBtnConfirmOpps = document.getElementById('btn-confirm-opponents');

  const elDealerBubble = document.getElementById('dealer-speech-bubble');
  const elDealerBubbleText = document.getElementById('dealer-bubble-text');
  const elDealerButton = document.getElementById('dealer-button');

  const elPotAmount = document.getElementById('pot-amount');
  const elPotChipsVisual = document.getElementById('pot-chips-visual');
  const elStreetBanner = document.getElementById('street-banner');

  const elPlayerPositionBadge = document.getElementById('player-position-badge');
  const elPlayerChipTag = document.getElementById('player-chip-tag');
  const elPlayerChipsVisual = document.getElementById('player-chips-visual');
  const elPlayerHandRank = document.getElementById('player-hand-rank');
  const elPlayerCardsContainer = document.getElementById('player-cards-container');

  const elSpeakerThumb = document.getElementById('speaker-thumb');
  const elSpeakerName = document.getElementById('speaker-name');
  const elHudStreetStatus = document.getElementById('hud-street-status');
  const elDialogueMainText = document.getElementById('dialogue-main-text');
  const elSessionSummaryPanel = document.getElementById('session-summary-panel');
  const elSummaryTotalBuyIn = document.getElementById('summary-total-buyin');
  const elSummaryHandsPlayed = document.getElementById('summary-hands-played');
  const elSummaryHandsWon = document.getElementById('summary-hands-won');
  const elSummaryFinalStack = document.getElementById('summary-final-stack');
  const elSummaryStartingStack = document.getElementById('summary-starting-stack');
  const elSummaryRebuys = document.getElementById('summary-rebuys');
  const elSummaryRebuysSub = document.getElementById('summary-rebuys-sub');
  const elSummaryNetProfit = document.getElementById('summary-net-profit');
  const elSummaryNetSub = document.getElementById('summary-net-sub');
  const elActionPromptTitle = document.getElementById('action-prompt-title');
  const elActionButtonsGroup = document.getElementById('action-buttons-group');

  const elLogToggleBtn = document.getElementById('log-toggle-btn');
  const elHistoryDrawer = document.getElementById('history-drawer');
  const elDrawerClose = document.getElementById('drawer-close');
  const elDrawerContent = document.getElementById('drawer-content');

  function syncSoundToggleUI(muted) {
    const isMuted = Boolean(muted);
    if (elSoundIcon) {
      elSoundIcon.textContent = isMuted ? '🔇' : '🔊';
    }
    if (elSoundToggle) {
      const tooltip = isMuted ? 'Unmute Sound (M)' : 'Mute Sound (M)';
      elSoundToggle.setAttribute('aria-pressed', String(isMuted));
      elSoundToggle.setAttribute('aria-label', 'Mute Sound (M)');
      elSoundToggle.setAttribute('title', tooltip);
      elSoundToggle.classList.toggle('is-muted', isMuted);
    }
  }
  syncSoundToggleUI(sfx.muted);

  // Initialize Audio on First User Interaction
  function ensureAudio() {
    sfx.init();
  }
  window.addEventListener('click', ensureAudio, { once: true });
  window.addEventListener('keydown', ensureAudio, { once: true });

  // Sound Toggle Handler
  elSoundToggle.addEventListener('click', () => {
    ensureAudio();
    sfx.toggle();
  });

  function syncPanelAccessibility(panel, toggleBtn, isOpen) {
    if (panel) {
      panel.classList.toggle('open', isOpen);
      panel.setAttribute('aria-hidden', isOpen ? 'false' : 'true');
      panel.inert = !isOpen;
      panel.toggleAttribute('inert', !isOpen);
    }
    if (toggleBtn) {
      toggleBtn.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    }
  }

  // Playback Speed Toggle Handler (1x -> 2x -> 4x -> 1x)
  function formatPlaybackSpeedFromMultiplier(multiplier) {
    if (multiplier <= 0) {
      return '⚡ Speed: Instant';
    }
    const playbackSpeed = 1 / multiplier;
    const rounded = Number(playbackSpeed.toFixed(2));
    return `⚡ Speed: ${rounded}x`;
  }

  function updateSpeedToggleUI() {
    if (!elSpeedToggleBtn) return;
    if (queryTurnSpeedOverride !== null) {
      const matched = SPEED_PRESETS.find((p) => Math.abs(p.multiplier - queryTurnSpeedOverride) < 1e-6);
      if (matched) {
        elSpeedToggleBtn.textContent = matched.label;
        elSpeedToggleBtn.dataset.speed = matched.id;
        elSpeedToggleBtn.classList.toggle('active', matched.id !== '1x');
        return;
      }
      elSpeedToggleBtn.textContent = formatPlaybackSpeedFromMultiplier(queryTurnSpeedOverride);
      elSpeedToggleBtn.dataset.speed = queryTurnSpeedOverride <= 0 ? 'instant' : 'custom';
      elSpeedToggleBtn.classList.add('active');
      return;
    }
    const preset = SPEED_PRESETS.find((p) => p.id === currentSpeedPresetId) || SPEED_PRESETS[0];
    elSpeedToggleBtn.textContent = preset.label;
    elSpeedToggleBtn.dataset.speed = preset.id;
    elSpeedToggleBtn.classList.toggle('active', preset.id !== '1x');
  }

  function cyclePlaybackSpeed() {
    const idx = SPEED_PRESETS.findIndex((p) => p.id === currentSpeedPresetId);
    const nextPreset = SPEED_PRESETS[(idx + 1) % SPEED_PRESETS.length];
    // Explicitly selecting a speed preset replaces any active ?turnSpeed= URL or global override
    queryTurnSpeedOverride = null;
    if (typeof window.__POKER_TURN_SPEED__ !== 'undefined') {
      delete window.__POKER_TURN_SPEED__;
    }
    currentSpeedPresetId = nextPreset.id;
    try {
      if (window.localStorage) {
        window.localStorage.setItem(TURN_SPEED_STORAGE_KEY, currentSpeedPresetId);
      }
    } catch {
      // ignore storage errors
    }
    updateSpeedToggleUI();
  }

  if (elSpeedToggleBtn) {
    updateSpeedToggleUI();
    elSpeedToggleBtn.addEventListener('click', () => {
      ensureAudio();
      cyclePlaybackSpeed();
    });
  }

  if (elSkipPlaybackBtn) {
    elSkipPlaybackBtn.addEventListener('click', () => {
      ensureAudio();
      triggerSkipPlayback();
    });
  }

  // Hidable Table Pots Window Toggle
  function togglePotsWindow(forceOpen, options = {}) {
    if (!elPotsWindow) return;
    const wasOpen = elPotsWindow.classList.contains('open');
    const shouldOpen = typeof forceOpen === 'boolean' ? forceOpen : !wasOpen;
    const focusWasInside = Boolean(document.activeElement && elPotsWindow.contains(document.activeElement));
    const shouldRestoreFocus = !shouldOpen && (Boolean(options.restoreFocus && wasOpen) || focusWasInside);
    if (shouldRestoreFocus && elPotsToggleBtn) {
      elPotsToggleBtn.focus();
    }
    syncPanelAccessibility(elPotsWindow, elPotsToggleBtn, shouldOpen);
    if (elPotsToggleBtn) {
      elPotsToggleBtn.classList.toggle('active', shouldOpen);
    }
  }

  if (elPotsToggleBtn) {
    elPotsToggleBtn.addEventListener('click', () => togglePotsWindow(undefined, { restoreFocus: true }));
  }
  if (elPotsWindowClose) {
    elPotsWindowClose.addEventListener('click', () => togglePotsWindow(false, { restoreFocus: true }));
  }

  function isHandActiveStage(stage) {
    return stage === 'player_action' || stage === 'player_response';
  }

  function closeOpponentDialog() {
    pickerOpenedManually = false;
    if (elOppModalOverlay && elOppModalOverlay.open) {
      elOppModalOverlay.close();
    }
    if (elOppModalOverlay) {
      elOppModalOverlay.classList.remove('open');
    }
  }

  function openOpponentDialog(allowCancel) {
    if (!elOppModalOverlay) return;
    if (elBtnCancelOpps) {
      elBtnCancelOpps.hidden = !allowCancel;
    }
    elOppModalOverlay.classList.add('open');
    if (!elOppModalOverlay.open) {
      elOppModalOverlay.showModal();
    }
    const firstCard = elOppPickerGrid ? elOppPickerGrid.querySelector('.opponent-pick-card') : null;
    if (firstCard && typeof firstCard.focus === 'function') {
      firstCard.focus();
    }
  }

  // Open Opponent Picker Button (only between hands, never mid-hand or after cash out)
  if (elPickOpponentsBtn) {
    elPickOpponentsBtn.addEventListener('click', () => {
      if (isActionLocked) return;
      if (currentState && (isHandActiveStage(currentState.stage) || currentState.stage === 'game_over')) return;
      pickerOpenedManually = true;
      if (currentState) {
        renderOpponentPickerModal(currentState);
      }
    });
  }

  if (elOppModalOverlay) {
    elOppModalOverlay.addEventListener('cancel', (e) => {
      // Prevent closing with Escape when initial opponent selection is required
      if (!pickerOpenedManually && (!currentState || currentState.stage === 'select_opponents')) {
        e.preventDefault();
        return;
      }
      pickerOpenedManually = false;
      elOppModalOverlay.classList.remove('open');
    });
  }

  if (elBtnCancelOpps) {
    elBtnCancelOpps.addEventListener('click', () => {
      closeOpponentDialog();
      if (elPickOpponentsBtn) elPickOpponentsBtn.focus();
    });
  }

  // Opponent Picker Modal Handlers
  function updateOpponentPickerUI() {
    if (!elOppPickerGrid) return;
    elOppPickerGrid.querySelectorAll('.opponent-pick-card').forEach((card) => {
      const id = card.dataset.oppId;
      const idx = pickedOpponentIds.indexOf(id);
      const badge = card.querySelector('.pick-seat-badge');
      if (idx !== -1) {
        card.classList.add('selected');
        if (badge) badge.textContent = `SEAT ${idx + 1}`;
      } else {
        card.classList.remove('selected');
        if (badge) badge.textContent = '';
      }
    });

    if (elOppSelectCount) {
      elOppSelectCount.textContent = `${pickedOpponentIds.length} / 4 Selected`;
      elOppSelectCount.classList.toggle('ready', pickedOpponentIds.length === 4);
    }
    if (elBtnConfirmOpps) {
      elBtnConfirmOpps.disabled = pickedOpponentIds.length !== 4;
    }
  }

  function renderOpponentPickerModal(state) {
    if (!elOppModalOverlay || !elOppPickerGrid) return;
    const isMandatorySelection = state.stage === 'select_opponents';
    const shouldShow = isMandatorySelection || (pickerOpenedManually && !isHandActiveStage(state.stage));

    if (!shouldShow) {
      closeOpponentDialog();
      return;
    }

    if (!pickerBuilt && Array.isArray(state.availableOpponents)) {
      pickerBuilt = true;
      elOppPickerGrid.innerHTML = '';
      state.availableOpponents.forEach((profile) => {
        const art = CHARACTER_ART[profile.id] || CHARACTER_ART.reginald;
        const scopedPortrait = art.avatarSVG
          .replace(/id="([^"]+)"/g, 'id="pick_$1"')
          .replace(/url\(#([^)]+)\)/g, 'url(#pick_$1)');

        const card = document.createElement('button');
        card.type = 'button';
        card.className = 'opponent-pick-card';
        card.dataset.oppId = profile.id;
        card.innerHTML = `
          <span class="pick-seat-badge"></span>
          <div class="pick-portrait">${scopedPortrait}</div>
          <div class="pick-info">
            <div class="pick-title">${profile.title}</div>
            <div class="pick-name">${profile.emoji} ${profile.name}</div>
            <div class="pick-quote">"${profile.introLine}"</div>
          </div>
        `;
        card.addEventListener('click', () => {
          ensureAudio();
          const existingIdx = pickedOpponentIds.indexOf(profile.id);
          if (existingIdx !== -1) {
            pickedOpponentIds.splice(existingIdx, 1);
          } else if (pickedOpponentIds.length < 4) {
            pickedOpponentIds.push(profile.id);
          } else {
            pickedOpponentIds.shift();
            pickedOpponentIds.push(profile.id);
          }
          sfx.playChipSound();
          updateOpponentPickerUI();
        });
        elOppPickerGrid.appendChild(card);
      });
    }

    updateOpponentPickerUI();
    openOpponentDialog(!isMandatorySelection);
  }

  if (elBtnRandomOpps) {
    elBtnRandomOpps.addEventListener('click', () => {
      if (isActionLocked) return;
      pickedOpponentIds = [];
      pickerOpenedManually = false;
      sendAction('random_opponents');
    });
  }

  if (elBtnConfirmOpps) {
    elBtnConfirmOpps.addEventListener('click', () => {
      if (isActionLocked || pickedOpponentIds.length !== 4) return;
      const chosen = pickedOpponentIds.join(',');
      pickedOpponentIds = [];
      pickerOpenedManually = false;
      sendAction(`select_opponents:${chosen}`);
    });
  }

  // Render Hidable Table Pots & Stacks Window
  function renderPotsWindow(state, liveOverrides = null) {
    if (!elPotsWindowBody || !elPotsWindowTotal) return;
    const currentPot = liveOverrides && typeof liveOverrides.pot === 'number' ? liveOverrides.pot : state.pot;
    elPotsWindowTotal.textContent = `Pot: $${currentPot}`;

    const rows = [];
    (state.opponents || []).forEach((opp) => {
      const ov = liveOverrides && liveOverrides.opponents ? liveOverrides.opponents[opp.id] : null;
      const inPot = ov && typeof ov.handContribution === 'number' ? ov.handContribution : opp.handContribution || 0;
      const chips = ov && typeof ov.chips === 'number' ? ov.chips : opp.chips;
      const folded = ov && typeof ov.folded === 'boolean' ? ov.folded : opp.folded;
      const thinking = Boolean(ov && ov.thinking);
      const statusClass = thinking ? 'thinking' : folded ? 'folded' : 'active';

      const pos = opp.position || '';
      const posClass = pos ? `pos-${pos.toLowerCase()}` : '';
      const posPill = pos
        ? `<span class="pos-badge pos-badge-sm pots-pos-pill ${posClass}" title="${opp.positionLabel || pos}">${pos}</span>`
        : '';

      rows.push(`
        <div class="pots-row ${statusClass}">
          <span class="pots-player-name pots-player-cell">
            <span class="pots-status-dot ${statusClass}"></span>
            <span class="pots-player-label" title="${opp.shortName}">${opp.emoji} ${opp.shortName}</span>
            ${posPill}
          </span>
          <span class="pots-val in-pot">$${inPot}</span>
          <span class="pots-val won">$${opp.totalPotWon || 0}</span>
          <span class="pots-val stack">$${chips}</span>
        </div>
      `);
    });

    const playerInPot =
      liveOverrides && typeof liveOverrides.playerHandContribution === 'number'
        ? liveOverrides.playerHandContribution
        : state.playerHandContribution || 0;
    const playerChips =
      liveOverrides && typeof liveOverrides.playerChips === 'number' ? liveOverrides.playerChips : state.playerChips;
    const pPos = state.playerPosition || 'BTN';
    const pPosPill = `<span class="pos-badge pos-badge-sm pots-pos-pill pos-${pPos.toLowerCase()}" title="${state.playerPositionLabel || pPos}">${pPos}</span>`;

    rows.push(`
      <div class="pots-row is-you">
        <span class="pots-player-name pots-player-cell">
          <span class="pots-status-dot active"></span>
          <span class="pots-player-label" title="You">👤 You</span>
          ${pPosPill}
        </span>
        <span class="pots-val in-pot">$${playerInPot}</span>
        <span class="pots-val won">$${state.playerTotalPotWon || 0}</span>
        <span class="pots-val stack">$${playerChips}</span>
      </div>
    `);

    elPotsWindowBody.innerHTML = rows.join('');
  }

  function renderSessionSummary(state) {
    if (!elSessionSummaryPanel) return;
    if (!state || state.stage !== 'game_over') {
      elSessionSummaryPanel.hidden = true;
      return;
    }

    const summary = state.sessionSummary || {
      handsPlayed: state.handCount || 0,
      handsWon: state.playerHandsWon || 0,
      startingStack: 500,
      finalStack: state.playerChips || 0,
      rebuyCount: 0,
      rebuyChips: 0,
      totalBuyIn: 500,
      netProfit: (state.playerChips || 0) - 500,
    };

    elSessionSummaryPanel.hidden = false;

    if (elSummaryTotalBuyIn) {
      elSummaryTotalBuyIn.textContent = `Total Buy-In: $${summary.totalBuyIn}`;
    }
    if (elSummaryHandsPlayed) {
      elSummaryHandsPlayed.textContent = String(summary.handsPlayed);
    }
    if (elSummaryHandsWon) {
      elSummaryHandsWon.textContent = `${summary.handsWon} hand${summary.handsWon === 1 ? '' : 's'} won`;
    }
    if (elSummaryFinalStack) {
      elSummaryFinalStack.textContent = `$${summary.finalStack}`;
    }
    if (elSummaryStartingStack) {
      elSummaryStartingStack.textContent = `Started at $${summary.startingStack}`;
    }
    if (elSummaryRebuys) {
      elSummaryRebuys.textContent = `${summary.rebuyCount} ($${summary.rebuyChips})`;
    }
    if (elSummaryRebuysSub) {
      elSummaryRebuysSub.textContent =
        summary.rebuyCount > 0
          ? `${summary.rebuyCount} house rebuy${summary.rebuyCount === 1 ? '' : 's'} (+$${summary.rebuyChips})`
          : 'No rebuys taken';
    }
    if (elSummaryNetProfit) {
      const net = summary.netProfit;
      const netFormatted = net > 0 ? `+$${net}` : net < 0 ? `-$${Math.abs(net)}` : '$0';
      elSummaryNetProfit.textContent = netFormatted;
      elSummaryNetProfit.className = `summary-stat-value ${
        net > 0 ? 'net-positive' : net < 0 ? 'net-negative' : 'net-even'
      }`;
    }
    if (elSummaryNetSub) {
      elSummaryNetSub.textContent =
        summary.rebuyCount > 0
          ? `vs $${summary.totalBuyIn} total buy-in`
          : `vs $${summary.startingStack} starting stack`;
    }
  }

  // Log Drawer Handler
  function setHistoryDrawerOpen(shouldOpen, options = {}) {
    if (!elHistoryDrawer) return;
    const wasOpen = elHistoryDrawer.classList.contains('open');
    const focusWasInside = Boolean(document.activeElement && elHistoryDrawer.contains(document.activeElement));
    const shouldRestoreFocus = !shouldOpen && (Boolean(options.restoreFocus && wasOpen) || focusWasInside);
    if (shouldRestoreFocus && elLogToggleBtn) {
      elLogToggleBtn.focus();
    }
    syncPanelAccessibility(elHistoryDrawer, elLogToggleBtn, shouldOpen);
  }

  if (elLogToggleBtn) {
    elLogToggleBtn.addEventListener('click', () => {
      const shouldOpen = !Boolean(elHistoryDrawer && elHistoryDrawer.classList.contains('open'));
      setHistoryDrawerOpen(shouldOpen, { restoreFocus: true });
    });
  }
  if (elDrawerClose) {
    elDrawerClose.addEventListener('click', () => {
      setHistoryDrawerOpen(false, { restoreFocus: true });
    });
  }

  // Sync initial accessibility state for collapsible panels
  syncPanelAccessibility(elPotsWindow, elPotsToggleBtn, Boolean(elPotsWindow && elPotsWindow.classList.contains('open')));
  syncPanelAccessibility(elHistoryDrawer, elLogToggleBtn, Boolean(elHistoryDrawer && elHistoryDrawer.classList.contains('open')));

  // Mount the 4 dynamically chosen opponents into the 4 table seats
  function mountOpponentSeats(opponents) {
    const key = opponents.map((o) => `${o.seat}:${o.id}`).join('|');
    if (key === renderedRosterKey) return;
    renderedRosterKey = key;

    opponents.forEach((opp) => {
      const art = CHARACTER_ART[opp.id] || CHARACTER_ART.reginald;
      const seatEl = document.getElementById(`seat-${opp.seat}`);
      const feltEl = document.getElementById(`felt-${opp.seat}`);
      const pos = opp.position || '';
      const posClass = pos ? `pos-${pos.toLowerCase()}` : '';

      if (seatEl) {
        seatEl.dataset.oppId = opp.id;
        seatEl.innerHTML = `
          <div class="seat-overhead-stack">
            <div class="character-nameplate opp-nameplate" data-opp-id="${opp.id}">
              <div class="nameplate-header-row">
                <span class="pos-badge ${posClass}" id="opp-pos-${opp.id}" title="${opp.positionLabel || pos}">${pos}</span>
                <span class="badge-role">${opp.title || 'VIP'}</span>
              </div>
              <div>${opp.emoji} ${opp.name}</div>
              <div class="chip-count-tag" id="opp-chip-tag-${opp.id}">$${opp.chips}</div>
              <div class="opp-action-badge" id="opp-action-${opp.id}"></div>
            </div>
            <div class="speech-bubble-slot">
              <div class="speech-bubble opponent-bubble" id="opp-bubble-${opp.id}">
                <span class="speech-text" id="opp-bubble-text-${opp.id}"></span>
              </div>
            </div>
          </div>
          <div class="seated-character-wrapper">
            <div class="casino-chair opponent-chair">${art.chairSVG}</div>
            <div class="avatar opponent-avatar" id="opp-avatar-${opp.id}">${art.avatarSVG}</div>
          </div>
        `;
      }

      if (feltEl) {
        const cardsHTML = `
          <div class="opp-cards-on-table" id="opp-cards-container-${opp.id}">
            ${renderCardBackHTML()}
            ${renderCardBackHTML()}
          </div>
        `;
        const chipsHTML = `<div class="chips-stack-visual" id="opp-chips-visual-${opp.id}"></div>`;
        feltEl.innerHTML = opp.seat === 'far-right' ? `${chipsHTML}${cardsHTML}` : `${cardsHTML}${chipsHTML}`;
      }
    });
  }

  function findSeatContainerByOppId(id) {
    return document.querySelector(`.character-container[data-opp-id="${id}"]`);
  }

  function findNameplateByOppId(id) {
    return document.querySelector(`.character-nameplate[data-opp-id="${id}"]`);
  }

  // Chips Visual Renderer
  function renderChipsVisual(container, amount) {
    if (!container) return;
    container.innerHTML = '';
    if (amount <= 0) return;

    let remaining = amount;
    const chipStack = document.createElement('div');
    chipStack.className = 'chip-stack';

    const numGold = Math.floor(remaining / 100);
    remaining %= 100;
    const numBlue = Math.floor(remaining / 25);
    remaining %= 25;
    const numRed = Math.floor(remaining / 5);

    const maxChips = 10;
    let count = 0;
    for (let i = 0; i < numRed && count < maxChips; i++, count++) {
      const c = document.createElement('div');
      c.className = 'poker-chip chip-red';
      chipStack.appendChild(c);
    }
    for (let i = 0; i < numBlue && count < maxChips; i++, count++) {
      const c = document.createElement('div');
      c.className = 'poker-chip chip-blue';
      chipStack.appendChild(c);
    }
    for (let i = 0; i < numGold && count < maxChips; i++, count++) {
      const c = document.createElement('div');
      c.className = 'poker-chip chip-gold';
      chipStack.appendChild(c);
    }

    container.appendChild(chipStack);
  }

  function getActionBadgeClass(actionText) {
    if (!actionText) return '';
    const lower = actionText.toLowerCase();
    if (lower.includes('fold')) return 'badge-fold';
    if (lower.includes('win')) return 'badge-win';
    if (lower.includes('bet') || lower.includes('raise')) return 'badge-bet';
    if (lower.includes('call')) return 'badge-call';
    if (lower.includes('tie')) return 'badge-bet';
    return 'badge-check';
  }

  // Render Individual Opponent Seat
  function renderOpponent(opp) {
    const elContainer = findSeatContainerByOppId(opp.id);
    const elNameplate = findNameplateByOppId(opp.id);
    const elBubble = document.getElementById(`opp-bubble-${opp.id}`);
    const elBubbleText = document.getElementById(`opp-bubble-text-${opp.id}`);
    const elAvatar = document.getElementById(`opp-avatar-${opp.id}`);
    const elChipTag = document.getElementById(`opp-chip-tag-${opp.id}`);
    const elPosBadge = document.getElementById(`opp-pos-${opp.id}`);
    const elActionBadge = document.getElementById(`opp-action-${opp.id}`);
    const elChipsVisual = document.getElementById(`opp-chips-visual-${opp.id}`);
    const elCardsContainer = document.getElementById(`opp-cards-container-${opp.id}`);

    if (elPosBadge && opp.position) {
      elPosBadge.textContent = opp.position;
      elPosBadge.title = opp.positionLabel || opp.position;
      elPosBadge.className = `pos-badge pos-${opp.position.toLowerCase()}`;
    }

    if (elContainer) {
      elContainer.classList.remove('is-thinking');
      elContainer.classList.toggle('folded', Boolean(opp.folded));
    }
    if (elNameplate) {
      elNameplate.classList.remove('is-thinking');
      elNameplate.classList.toggle('folded', Boolean(opp.folded));
    }

    if (elBubble && elBubbleText) {
      elBubble.classList.remove('thinking');
      if (opp.speech) {
        elBubbleText.textContent = opp.speech;
        elBubble.classList.add('active');
      } else {
        elBubbleText.textContent = '';
        elBubble.classList.remove('active');
      }
    }

    if (elAvatar) {
      elAvatar.className = `avatar opponent-avatar ${opp.reaction || 'neutral'}`;
    }

    if (elChipTag) {
      elChipTag.textContent = `$${opp.chips}`;
    }

    if (elActionBadge) {
      if (opp.lastAction) {
        elActionBadge.textContent = opp.lastAction;
        elActionBadge.className = `opp-action-badge visible ${getActionBadgeClass(opp.lastAction)}`;
      } else {
        elActionBadge.textContent = '';
        elActionBadge.className = 'opp-action-badge';
      }
    }

    renderChipsVisual(elChipsVisual, opp.chips);

    if (elCardsContainer) {
      elCardsContainer.classList.toggle('folded', Boolean(opp.folded));
      if (opp.cardsHidden || !opp.cards || opp.cards.length < 2) {
        elCardsContainer.innerHTML = `
          ${renderCardBackHTML()}
          ${renderCardBackHTML()}
        `;
      } else {
        const winningBestFiveSet = new Set(
          currentState && currentState.outcome && Array.isArray(currentState.outcome.winningBestFiveCards)
            ? currentState.outcome.winningBestFiveCards
            : [],
        );
        const oppBestFiveSet = new Set(Array.isArray(opp.bestFiveCards) ? opp.bestFiveCards : []);
        const highlightSet = winningBestFiveSet.size > 0 ? winningBestFiveSet : oppBestFiveSet;
        elCardsContainer.innerHTML = `
          ${renderCardHTML(opp.cards[0], highlightSet.has(opp.cards[0].str))}
          ${renderCardHTML(opp.cards[1], highlightSet.has(opp.cards[1].str))}
        `;
      }
    }
  }

  function setOpponentThinking(event) {
    const id = event.opponentId;
    const elContainer = findSeatContainerByOppId(id);
    const elNameplate = findNameplateByOppId(id);
    const elBubble = document.getElementById(`opp-bubble-${id}`);
    const elBubbleText = document.getElementById(`opp-bubble-text-${id}`);
    const elAvatar = document.getElementById(`opp-avatar-${id}`);
    const elActionBadge = document.getElementById(`opp-action-${id}`);

    if (elContainer) elContainer.classList.add('is-thinking');
    if (elNameplate) elNameplate.classList.add('is-thinking');
    if (elAvatar) elAvatar.className = 'avatar opponent-avatar thinking';

    if (elBubble && elBubbleText) {
      elBubbleText.textContent = event.thinkingSpeech || 'Thinking...';
      elBubble.classList.add('active', 'thinking');
    }
    if (elActionBadge) {
      elActionBadge.textContent = 'Thinking...';
      elActionBadge.className = 'opp-action-badge visible badge-thinking';
    }

    elDealerBubbleText.textContent = `Action is on ${event.opponentName}...`;
    elDealerBubble.classList.add('active');
    elSpeakerName.textContent = event.shortName.toUpperCase();
    elSpeakerThumb.textContent = SPEAKER_ICONS[event.shortName] || '🎰';
    elDialogueMainText.textContent = `${event.opponentName} is thinking... "${event.thinkingSpeech}"`;
  }

  function applyOpponentDecision(event, options = {}) {
    const id = event.opponentId;
    const elContainer = findSeatContainerByOppId(id);
    const elNameplate = findNameplateByOppId(id);
    const elBubble = document.getElementById(`opp-bubble-${id}`);
    const elBubbleText = document.getElementById(`opp-bubble-text-${id}`);
    const elAvatar = document.getElementById(`opp-avatar-${id}`);
    const elActionBadge = document.getElementById(`opp-action-${id}`);
    const elChipTag = document.getElementById(`opp-chip-tag-${id}`);
    const elChipsVisual = document.getElementById(`opp-chips-visual-${id}`);
    const elCardsContainer = document.getElementById(`opp-cards-container-${id}`);

    if (elContainer) {
      elContainer.classList.remove('is-thinking');
      elContainer.classList.toggle('folded', Boolean(event.folded));
    }
    if (elNameplate) {
      elNameplate.classList.remove('is-thinking');
      elNameplate.classList.toggle('folded', Boolean(event.folded));
    }
    if (elAvatar) {
      elAvatar.className = `avatar opponent-avatar ${event.reaction || 'neutral'}`;
    }

    if (elBubble && elBubbleText) {
      elBubble.classList.remove('thinking');
      elBubbleText.textContent = event.decisionSpeech;
      elBubble.classList.add('active');
    }
    if (elActionBadge) {
      elActionBadge.textContent = event.actionBadge;
      elActionBadge.className = `opp-action-badge visible ${getActionBadgeClass(event.actionBadge)}`;
    }
    if (elChipTag) {
      elChipTag.textContent = `$${event.chipsAfter}`;
    }
    renderChipsVisual(elChipsVisual, event.chipsAfter);
    if (elCardsContainer) {
      elCardsContainer.classList.toggle('folded', Boolean(event.folded));
      if (event.folded && Array.isArray(event.revealedCards) && event.revealedCards.length >= 2) {
        elCardsContainer.innerHTML = `
          ${renderCardHTML(event.revealedCards[0])}
          ${renderCardHTML(event.revealedCards[1])}
        `;
      }
    }

    elPotAmount.textContent = `$${event.potAfter}`;
    renderChipsVisual(elPotChipsVisual, event.potAfter);

    elSpeakerName.textContent = event.shortName.toUpperCase();
    elSpeakerThumb.textContent = SPEAKER_ICONS[event.shortName] || '🎰';
    elDialogueMainText.textContent = `${event.opponentName}: "${event.decisionSpeech}" (${event.actionBadge})`;

    if (!options.suppressSfx) {
      if (event.action === 'bet' || event.action === 'call') {
        sfx.playChipSound();
      } else if (event.action === 'check') {
        sfx.playKnock();
      } else if (event.action === 'fold') {
        sfx.playCardDeal();
      }
    }
  }

  function lockActionsDuringTurns(message) {
    activeHotkeys = {};
    elActionPromptTitle.textContent = message;
    elActionButtonsGroup.querySelectorAll('button').forEach((btn) => {
      btn.disabled = true;
    });
    if (elPickOpponentsBtn) elPickOpponentsBtn.disabled = true;
    if (elBtnRandomOpps) elBtnRandomOpps.disabled = true;
    if (elBtnConfirmOpps) elBtnConfirmOpps.disabled = true;
  }

  const BUTTON_SEAT_CLASSES = [
    'btn-at-player',
    'btn-at-far-left',
    'btn-at-top-left',
    'btn-at-top-right',
    'btn-at-far-right',
  ];

  function renderTablePositions(state) {
    const pPos = state.playerPosition || 'BTN';
    const pLabel = state.playerPositionLabel || pPos;
    if (elStatPosition) {
      elStatPosition.textContent = pPos;
    }
    if (elPlayerPositionBadge) {
      elPlayerPositionBadge.textContent = `${pPos} • ${pLabel}`;
      elPlayerPositionBadge.title = pLabel;
      elPlayerPositionBadge.className = `pos-badge pos-${pPos.toLowerCase()}`;
    }
    if (elDealerButton && typeof state.buttonSeatIndex === 'number') {
      const seatClass = BUTTON_SEAT_CLASSES[state.buttonSeatIndex] || 'btn-at-player';
      elDealerButton.className = `dealer-button ${seatClass}`;
      elDealerButton.title = `Dealer Button (Seat ${state.buttonSeatIndex === 0 ? 'You' : state.buttonSeatIndex})`;
    }
    (state.opponents || []).forEach((opp) => {
      const elPosBadge = document.getElementById(`opp-pos-${opp.id}`);
      if (elPosBadge && opp.position) {
        elPosBadge.textContent = opp.position;
        elPosBadge.title = opp.positionLabel || opp.position;
        elPosBadge.className = `pos-badge pos-${opp.position.toLowerCase()}`;
      }
    });
  }

  async function playTurnSequenceAndRender(nextState, playerAction) {
    if (Array.isArray(nextState.opponents)) {
      mountOpponentSeats(nextState.opponents);
    }
    renderTablePositions(nextState);

    const events = nextState.turnEvents;
    if (!Array.isArray(events) || events.length === 0) {
      isPlayingTurns = false;
      skipCurrentPlayback = false;
      if (elSkipPlaybackBtn) elSkipPlaybackBtn.hidden = true;
      isActionLocked = false;
      renderState(nextState);
      return;
    }

    // Close picker modal immediately if opening a hand triggered pre-flop UTG/CO turns
    if (nextState.stage !== 'select_opponents') {
      closeOpponentDialog();
    }

    isPlayingTurns = true;
    skipCurrentPlayback = false;
    skipPlaybackHadFocus = false;
    lockActionsDuringTurns('Opponents are making their decisions...');
    if (elSkipPlaybackBtn) {
      elSkipPlaybackBtn.hidden = false;
      elSkipPlaybackBtn.disabled = false;
    }

    // If a new hand just started (e.g. clicking Easy or Play Again), clear old bubbles/board & deal player cards right away
    const isNewHandStart = !currentState || nextState.handCount !== currentState.handCount;
    if (isNewHandStart) {
      document.querySelectorAll('.opponent-bubble').forEach((b) => b.classList.remove('active', 'thinking'));
      elHandCount.textContent = nextState.handCount || 1;
      elDifficulty.textContent = nextState.mode ? nextState.mode.toUpperCase() : 'Selecting';
      elStreetBanner.textContent = 'PRE-FLOP';
      elHudStreetStatus.textContent = 'Street: Pre-flop';
      elHudStreetStatus.style.color = '';
      for (let i = 0; i < 5; i++) {
        const slot = document.getElementById(`slot-${i}`);
        if (slot) {
          const labels = ['FLOP 1', 'FLOP 2', 'FLOP 3', 'TURN', 'RIVER'];
          slot.innerHTML = `<span class="slot-label">${labels[i]}</span>`;
        }
      }
      if (nextState.playerCards && nextState.playerCards.length >= 2) {
        elPlayerCardsContainer.innerHTML = `
          ${renderCardHTML(nextState.playerCards[0])}
          ${renderCardHTML(nextState.playerCards[1])}
        `;
      }
      (nextState.opponents || []).forEach((opp) => {
        const elCards = document.getElementById(`opp-cards-container-${opp.id}`);
        if (elCards) {
          elCards.classList.remove('folded');
          elCards.innerHTML = `
            ${renderCardBackHTML()}
            ${renderCardBackHTML()}
          `;
        }
      });
    }

    const startPot = typeof nextState.turnStartPot === 'number' ? nextState.turnStartPot : nextState.pot;
    const livePots = {
      pot: startPot,
      playerChips:
        typeof nextState.turnStartPlayerChips === 'number'
          ? nextState.turnStartPlayerChips
          : nextState.playerChips,
      playerHandContribution:
        typeof nextState.turnStartPlayerContribution === 'number'
          ? nextState.turnStartPlayerContribution
          : nextState.playerHandContribution || 0,
      opponents: {},
    };
    const snapOpps = nextState.turnStartOpponents || {};
    (nextState.opponents || []).forEach((opp) => {
      const snap = snapOpps[opp.id];
      livePots.opponents[opp.id] = {
        chips: snap ? snap.chips : opp.chips,
        handContribution: snap ? snap.handContribution : opp.handContribution || 0,
        folded: snap ? snap.folded : opp.folded,
        thinking: false,
      };
      const elChipTag = document.getElementById(`opp-chip-tag-${opp.id}`);
      if (elChipTag) elChipTag.textContent = `$${livePots.opponents[opp.id].chips}`;
    });

    elPlayerChipTag.textContent = `Your Stack: $${livePots.playerChips}`;
    renderChipsVisual(elPlayerChipsVisual, livePots.playerChips);
    elPotAmount.textContent = `$${startPot}`;
    renderChipsVisual(elPotChipsVisual, startPot);

    if (playerAction === 'bet' || playerAction === 'call') {
      sfx.playChipSound();
      elSpeakerName.textContent = 'YOU';
      elSpeakerThumb.textContent = SPEAKER_ICONS.You;
      elDialogueMainText.textContent =
        playerAction === 'call' ? 'You call. Waiting on the table...' : 'You raise the stakes. Waiting on the table...';
    } else if (playerAction === 'check') {
      sfx.playKnock();
      elSpeakerName.textContent = 'YOU';
      elSpeakerThumb.textContent = SPEAKER_ICONS.You;
      elDialogueMainText.textContent = 'You check. Waiting on the table...';
    } else if (isNewHandStart) {
      sfx.playCardDeal();
      elSpeakerName.textContent = 'DEALER';
      elSpeakerThumb.textContent = SPEAKER_ICONS.Dealer;
      elDialogueMainText.textContent = `Hand #${nextState.handCount} (You: ${nextState.playerPosition}). Blinds posted ($${nextState.smallBlind}/$${nextState.bigBlind}).`;
    }
    renderPotsWindow(nextState, livePots);

    await delay(350);

    let lastRenderedStreet = isNewHandStart
      ? 'Pre-flop'
      : currentState && currentState.streetName
        ? currentState.streetName
        : 'Pre-flop';

    for (const event of events) {
      if (event.streetName && lastRenderedStreet && event.streetName !== lastRenderedStreet) {
        lastRenderedStreet = event.streetName;
        // Clear old opponent speech bubbles for the new runout street
        document.querySelectorAll('.opponent-bubble').forEach((b) => {
          b.classList.remove('active', 'thinking');
        });
        elStreetBanner.textContent = event.streetName.toUpperCase();
        elHudStreetStatus.textContent = `Street: ${event.streetName}`;
        if (Array.isArray(event.boardSnapshot)) {
          for (let i = 0; i < 5; i++) {
            const slot = document.getElementById(`slot-${i}`);
            const cardData = event.boardSnapshot[i];
            if (slot && cardData) {
              slot.innerHTML = renderCardHTML(cardData);
            }
          }
          if (!skipCurrentPlayback) {
            sfx.playCardFlip();
          }
        }
        elDealerBubbleText.textContent = `${event.streetName} dealt! Opponents contest the side pot...`;
        elDealerBubble.classList.add('active');
        elSpeakerName.textContent = 'DEALER';
        elSpeakerThumb.textContent = SPEAKER_ICONS.Dealer;
        elDialogueMainText.textContent = `${event.streetName} dealt — remaining opponents play for the side pot.`;
        await delay(450);
      }

      setOpponentThinking(event);
      if (livePots.opponents[event.opponentId]) {
        livePots.opponents[event.opponentId].thinking = true;
        if (currentState) renderPotsWindow(currentState, livePots);
      }

      const thinkDurationMs = 1100 + Math.floor(Math.random() * 800); // 1.1s - 1.9s
      await delay(thinkDurationMs);

      applyOpponentDecision(event, { suppressSfx: skipCurrentPlayback });
      livePots.pot = event.potAfter;
      livePots.opponents[event.opponentId] = {
        chips: event.chipsAfter,
        handContribution: event.handContributionAfter,
        folded: event.folded,
        thinking: false,
      };
      if (currentState) renderPotsWindow(currentState, livePots);

      await delay(650);
    }

    const wasSkipped = skipCurrentPlayback;
    const shouldMoveFocusToAction =
      skipPlaybackHadFocus ||
      Boolean(
        elSkipPlaybackBtn &&
          (document.activeElement === elSkipPlaybackBtn || elSkipPlaybackBtn.contains(document.activeElement)),
      );
    isPlayingTurns = false;
    skipCurrentPlayback = false;
    skipPlaybackHadFocus = false;
    if (elSkipPlaybackBtn) {
      elSkipPlaybackBtn.hidden = true;
    }
    isActionLocked = false;
    renderState(nextState, { skipActionSfx: true, skipBoardFlipSfx: wasSkipped });
    if (shouldMoveFocusToAction && elActionButtonsGroup) {
      const firstActionBtn = elActionButtonsGroup.querySelector('button:not(:disabled)');
      if (firstActionBtn && typeof firstActionBtn.focus === 'function') {
        firstActionBtn.focus();
      }
    }
  }

  // Render Game State
  function renderState(state, options = {}) {
    const prevState = currentState;
    currentState = state;

    if (elPickOpponentsBtn) {
      const pickerDisabled = isHandActiveStage(state.stage) || state.stage === 'game_over';
      elPickOpponentsBtn.disabled = pickerDisabled;
      elPickOpponentsBtn.title =
        state.stage === 'game_over'
          ? 'Start a new session to select opponents'
          : isHandActiveStage(state.stage)
            ? 'Finish or fold the current hand to change opponents'
            : 'Choose 4 opponents from the 8 VIP characters';
    }
    if (elBtnRandomOpps) elBtnRandomOpps.disabled = false;

    // Opponent Selection Modal (shown when stage === 'select_opponents')
    renderOpponentPickerModal(state);

    // Stats
    elHandCount.textContent = state.handCount || 1;
    elDifficulty.textContent = state.mode ? state.mode.toUpperCase() : 'Selecting';

    // Dealer Speech
    if (state.dealerSpeech) {
      elDealerBubbleText.textContent = state.dealerSpeech;
      elDealerBubble.classList.add('active');
    } else {
      elDealerBubble.classList.remove('active');
    }

    // Mount & Render All 4 Seated Opponents + Table Positions
    if (Array.isArray(state.opponents)) {
      mountOpponentSeats(state.opponents);
      state.opponents.forEach(renderOpponent);
    }
    renderTablePositions(state);

    // Update Hidable Table Pots Window
    renderPotsWindow(state);

    // Update Cash Out Session Summary Panel
    renderSessionSummary(state);

    // Pot & Street
    elPotAmount.textContent = `$${state.pot}`;
    renderChipsVisual(elPotChipsVisual, state.pot);
    elStreetBanner.textContent = state.stage === 'game_over' ? 'CASHED OUT' : state.streetName.toUpperCase();
    if (state.stage === 'game_over') {
      elHudStreetStatus.textContent = 'Session Complete • Cash Out Summary';
      elHudStreetStatus.style.color = '#ffd700';
    } else if (state.outcome) {
      if (state.outcome.result === 'win') {
        elHudStreetStatus.textContent = 'Result: You Won the Hand!';
        elHudStreetStatus.style.color = '#34d399';
      } else if (state.outcome.result === 'mixed') {
        const payoutText =
          typeof state.outcome.playerPayout === 'number' && state.outcome.playerPayout > 0
            ? ` (You Won $${state.outcome.playerPayout})`
            : '';
        elHudStreetStatus.textContent = `Result: Mixed Pot Split${payoutText}`;
        elHudStreetStatus.style.color = '#fbbf24';
      } else if (state.outcome.result === 'loss' || state.outcome.result === 'fold') {
        const winners = state.outcome.winnerNames && state.outcome.winnerNames.length
          ? state.outcome.winnerNames.join(' & ')
          : 'Table';
        elHudStreetStatus.textContent = `Result: ${winners} Won`;
        elHudStreetStatus.style.color = '#f87171';
      } else if (state.outcome.result === 'tie') {
        elHudStreetStatus.textContent = 'Result: Split Pot (Tie)';
        elHudStreetStatus.style.color = '#fbbf24';
      }
    } else {
      elHudStreetStatus.textContent = `Street: ${state.streetName}`;
      elHudStreetStatus.style.color = '';
    }

    // Best-Five Highlighting at Showdown (always highlight the coherent 5-card winning hand across board + hole cards)
    const winningBestFiveSet = new Set(
      state.outcome && Array.isArray(state.outcome.winningBestFiveCards)
        ? state.outcome.winningBestFiveCards
        : state.outcome && Array.isArray(state.outcome.bestFiveCards)
          ? state.outcome.bestFiveCards
          : [],
    );

    // Community Cards (5 slots)
    for (let i = 0; i < 5; i++) {
      const slot = document.getElementById(`slot-${i}`);
      const cardData = state.board[i];
      if (cardData) {
        slot.innerHTML = renderCardHTML(cardData, winningBestFiveSet.has(cardData.str));
      } else {
        const labels = ['FLOP 1', 'FLOP 2', 'FLOP 3', 'TURN', 'RIVER'];
        slot.innerHTML = `<span class="slot-label">${labels[i]}</span>`;
      }
    }

    // Player Cards & Chips
    elPlayerChipTag.textContent = `Your Stack: $${state.playerChips}`;
    renderChipsVisual(elPlayerChipsVisual, state.playerChips);

    if (state.playerCards && state.playerCards.length >= 2) {
      elPlayerCardsContainer.innerHTML = `
        ${renderCardHTML(state.playerCards[0], winningBestFiveSet.has(state.playerCards[0].str))}
        ${renderCardHTML(state.playerCards[1], winningBestFiveSet.has(state.playerCards[1].str))}
      `;
    } else {
      elPlayerCardsContainer.innerHTML = `
        <div class="card card-placeholder" id="player-card-1" aria-hidden="true"></div>
        <div class="card card-placeholder" id="player-card-2" aria-hidden="true"></div>
      `;
    }
    if (state.playerCurrentRank) {
      const detail =
        state.outcome && state.outcome.result === 'win' && state.outcome.equalCategoryDetail
          ? ` (${state.outcome.equalCategoryDetail})`
          : '';
      elPlayerHandRank.textContent = `Your Hand: ${state.playerCurrentRank}${detail}`;
    } else {
      elPlayerHandRank.textContent = 'Texas Hold’em';
    }

    // Dialogue Narration Panel
    const lastNarrative = state.narrative && state.narrative.length > 0 ? state.narrative[state.narrative.length - 1] : null;
    if (lastNarrative) {
      elDialogueMainText.textContent = lastNarrative.text;
      elSpeakerName.textContent = lastNarrative.speaker.toUpperCase();
      elSpeakerThumb.textContent = SPEAKER_ICONS[lastNarrative.speaker] || '🎰';
    }

    // Log History Drawer
    elDrawerContent.innerHTML = '';
    (state.narrative || []).forEach((entry) => {
      const row = document.createElement('div');
      row.className = 'log-entry';
      const safeClass = entry.speaker.replace(/[^a-zA-Z0-9_-]/g, '');
      row.innerHTML = `<span class="log-speaker ${safeClass}">[${entry.speaker}]</span> <span class="log-text">${entry.text}</span>`;
      elDrawerContent.appendChild(row);
    });
    elDrawerContent.scrollTop = elDrawerContent.scrollHeight;

    // Render Action Prompt Buttons
    renderActions(state.prompt);

    // Audio SFX cues on state transitions
    if (!options.skipActionSfx && prevState && state.lastAction) {
      if (state.lastAction.action === 'check') {
        sfx.playKnock();
      } else if (state.lastAction.action === 'bet' || state.lastAction.action === 'call') {
        sfx.playChipSound();
      }
    }

    if (!options.skipBoardFlipSfx && prevState && state.board.length > prevState.board.length) {
      sfx.playCardFlip();
    }

    if (state.outcome && (!prevState || !prevState.outcome)) {
      if (state.outcome.result === 'win') {
        sfx.playWin();
      } else if (state.outcome.result === 'mixed') {
        sfx.playChipSound();
      } else if (state.outcome.result === 'loss' || state.outcome.result === 'fold') {
        sfx.playDefeat();
      }
    }
  }

  // Render Action Buttons
  function renderActions(prompt) {
    elActionButtonsGroup.innerHTML = '';
    activeHotkeys = {};
    if (elSkipPlaybackBtn && !isPlayingTurns) {
      elSkipPlaybackBtn.hidden = true;
    }

    if (!prompt || !prompt.choices || prompt.choices.length === 0) {
      elActionPromptTitle.textContent = 'Waiting...';
      return;
    }

    elActionPromptTitle.textContent = prompt.message;

    prompt.choices.forEach((choice) => {
      const btn = document.createElement('button');
      btn.className = `game-btn btn-${choice.variant || 'default'}`;
      btn.dataset.choiceId = choice.id;
      btn.innerHTML = `
        <span>${choice.label}</span>
        <span class="hotkey-pill">${choice.key}</span>
      `;
      btn.addEventListener('click', () => {
        sendAction(choice.id);
      });

      elActionButtonsGroup.appendChild(btn);

      const keyNorm = choice.key.toLowerCase();
      activeHotkeys[keyNorm] = choice.id;
      if (keyNorm === 'space') {
        activeHotkeys[' '] = choice.id;
      }
    });
  }

  // Send Player Action to Server (locked synchronously BEFORE fetch starts, with stateRevision guard!)
  async function sendAction(action) {
    if (isActionLocked) return;
    isActionLocked = true;
    lockActionsDuringTurns('Submitting action...');
    ensureAudio();

    try {
      const payload = { action };
      if (currentState && typeof currentState.stateRevision === 'number') {
        payload.stateRevision = currentState.stateRevision;
      }
      if (currentState && typeof currentState.tableInstanceId === 'string') {
        payload.tableInstanceId = currentState.tableInstanceId;
      }
      const res = await fetch('/api/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (res.status === 409 && data && data.code === 'STALE_STATE') {
        const freshState = data.state || (await (await fetch('/api/state')).json());
        isActionLocked = false;
        renderState(freshState, { skipActionSfx: true });
        if (elDialogueMainText) {
          elDialogueMainText.textContent = 'Table updated or restarted — refreshed to latest state.';
        }
        return;
      }
      if (!res.ok || data.error) {
        console.error('Action error:', data.error || res.status);
        if (currentState) renderState(currentState, { skipActionSfx: true });
        return;
      }
      await playTurnSequenceAndRender(data, action);
    } catch (err) {
      console.error('Failed to send action:', err);
      if (currentState) renderState(currentState, { skipActionSfx: true });
    } finally {
      isActionLocked = false;
    }
  }

  function isInteractiveFocusedElement(el) {
    if (!el || !(el instanceof HTMLElement)) return false;
    const tag = el.tagName;
    if (tag === 'BUTTON' || tag === 'A' || tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') {
      return true;
    }
    return el.getAttribute('role') === 'button';
  }

  // Global Keyboard Navigation
  window.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const key = e.key.toLowerCase();
    const dialogOpen = Boolean(elOppModalOverlay && elOppModalOverlay.open);

    if (key === 'm') {
      sfx.toggle();
      return;
    }

    if (dialogOpen) {
      // Support README 'R' shortcut for Random 4 Opponents while the opponent picker dialog is open
      if (key === 'r' && !isActionLocked && elBtnRandomOpps && !elBtnRandomOpps.disabled) {
        e.preventDefault();
        elBtnRandomOpps.click();
      }
      return;
    }

    if (key === 'escape') {
      if (elHistoryDrawer && elHistoryDrawer.classList.contains('open') && elHistoryDrawer.contains(document.activeElement)) {
        e.preventDefault();
        setHistoryDrawerOpen(false, { restoreFocus: true });
        return;
      }
      if (elPotsWindow && elPotsWindow.classList.contains('open') && elPotsWindow.contains(document.activeElement)) {
        e.preventDefault();
        togglePotsWindow(false, { restoreFocus: true });
        return;
      }
    }

    // Preserve native Space / Enter activation when a button or interactive element has keyboard focus
    if ((key === ' ' || key === 'enter') && isInteractiveFocusedElement(document.activeElement)) {
      return;
    }

    if (key === 'p') {
      togglePotsWindow(undefined, { restoreFocus: true });
      return;
    }
    if (key === 's' && isPlayingTurns) {
      e.preventDefault();
      triggerSkipPlayback();
      return;
    }
    if (isActionLocked) return;
    if (activeHotkeys[key]) {
      e.preventDefault();
      sendAction(activeHotkeys[key]);
    }
  });

  // Dynamically fit the 3D table scene against BOTH available viewport width and height
  // (prevents clipping on narrow portrait phones AND short landscape viewports like 844x390)
  const elPovViewport = document.querySelector('.pov-viewport');
  const elTableScene = document.querySelector('.table-scene');

  function fitTableScene() {
    if (!elPovViewport || !elTableScene) return;
    const vpRect = elPovViewport.getBoundingClientRect();
    if (vpRect.width <= 0 || vpRect.height <= 0) return;

    const availW = Math.max(200, vpRect.width - 12);
    const availH = Math.max(120, vpRect.height - 12);
    // Projected 3D table spans ~1115px wide; overhead stack (name+stack card + speech bubble above dealer at -230px)
    // to table rail bottom (+450px) spans ~690px tall so chat bubbles & nameplates are NEVER cut off by top-nav!
    const scaleX = availW / 1140;
    const scaleY = availH / 700;
    const scale = Math.max(0.20, Math.min(1, scaleX, scaleY));

    // Shift downward proportionally so overhead nameplate + speech bubble above Dealer/Top seats stay well below top-nav
    const marginTop = Math.round(180 * scale);
    elTableScene.style.transform = `scale(${scale.toFixed(4)})`;
    elTableScene.style.marginTop = `${marginTop}px`;
  }

  window.addEventListener('resize', fitTableScene);
  if (typeof ResizeObserver === 'function' && elPovViewport) {
    const ro = new ResizeObserver(() => fitTableScene());
    ro.observe(elPovViewport);
  }
  fitTableScene();

  // Fetch Initial State on Load
  async function fetchInitialState() {
    try {
      const res = await fetch('/api/state');
      const data = await res.json();
      renderState(data);
      fitTableScene();
      sfx.playCardDeal();
    } catch (err) {
      console.error('Failed to load initial state:', err);
    }
  }

  fetchInitialState();
})();
