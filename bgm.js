const BGM = {
    audioContext: null,
    masterGain: null,
    isPlaying: false,
    oscillators: [],
    intervals: [],
    sources: [],
    scareAudioElements: [],
    scareTimeout: null,

    // 追逐背景音状态
    chaseHtml: null,
    chaseSrc: null,
    chasePlaying: false,

    // 吓人音效文件列表
    scareSounds: [
        'scare_1.mp3',
        'scare_2.mp3',
        'scare_3.mp3'
    ],

    // 交互/切换场景音效
    switchSounds: [
        'click_sound.mp3',
        'switch_scare.mp3'
    ],

    init() {
        this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
        this.masterGain = this.audioContext.createGain();
        this.masterGain.gain.value = 0.36;
        this.volume = 0.36;
        this.masterGain.connect(this.audioContext.destination);
    },

    createOscillator(frequency, type, volume, detune = 0) {
        const osc = this.audioContext.createOscillator();
        const gain = this.audioContext.createGain();
        
        osc.type = type;
        osc.frequency.value = frequency;
        osc.detune.value = detune;
        gain.gain.value = volume;
        
        osc.connect(gain);
        gain.connect(this.masterGain);
        osc.start();
        
        this.oscillators.push({ osc, gain });
        return { osc, gain };
    },

    createDroneLayer() {
        const drones = [
            { freq: 55, type: 'sine', vol: 0.07 },
            { freq: 82.5, type: 'triangle', vol: 0.04 },
            { freq: 110, type: 'sine', vol: 0.025 },
            { freq: 165, type: 'sawtooth', vol: 0.015 }
        ];

        drones.forEach(d => {
            const osc = this.audioContext.createOscillator();
            const gain = this.audioContext.createGain();
            const filter = this.audioContext.createBiquadFilter();

            osc.type = d.type;
            osc.frequency.value = d.freq;

            if (d.type === 'sawtooth') {
                filter.type = 'lowpass';
                filter.frequency.value = 400;
                filter.Q.value = 3;
                osc.connect(filter);
                filter.connect(gain);
            } else {
                osc.connect(gain);
            }

            gain.gain.value = d.vol;
            gain.connect(this.masterGain);

            osc.start();
            this.oscillators.push({ osc, gain, filter });

            const lfo = this.audioContext.createOscillator();
            const lfoGain = this.audioContext.createGain();

            lfo.type = 'sine';
            lfo.frequency.value = 0.1 + Math.random() * 0.15;
            lfoGain.gain.value = d.freq * 0.02;

            lfo.connect(lfoGain);
            lfoGain.connect(osc.frequency);
            lfo.start();
            this.oscillators.push({ osc: lfo, gain: lfoGain });
        });
    },

    createAmbientPad() {
        const chords = [
            [261.63, 329.63, 392.00],
            [233.08, 293.66, 349.23],
            [293.66, 369.99, 440.00]
        ];

        let chordIndex = 0;

        const playChord = () => {
            if (!this.isPlaying) return;

            const chord = chords[chordIndex];
            chordIndex = (chordIndex + 1) % chords.length;

            chord.forEach((freq, i) => {
                setTimeout(() => {
                    if (!this.isPlaying) return;

                    const osc = this.audioContext.createOscillator();
                    const gain = this.audioContext.createGain();
                    const lfo = this.audioContext.createOscillator();
                    const lfoGain = this.audioContext.createGain();

                    osc.type = ['sine', 'triangle'][i % 2];
                    osc.frequency.value = freq;

                    lfo.type = 'sine';
                    lfo.frequency.value = 0.15 + Math.random() * 0.25;
                    lfoGain.gain.value = freq * 0.008;

                    lfo.connect(lfoGain);
                    lfoGain.connect(osc.frequency);

                    gain.gain.setValueAtTime(0, this.audioContext.currentTime);
                    gain.gain.linearRampToValueAtTime(0.04 - i * 0.01, this.audioContext.currentTime + 3);

                    osc.connect(gain);
                    gain.connect(this.masterGain);

                    lfo.start();
                    osc.start();

                    setTimeout(() => {
                        gain.gain.exponentialRampToValueAtTime(0.001, this.audioContext.currentTime + 5);
                        setTimeout(() => {
                            try { osc.stop(); lfo.stop(); } catch(e) {}
                        }, 5000);
                    }, 8000);

                    this.oscillators.push({ osc, gain, lfo });
                }, i * 200);
            });
        };

        playChord();
        setInterval(playChord, 12000);
    },

    createWindSound() {
        const bufferSize = this.audioContext.sampleRate * 4;
        const buffer = this.audioContext.createBuffer(2, bufferSize, this.audioContext.sampleRate);
        
        for (let channel = 0; channel < 2; channel++) {
            const data = buffer.getChannelData(channel);
            let lastOut = 0;
            
            for (let i = 0; i < bufferSize; i++) {
                const white = Math.random() * 2 - 1;
                lastOut = 0.998 * lastOut + white * 0.002;
                data[i] = lastOut * 0.035;
            }
        }
        
        const source = this.audioContext.createBufferSource();
        source.buffer = buffer;
        source.loop = true;
        
        const filter = this.audioContext.createBiquadFilter();
        filter.type = 'bandpass';
        filter.frequency.value = 500;
        filter.Q.value = 0.6;

        const windLFO = this.audioContext.createOscillator();
        const windLFOGain = this.audioContext.createGain();
        windLFO.type = 'sine';
        windLFO.frequency.value = 0.08;
        windLFOGain.gain.value = 300;
        windLFO.connect(windLFOGain);
        windLFOGain.connect(filter.frequency);
        windLFO.start();
        
        const windGain = this.audioContext.createGain();
        windGain.gain.value = 0.22;
        
        source.connect(filter);
        filter.connect(windGain);
        windGain.connect(this.masterGain);
        source.start();

        this.oscillators.push({ osc: windLFO, gain: windLFOGain });
        return source;
    },

    createPianoNote(midiNote, duration = 2.5) {
        const freq = 440 * Math.pow(2, (midiNote - 69) / 12);
        
        for (let i = 1; i <= 4; i++) {
            const osc = this.audioContext.createOscillator();
            const gain = this.audioContext.createGain();
            
            osc.type = 'sine';
            osc.frequency.value = freq * i;
            
            const baseVol = [0.06, 0.03, 0.018, 0.008][i - 1];
            
            gain.gain.setValueAtTime(baseVol, this.audioContext.currentTime);
            gain.gain.exponentialRampToValueAtTime(baseVol * 0.7, this.audioContext.currentTime + 0.3);
            gain.gain.exponentialRampToValueAtTime(0.001, this.audioContext.currentTime + duration);
            
            osc.connect(gain);
            gain.connect(this.masterGain);
            osc.start();
            osc.stop(this.audioContext.currentTime + duration);
        }
    },

    playMelodySequence() {
        const melodies = [
            [72, 74, 76, 79, 81],
            [67, 71, 74, 76, 79],
            [74, 76, 79, 81, 83],
            [64, 67, 71, 74, 76]
        ];

        const interval = setInterval(() => {
            if (!this.isPlaying) return;
            
            if (Math.random() > 0.55) {
                const melody = melodies[Math.floor(Math.random() * melodies.length)];
                
                melody.forEach((note, index) => {
                    setTimeout(() => {
                        if (!this.isPlaying) return;
                        this.createPianoNote(note, 3 + Math.random());
                    }, index * (1000 + Math.random() * 600));
                });
            }
        }, 15000 + Math.random() * 10000);

        this.intervals.push(interval);
    },

    createHighString(freq, duration = 4) {
        const osc = this.audioContext.createOscillator();
        const gain = this.audioContext.createGain();
        const filter = this.audioContext.createBiquadFilter();

        osc.type = 'sawtooth';
        osc.frequency.value = freq;

        filter.type = 'lowpass';
        filter.frequency.value = 2500;
        filter.Q.value = 1.5;

        gain.gain.setValueAtTime(0, this.audioContext.currentTime);
        gain.gain.linearRampToValueAtTime(0.045, this.audioContext.currentTime + 0.8);
        gain.gain.exponentialRampToValueAtTime(0.001, this.audioContext.currentTime + duration);

        osc.connect(filter);
        filter.connect(gain);
        gain.connect(this.masterGain);

        osc.start();
        osc.stop(this.audioContext.currentTime + duration);
    },

    playHighHarmonics() {
        const interval = setInterval(() => {
            if (!this.isPlaying) return;
            
            if (Math.random() > 0.65) {
                const freq = 1200 + Math.random() * 1800;
                this.createHighString(freq, 3 + Math.random() * 4);
            }
        }, 3500 + Math.random() * 4500);

        this.intervals.push(interval);
    },

    playHeartbeat() {
        const beatInterval = setInterval(() => {
            if (!this.isPlaying) return;
            
            const patterns = [[60], [60, 80], [55], [65]];
            const pattern = patterns[Math.floor(Math.random() * patterns.length)];

            pattern.forEach((freq, i) => {
                setTimeout(() => {
                    if (!this.isPlaying) return;

                    const osc = this.audioContext.createOscillator();
                    const gain = this.audioContext.createGain();

                    osc.type = 'sine';
                    osc.frequency.value = freq;

                    gain.gain.setValueAtTime(0, this.audioContext.currentTime);
                    gain.gain.linearRampToValueAtTime(0.18, this.audioContext.currentTime + 0.06);
                    gain.gain.exponentialRampToValueAtTime(0.001, this.audioContext.currentTime + 0.4);

                    osc.connect(gain);
                    gain.connect(this.masterGain);

                    osc.start();
                    osc.stop(this.audioContext.currentTime + 0.4);
                }, i * 150);
            });
        }, 2200 + Math.random() * 1300);

        this.intervals.push(beatInterval);
    },

    playBell() {
        const bellInterval = setInterval(() => {
            if (!this.isPlaying) return;
            
            if (Math.random() > 0.58) {
                const frequencies = [523.25, 659.25, 783.99, 880.00];
                const freq = frequencies[Math.floor(Math.random() * frequencies.length)];
                
                const osc = this.audioContext.createOscillator();
                const gain = this.audioContext.createGain();

                osc.type = 'sine';
                osc.frequency.value = freq;

                gain.gain.setValueAtTime(0.09, this.audioContext.currentTime);
                gain.gain.exponentialRampToValueAtTime(0.001, this.audioContext.currentTime + 5);

                osc.connect(gain);
                gain.connect(this.masterGain);

                osc.start();
                osc.stop(this.audioContext.currentTime + 5);
            }
        }, 4500 + Math.random() * 9000);

        this.intervals.push(bellInterval);
    },

    playWhisper() {
        const whisperInterval = setInterval(() => {
            if (!this.isPlaying) return;
            
            if (Math.random() > 0.7) {
                const bufferSize = this.audioContext.sampleRate * (1.5 + Math.random());
                const buffer = this.audioContext.createBuffer(1, bufferSize, this.audioContext.sampleRate);
                const data = buffer.getChannelData(0);
                
                for (let i = 0; i < bufferSize; i++) {
                    data[i] = (Math.random() * 2 - 1) * 0.035;
                }
                
                const source = this.audioContext.createBufferSource();
                source.buffer = buffer;
                
                const filter = this.audioContext.createBiquadFilter();
                filter.type = 'bandpass';
                filter.frequency.value = 1400 + Math.random() * 700;
                filter.Q.value = 6;
                
                const whisperGain = this.audioContext.createGain();
                whisperGain.gain.setValueAtTime(0, this.audioContext.currentTime);
                whisperGain.gain.linearRampToValueAtTime(0.07, this.audioContext.currentTime + 0.4);
                whisperGain.gain.linearRampToValueAtTime(0, this.audioContext.currentTime + 1.8);
                
                source.connect(filter);
                filter.connect(whisperGain);
                whisperGain.connect(this.masterGain);
                
                source.start();
            }
        }, 3500 + Math.random() * 7500);

        this.intervals.push(whisperInterval);
    },

    createFootstep(isClose = false) {
        const stepCount = Math.floor(Math.random() * 5) + 3;
        const baseVolume = isClose ? 0.13 : 0.065;
        
        for (let i = 0; i < stepCount; i++) {
            setTimeout(() => {
                if (!this.isPlaying) return;

                const osc = this.audioContext.createOscillator();
                const gain = this.audioContext.createGain();
                const filter = this.audioContext.createBiquadFilter();

                osc.type = 'sine';
                osc.frequency.value = 85 + Math.random() * 45;

                filter.type = 'lowpass';
                filter.frequency.value = 320;
                filter.Q.value = 2.5;

                const volumeVariation = baseVolume * (0.65 + Math.random() * 0.65);
                
                gain.gain.setValueAtTime(volumeVariation, this.audioContext.currentTime);
                gain.gain.exponentialRampToValueAtTime(0.001, this.audioContext.currentTime + 0.18);

                osc.connect(filter);
                filter.connect(gain);
                gain.connect(this.masterGain);

                osc.start();
                osc.stop(this.audioContext.currentTime + 0.18);

                if (i === stepCount - 1 && Math.random() > 0.4) {
                    setTimeout(() => {
                        if (!this.isPlaying) return;

                        const echoOsc = this.audioContext.createOscillator();
                        const echoGain = this.audioContext.createGain();
                        const echoFilter = this.audioContext.createBiquadFilter();

                        echoOsc.type = 'sine';
                        echoOsc.frequency.value = 55 + Math.random() * 25;

                        echoFilter.type = 'lowpass';
                        echoFilter.frequency.value = 180;

                        echoGain.gain.setValueAtTime(baseVolume * 0.35, this.audioContext.currentTime);
                        echoGain.gain.exponentialRampToValueAtTime(0.001, this.audioContext.currentTime + 0.35);

                        echoOsc.connect(echoFilter);
                        echoFilter.connect(echoGain);
                        echoGain.connect(this.masterGain);

                        echoOsc.start();
                        echoOsc.stop(this.audioContext.currentTime + 0.35);
                    }, 180 + Math.random() * 120);
                }
            }, i * (380 + Math.random() * 220));
        }
    },

    playFootsteps() {
        const interval = setInterval(() => {
            if (!this.isPlaying) return;

            if (Math.random() > 0.62) {
                const isClose = Math.random() > 0.68;
                this.createFootstep(isClose);
            }

            if (Math.random() > 0.88) {
                setTimeout(() => {
                    if (!this.isPlaying) return;
                    this.createFootstep(true);
                }, 400 + Math.random() * 1200);
            }
        }, 7500 + Math.random() * 11500);

        this.intervals.push(interval);
    },

    createMetallicSound() {
        const bufferSize = this.audioContext.sampleRate * 0.6;
        const buffer = this.audioContext.createBuffer(1, bufferSize, this.audioContext.sampleRate);
        const data = buffer.getChannelData(0);
        
        for (let i = 0; i < bufferSize; i++) {
            data[i] = Math.sin(i * 0.025) * Math.exp(-i / (bufferSize * 0.14)) * 0.09;
        }
        
        const source = this.audioContext.createBufferSource();
        source.buffer = buffer;
        
        const filter = this.audioContext.createBiquadFilter();
        filter.type = 'highpass';
        filter.frequency.value = 2800;
        
        source.connect(filter);
        filter.connect(this.masterGain);
        source.start();
        
        return source;
    },

    playMetallicHits() {
        const interval = setInterval(() => {
            if (!this.isPlaying) return;
            
            if (Math.random() > 0.72) {
                this.createMetallicSound();
            }
        }, 5500 + Math.random() * 9500);

        this.intervals.push(interval);
    },

    createGlitchNoise(duration = 0.35) {
        const bufferSize = this.audioContext.sampleRate * duration;
        const buffer = this.audioContext.createBuffer(1, bufferSize, this.audioContext.sampleRate);
        const data = buffer.getChannelData(0);
        
        for (let i = 0; i < bufferSize; i++) {
            data[i] = (Math.random() > 0.88 ? (Math.random() * 2 - 1) : 0) * 0.13;
        }
        
        const source = this.audioContext.createBufferSource();
        source.buffer = buffer;
        
        const filter = this.audioContext.createBiquadFilter();
        filter.type = 'bandpass';
        filter.frequency.value = 1600 + Math.random() * 2400;
        filter.Q.value = 12;
        
        const glitchGain = this.audioContext.createGain();
        glitchGain.gain.setValueAtTime(0.09, this.audioContext.currentTime);
        glitchGain.gain.exponentialRampToValueAtTime(0.001, this.audioContext.currentTime + duration);
        
        source.connect(filter);
        filter.connect(glitchGain);
        glitchGain.connect(this.masterGain);
        source.start();
        
        return source;
    },

    playGlitchEffects() {
        const interval = setInterval(() => {
            if (!this.isPlaying) return;
            
            if (Math.random() > 0.82) {
                this.createGlitchNoise(0.15 + Math.random() * 0.35);
            }
        }, 2800 + Math.random() * 6500);

        this.intervals.push(interval);
    },

    createCreepyVoice() {
        const bufferSize = this.audioContext.sampleRate * 2;
        const buffer = this.audioContext.createBuffer(1, bufferSize, this.audioContext.sampleRate);
        const data = buffer.getChannelData(0);
        
        for (let i = 0; i < bufferSize; i++) {
            data[i] = (Math.random() * 2 - 1) * 0.04;
        }
        
        const source = this.audioContext.createBufferSource();
        source.buffer = buffer;
        
        const filter = this.audioContext.createBiquadFilter();
        filter.type = 'bandpass';
        filter.frequency.value = 350 + Math.random() * 200;
        filter.Q.value = 8;

        const voiceLFO = this.audioContext.createOscillator();
        const voiceLFOGain = this.audioContext.createGain();
        voiceLFO.type = 'sine';
        voiceLFO.frequency.value = 3 + Math.random() * 4;
        voiceLFOGain.gain.value = 150;
        voiceLFO.connect(voiceLFOGain);
        voiceLFOGain.connect(filter.frequency);
        voiceLFO.start();
        
        const voiceGain = this.audioContext.createGain();
        voiceGain.gain.setValueAtTime(0, this.audioContext.currentTime);
        voiceGain.gain.linearRampToValueAtTime(0.055, this.audioContext.currentTime + 0.3);
        voiceGain.gain.linearRampToValueAtTime(0, this.audioContext.currentTime + 2);
        
        source.connect(filter);
        filter.connect(voiceGain);
        voiceGain.connect(this.masterGain);
        
        source.start();

        this.oscillators.push({ osc: voiceLFO, gain: voiceLFOGain });
        return source;
    },

    playCreepyVoices() {
        const interval = setInterval(() => {
            if (!this.isPlaying) return;
            
            if (Math.random() > 0.88) {
                this.createCreepyVoice();
            }
        }, 10000 + Math.random() * 15000);

        this.intervals.push(interval);
    },

    createSuddenScare() {
        const osc = this.audioContext.createOscillator();
        const gain = this.audioContext.createGain();
        const filter = this.audioContext.createBiquadFilter();

        osc.type = 'sawtooth';
        osc.frequency.value = 150 + Math.random() * 100;

        filter.type = 'highpass';
        filter.frequency.value = 800;
        filter.Q.value = 4;

        gain.gain.setValueAtTime(0.2, this.audioContext.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, this.audioContext.currentTime + 0.3);

        osc.connect(filter);
        filter.connect(gain);
        gain.connect(this.masterGain);

        osc.start();
        osc.stop(this.audioContext.currentTime + 0.3);
    },

    playSuddenScares() {
        const interval = setInterval(() => {
            if (!this.isPlaying) return;
            
            if (Math.random() > 0.92) {
                this.createSuddenScare();
            }
        }, 20000 + Math.random() * 25000);

        this.intervals.push(interval);
    },

    createDoorCreak() {
        const bufferSize = this.audioContext.sampleRate * 1.5;
        const buffer = this.audioContext.createBuffer(1, bufferSize, this.audioContext.sampleRate);
        const data = buffer.getChannelData(0);
        
        for (let i = 0; i < bufferSize; i++) {
            const t = i / bufferSize;
            data[i] = (Math.sin(i * 0.08) * Math.sin(t * Math.PI)) * 0.06 * (1 - t * 0.5);
        }
        
        const source = this.audioContext.createBufferSource();
        source.buffer = buffer;
        
        const filter = this.audioContext.createBiquadFilter();
        filter.type = 'bandpass';
        filter.frequency.value = 800;
        filter.Q.value = 3;
        
        const creakGain = this.audioContext.createGain();
        creakGain.gain.value = 0.11;
        
        source.connect(filter);
        filter.connect(creakGain);
        creakGain.connect(this.masterGain);
        source.start();
        
        return source;
    },

    playDoorCreaks() {
        const interval = setInterval(() => {
            if (!this.isPlaying) return;
            
            if (Math.random() > 0.86) {
                this.createDoorCreak();
            }
        }, 15000 + Math.random() * 20000);

        this.intervals.push(interval);
    },

    // ── 随机吓人音效（MP3 文件） ──
    playRandomScare() {
        if (!this.isPlaying) return;
        var file = this.scareSounds[Math.floor(Math.random() * this.scareSounds.length)];
        var audio = new Audio(file);
        audio.volume = 0.7;
        this.duck();               // 背景音乐不中断，仅短暂压低以突出女鬼音
        audio.play().catch(function(){});
        this.scareAudioElements.push(audio);
        audio.onended = function() {
            BGM.unduck();          // 女鬼音结束，背景音乐恢复原有音量
            var idx = BGM.scareAudioElements.indexOf(audio);
            if (idx > -1) BGM.scareAudioElements.splice(idx, 1);
        };
    },

    // 背景音乐在女鬼音频播放时短暂压低（不中断）
    duck() {
        if (!this.masterGain || !this.audioContext) return;
        var t = this.audioContext.currentTime;
        var target = (this.volume != null ? this.volume : 0.28) * 0.18;
        this.masterGain.gain.cancelScheduledValues(t);
        this.masterGain.gain.setTargetAtTime(target, t, 0.05);
    },

    unduck() {
        if (!this.masterGain || !this.audioContext) return;
        var t = this.audioContext.currentTime;
        var target = (this.volume != null ? this.volume : 0.28);
        this.masterGain.gain.cancelScheduledValues(t);
        this.masterGain.gain.setTargetAtTime(target, t, 0.5);
    },

    // ── 追逐背景音乐：黑暗欺骗（循环播放，追逐期间替换普通氛围）──
    startChase() {
        if (this.chasePlaying) return;
        if (!this.audioContext) this.init();
        if (this.audioContext.state === 'suspended') this.audioContext.resume();

        // 暂停普通恐怖氛围，让黑暗欺骗成为唯一背景音
        if (this.isPlaying) this.stop();

        this.chasePlaying = true;
        var self = this;
        var file = "chase.mp3";

        // 主路径：HTMLAudioElement 循环播放（file:// 同目录可用）
        var audio = new Audio(file);
        audio.loop = true;
        audio.volume = 0.7;
        var p = audio.play();
        if (p && p.catch) p.catch(function () {});
        this.chaseHtml = audio;

        // 增强路径：http 下用 Web Audio 解码后接管（独立输出，不经过 masterGain）
        if (this.audioContext) {
            fetch(file)
                .then(function (r) { return r.arrayBuffer(); })
                .then(function (ab) {
                    self.audioContext.decodeAudioData(ab, function (buf) {
                        try { audio.pause(); } catch (e) {}
                        var src = self.audioContext.createBufferSource();
                        src.buffer = buf;
                        src.loop = true;
                        src.connect(self.audioContext.destination);
                        src.start(0);
                        self.chaseSrc = src;
                    }, function () { /* 解码失败：保留 HTMLAudioElement 播放 */ });
                })
                .catch(function () { /* fetch 失败（如 file://）：保留 HTMLAudioElement 播放 */ });
        }
    },

    stopChase() {
        if (!this.chasePlaying) return;
        this.chasePlaying = false;
        if (this.chaseHtml) {
            try { this.chaseHtml.pause(); } catch (e) {}
            try { this.chaseHtml.remove(); } catch (e) {}
            this.chaseHtml = null;
        }
        if (this.chaseSrc) {
            try { this.chaseSrc.stop(); } catch (e) {}
            this.chaseSrc = null;
        }
        // 追逐结束后恢复普通恐怖氛围（若本应播放）
        try {
            if (localStorage.getItem('bgm_playing') !== 'true') {
                localStorage.setItem('bgm_playing', 'true');
            }
        } catch (e) {}
        this.start();
    },

    // 跟随全局追逐标志，自动停止追逐背景音（每张地图 update 中调用）
    // 注意：只负责「停止」。启动统一在用户手势点进行（见 map3 触发处、
    // resumeOnInteraction 首次交互），以免在 requestAnimationFrame 回调中调用
    // startChase 时被浏览器自动播放策略拦截导致静音。
    syncChase() {
        var on = false;
        try { on = sessionStorage.getItem('chaseOn') === '1'; } catch (e) {}
        if (!on && this.chasePlaying) this.stopChase();
    },

    // ── 上下楼音效：播放音频开头 2 秒（不变速）──
    // 双保险：① 同步在用户手势栈内用 HTMLAudioElement 播放（file:// 同目录可用）；
    //         ② 同时用 Web Audio（与背景音同一条 AudioContext）解码播放（http 下最稳）。
    // 两者都直接输出到 destination，不经过 masterGain，故背景音乐全程不中断。
    playStair(callback) {
        var file = '上下楼(1).mp3';
        var self = this;
        var finished = false;
        var finish = function () {
            if (finished) return;
            finished = true;
            if (callback) callback();    // 仅跳转一次
        };

        // ① 同步启动 HTMLAudioElement（在手势栈内，file:// 也能响）
        var audio = new Audio(file);
        audio.volume = 1.0;
        var p = audio.play();
        if (p && p.catch) p.catch(function () {});
        var stopHtml = function () { try { audio.pause(); audio.currentTime = 0; } catch (e) {} };
        // 基础计时：2 秒后停 HTML 音并跳转（file:// 场景兜底）
        setTimeout(function () { stopHtml(); finish(); }, 2000);

        // ② 升级为 Web Audio（与背景音同链路，http 下最稳）
        if (this.audioContext) {
            fetch(file)
                .then(function (r) { return r.arrayBuffer(); })
                .then(function (ab) {
                    self.audioContext.decodeAudioData(ab, function (buf) {
                        stopHtml();                       // 切到 Web Audio，停 HTML 音
                        var src = self.audioContext.createBufferSource();
                        src.buffer = buf;
                        src.connect(self.audioContext.destination);  // 独立输出，不碰 masterGain
                        src.start(0);                     // 从开头播放
                        setTimeout(function () {
                            try { src.stop(); } catch (e) {}
                            finish();
                        }, 2000);
                    }, function () { /* 解码失败：保留 HTMLAudioElement 播放 */ });
                })
                .catch(function () { /* fetch 失败（如 file://）：保留 HTMLAudioElement 播放 */ });
        }
    },

    // ── 电脑交互音效：播放 电脑音效(1).mp3 ──
    // Web Audio 仅在 audioContext 确实 running 时才接管（否则保留更可靠的 HTMLAudio），
    // 避免“HTML 被提前停掉、Web Audio 又没响”造成的静音。背景音全程不中断。
    playComputer() {
        var file = '电脑音效(1).mp3';
        var self = this;

        // 主路径：同步在手势栈内启动 HTMLAudioElement（file:// 也能响）
        var audio = new Audio(file);
        audio.volume = 1.0;
        var p = audio.play();
        if (p && p.catch) p.catch(function () {});

        // 增强路径：仅当背景音 AudioContext 确实在运行时，才用 Web Audio 播放
        if (this.audioContext && this.audioContext.state === 'running') {
            fetch(file)
                .then(function (r) { return r.arrayBuffer(); })
                .then(function (ab) {
                    self.audioContext.decodeAudioData(ab, function (buf) {
                        // 确认能走 Web Audio 了，再停掉 HTML 音，避免静音空窗
                        try { audio.pause(); audio.currentTime = 0; } catch (e) {}
                        var src = self.audioContext.createBufferSource();
                        src.buffer = buf;
                        src.connect(self.audioContext.destination);  // 独立输出，不碰 masterGain
                        src.start(0);
                        var dur = (buf.duration || 2) * 1000 + 200; // 播完自动停止
                        setTimeout(function () { try { src.stop(); } catch (e) {} }, dur);
                    }, function () { /* 解码失败：保留 HTMLAudioElement 播放 */ });
                })
                .catch(function () { /* fetch 失败（如 file://）：保留 HTMLAudioElement 播放 */ });
        }
    },

    scheduleScareSounds() {
        var self = this;
        var nextDelay = 35000 + Math.random() * 65000; // 35~100 秒间隔

        var scheduleNext = function() {
            if (!self.isPlaying) return;
            self.scareTimeout = setTimeout(function() {
                if (!self.isPlaying) return;
                // 约 40% 概率触发
                if (Math.random() < 0.4) {
                    self.playRandomScare();
                }
                // 偶尔连发两次
                if (Math.random() < 0.12) {
                    var delay2 = 1200 + Math.random() * 3000;
                    setTimeout(function() {
                        if (!self.isPlaying) return;
                        self.playRandomScare();
                    }, delay2);
                }
                scheduleNext();
            }, nextDelay);
            // 下一次间隔不同
            nextDelay = 35000 + Math.random() * 75000;
        };

        scheduleNext();
    },

    // ── 交互/切换场景音效（10% 概率触发） ──
    playSwitchSound() {
        if (!this.isPlaying) return;
        var file = this.switchSounds[Math.floor(Math.random() * this.switchSounds.length)];
        var audio = new Audio(file);
        audio.volume = 0.6;
        audio.play().catch(function(){});
        this.scareAudioElements.push(audio);
        audio.onended = function() {
            var idx = BGM.scareAudioElements.indexOf(audio);
            if (idx > -1) BGM.scareAudioElements.splice(idx, 1);
        };
    },

    tryPlaySwitchSound() {
        if (Math.random() < 0.1) {
            this.playSwitchSound();
        }
    },

    start() {
        if (this.isPlaying) return;
        
        if (!this.audioContext) {
            this.init();
        }
        
        if (this.audioContext.state === 'suspended') {
            this.audioContext.resume();
        }

        this.isPlaying = true;
        localStorage.setItem('bgm_playing', 'true');

        this.createDroneLayer();
        
        setTimeout(() => {
            if (this.isPlaying) this.createAmbientPad();
        }, 500);

        setTimeout(() => {
            if (this.isPlaying) this.createWindSound();
        }, 1500);

        this.playHeartbeat();
        this.playBell();
        this.playWhisper();
        this.playHighHarmonics();
        this.playMelodySequence();
        this.playFootsteps();
        this.playMetallicHits();
        this.playGlitchEffects();
        this.playCreepyVoices();
        this.playSuddenScares();
        this.playDoorCreaks();
        this.scheduleScareSounds();

        console.log('%c🎵 恐怖氛围音乐已启动 - 星榆中学档案室', 
                   'color: #8b0000; font-size: 14px; font-weight: bold;');
    },

    stop() {
        this.isPlaying = false;
        localStorage.setItem('bgm_playing', 'false');

        // 清理 map6 专用 caidan.mp3
        if (this._map6Audio) {
            try { this._map6Audio.pause(); this._map6Audio.currentTime = 0; this._map6Audio.remove(); } catch (e) {}
            this._map6Audio = null;
        }

        this.oscillators.forEach(({ osc, lfo }) => {
            try {
                osc.stop();
                if (lfo) lfo.stop();
            } catch (e) {}
        });
        this.oscillators = [];

        this.sources.forEach(source => {
            try {
                source.stop();
            } catch (e) {}
        });
        this.sources = [];

        this.intervals.forEach(interval => clearInterval(interval));
        this.intervals = [];

        // 清理随机吓人音效
        if (this.scareTimeout) { clearTimeout(this.scareTimeout); this.scareTimeout = null; }
        this.scareAudioElements.forEach(function(a) { try { a.pause(); a.remove(); } catch(e) {} });
        this.scareAudioElements = [];

        console.log('%c⏹️ 背景音乐已停止', 
                   'color: #666; font-size: 12px;');
    },

    toggle() {
        if (this.isPlaying) {
            this.stop();
        } else {
            this.start();
        }
        return this.isPlaying;
    },

    setVolume(value) {
        value = Math.max(0, Math.min(1, value));
        this.volume = value;
        if (this.masterGain) {
            this.masterGain.gain.value = value;
        }
        if (this._map6Audio) {
            this._map6Audio.volume = Math.min(1, value * 1.5);  // map6 音乐独立音量
        }
    }
};

window.BGM = BGM;

// ── 全局页面跳转函数（所有地图页面共用）──
window.go = function(url) {
  window.location.href = url;
};

document.addEventListener('DOMContentLoaded', () => {
    // ── 结局页专用：禁用 BGM 自动恢复（避免与结局音乐冲突） ──
    if (window.__xyzh_block_bgm_autostart) {
        try { if (BGM && BGM.stop) BGM.stop(); } catch(e) {}
        try { if (BGM && BGM.stopChase) BGM.stopChase(); } catch(e) {}
        try {
            document.querySelectorAll('audio').forEach(function(a){
                // 不要动结局页专属的背景音乐 audio，否则会把它静音导致听不到
                if (a.id === 'ending-bgm' || a.id === 'bad-ending-bgm') return;
                try { a.pause(); a.currentTime = 0; a.muted = true; } catch(e) {}
            });
        } catch(e) {}
        // M 键切换仍可用，但不再自动启动
        document.addEventListener('keydown', (e) => {
            if (e.key === 'm' || e.key === 'M') {
                const isPlaying = BGM.toggle();
                console.log(`%c${isPlaying ? '🔊 音乐开启' : '🔇 音乐关闭'} (按 M 键切换)`,
                           isPlaying ? 'color: green;' : 'color: red;');
            }
        });
        return; // 跳过自动恢复
    }

    // M key toggle
    document.addEventListener('keydown', (e) => {
        if (e.key === 'm' || e.key === 'M') {
            const isPlaying = BGM.toggle();
            console.log(`%c${isPlaying ? '🔊 音乐开启' : '🔇 音乐关闭'} (按 M 键切换)`, 
                       isPlaying ? 'color: green;' : 'color: red;');
        }
    });

    // map6 专用：进入页面立刻尝试播放 caidan.mp3（不论 bgm_playing 状态）
    if (location.pathname.indexOf('map6.html') !== -1) {
        try {
            BGM._map6Audio = new Audio('caidan.mp3');
            BGM._map6Audio.loop = true;
            BGM._map6Audio.volume = 0.6;
            var p = BGM._map6Audio.play();
            if (p && p.catch) p.catch(function(){});
            BGM.isPlaying = true;
            localStorage.setItem('bgm_playing', 'true');
            console.log('%c🎵 map6 caidan.mp3 加载时启动', 'color: #8b0000;');
        } catch (e) { console.warn('map6 caidan.mp3 启动失败', e); }
    } else if (location.pathname.indexOf('start.html') === -1 && localStorage.getItem('bgm_playing') === 'true') {
        BGM.start();
    }

    // Fallback: first user interaction resumes suspended AudioContext
    const resumeOnInteraction = () => {
        // map6：若加载时没启动成功（被浏览器拦截），首次交互时再试
        if (location.pathname.indexOf('map6.html') !== -1) {
            if (BGM._map6Audio && BGM._map6Audio.paused) {
                BGM._map6Audio.play().catch(function(){});
            }
            return;
        }
        if (!BGM.isPlaying && localStorage.getItem('bgm_playing') === 'true') {
            BGM.start();
        }
        // 关键修复：跨页面后 BGM.start() 已在 DOMContentLoaded 把 isPlaying 置为 true，
        // 但新页面的 AudioContext 处于 suspended（尚无手势），若只在 !isPlaying 时 resume，
        // 背景音乐将永远静音。因此只要上下文被挂起就恢复它（在手势栈内必定成功）。
        if (BGM.audioContext && BGM.audioContext.state === 'suspended') {
            BGM.audioContext.resume();
        }
        // 跨页面后若追逐仍在进行，在首次用户交互（手势内）启动黑暗欺骗追逐音
        try {
            if (sessionStorage.getItem('chaseOn') === '1' && !BGM.chasePlaying) {
                BGM.startChase();
            }
        } catch (e) {}
        document.removeEventListener('click', resumeOnInteraction);
        document.removeEventListener('keydown', resumeOnInteraction);
    };
    document.addEventListener('click', resumeOnInteraction);
    document.addEventListener('keydown', resumeOnInteraction);

    console.log('%c═══════════════════════════════════════', 
               'color: #333; font-weight: bold;');
    console.log('%c👻 星榆中学档案室 - 恐怖氛围音乐系统 v3.0', 
               'color: #8b0000; font-size: 16px; font-weight: bold;');
    console.log('%c═══════════════════════════════════════', 
               'color: #333; font-weight: bold;');
});