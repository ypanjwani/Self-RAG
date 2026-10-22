// Playback engine: plays a list of "beats" (one visible step each) on a single clock.
// Every beat has an animation time (dur) and a short pause after it (hold) so people can read.
// One clock drives everything, which is why all lanes stream at exactly the same moment.
(function () {
  const SR = window.SR;

  class Player {
    constructor(h) {
      this.h = h; // { onBeat(i, dir), onFrame(i, progress), onState(state) }
      this.beats = [];
      this.i = 0;
      this.el = 0;
      this.playing = false;
      this.speed = 1;
      this.stopAt = -1;
      this._loop = this._loop.bind(this);
    }

    total(i) { const b = this.beats[i]; return b.dur + (b.hold ?? 900); }
    anim() { const b = this.beats[this.i]; return b.dur ? Math.min(1, this.el / b.dur) : 1; }
    atEnd() { return this.i >= this.beats.length - 1 && this.el >= this.total(this.i); }

    load(beats, i = 0, full = false) {
      this.playing = false;
      this.stopAt = -1;
      this.beats = beats;
      this.i = Math.max(0, Math.min(i, beats.length - 1));
      this.el = full ? this.beats[this.i].dur : 0;
      this._show(0);
    }

    _show(dir) {
      this.h.onBeat(this.i, dir);
      this.h.onFrame(this.i, this.anim());
      this._emit();
    }

    _emit() {
      this.h.onState && this.h.onState({ playing: this.playing, i: this.i, n: this.beats.length, speed: this.speed });
    }

    play() {
      if (this.playing) return;
      if (this.atEnd()) { this.i = 0; this.el = 0; this._show(0); }
      this.stopAt = -1;
      this._start();
    }

    _start() {
      this.playing = true;
      this.last = performance.now();
      requestAnimationFrame(this._loop);
      this._emit();
    }

    pause() { this.playing = false; this.stopAt = -1; this._emit(); }
    toggle() { this.playing ? this.pause() : this.play(); }

    // Step: finish the current animation, or play exactly the next beat and stop.
    step() {
      if (this.anim() < 1) {
        this.playing = false;
        this.el = this.beats[this.i].dur;
        this.h.onFrame(this.i, 1);
        this._emit();
        return;
      }
      if (this.i >= this.beats.length - 1) { this.pause(); return; }
      this.i++;
      this.el = 0;
      this.h.onBeat(this.i, 1);
      this.stopAt = this.i;
      if (!this.playing) this._start();
    }

    back() {
      this.playing = false;
      this.stopAt = -1;
      if (this.i > 0) this.i--;
      this.el = this.beats[this.i].dur;
      this._show(-1);
    }

    seek(i) {
      this.playing = false;
      this.stopAt = -1;
      this.i = Math.max(0, Math.min(i, this.beats.length - 1));
      this.el = this.beats[this.i].dur;
      this._show(0);
    }

    reset() {
      this.playing = false;
      this.stopAt = -1;
      this.i = 0;
      this.el = 0;
      this._show(0);
    }

    setSpeed(s) { this.speed = s; this._emit(); }

    _loop(ts) {
      if (!this.playing) return;
      const dt = Math.min(100, ts - this.last);
      this.last = ts;
      this.el += dt * this.speed;

      if (this.stopAt === this.i && this.el >= this.beats[this.i].dur) {
        this.el = this.beats[this.i].dur;
        this.h.onFrame(this.i, 1);
        this.playing = false;
        this.stopAt = -1;
        this._emit();
        return;
      }
      if (this.el >= this.total(this.i)) {
        if (this.i < this.beats.length - 1) {
          this.i++;
          this.el = 0;
          this.h.onBeat(this.i, 1);
        } else {
          this.el = this.total(this.i);
          this.h.onFrame(this.i, 1);
          this.playing = false;
          this._emit();
          return;
        }
      }
      this.h.onFrame(this.i, this.anim());
      requestAnimationFrame(this._loop);
    }
  }

  SR.Player = Player;
})();
