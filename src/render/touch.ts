/**
 * Phone controls. Everything here drives the game by dispatching the SAME keyboard events the desktop uses, so the
 * physics tick and its held-key logic never learn that touch exists. Two exceptions that are naturally analogue —
 * the throttle slider and the rotation stick's centre deadzone — set/read throttle directly through callbacks.
 *
 * Layout: a rotation stick bottom-left (drag = pitch/yaw), a vertical main-throttle slider bottom-right, and a
 * six-key RCS pad above it whose labels match the on-screen docking cue (FWD/BACK, LEFT/RIGHT, UP/DN).
 */
export interface TouchHooks {
  parent: HTMLElement;
  press: (key: string, down: boolean) => void;
  setThrottle: (v: number) => void;
  getThrottle: () => number;
  /** True while the rover is being driven, so the stick steers the car instead of pitching the ship. */
  isDriving?: () => boolean;
}

const PAD_KEYS: [string, string][] = [['FWD', 'w'], ['BACK', 's'], ['LEFT', 'a'], ['RIGHT', 'd'], ['UP', 'r'], ['DN', 'f']];

export function setupTouch({parent, press, setThrottle, getThrottle, isDriving}: TouchHooks) {
  const root = document.createElement('div');
  root.className = 'touch';
  root.innerHTML = `
    <div class="tstick" aria-label="Rotation stick"><span class="tcross"></span><i></i></div>
    <button class="ttilt" aria-pressed="false">TILT</button>
    <div class="tpad">${PAD_KEYS.map(([label, key]) => `<button class="tbtn" data-key="${key}">${label}</button>`).join('')}</div>
    <div class="tthrottle" role="slider" aria-label="Main engine throttle"><i></i><b>0%</b><span>THR</span></div>
    <button class="tturbo" data-key="shift" aria-label="Turbo">TURBO</button>
    <div class="ttoast" hidden></div>`;
  parent.appendChild(root);
  const toast = root.querySelector<HTMLElement>('.ttoast')!;
  let toastTimer = 0;
  const flash = (text: string) => {toast.textContent = text; toast.hidden = false; clearTimeout(toastTimer); toastTimer = window.setTimeout(() => {toast.hidden = true;}, 1600);};

  // Compact mode: a touch device, or a narrow window. Also forced on with ?touch=1 for testing on desktop.
  const coarse = matchMedia('(pointer: coarse)');
  const apply = () => document.body.classList.toggle('compact', new URLSearchParams(location.search).get('touch') === '1' || coarse.matches || innerWidth < 760);
  coarse.addEventListener('change', apply);
  addEventListener('resize', apply);
  apply();

  // Rotation stick: drag from centre; each axis past its deadzone holds the matching key, releases on the way back.
  const stick = root.querySelector<HTMLElement>('.tstick')!, knob = stick.querySelector('i')!;
  const down = new Set<string>();
  const hold = (key: string, want: boolean) => {
    if (want && !down.has(key)) {down.add(key); press(key, true);}
    if (!want && down.has(key)) {down.delete(key); press(key, false);}
  };
  let stickId = -1, lastDriving = false;
  const steer = (dx: number, dy: number) => {
    knob.style.transform = `translate(${dx * 34}px, ${dy * 34}px)`;
    const driving = isDriving?.() ?? false;
    // Swapping modes mid-hold would leave the old axis stuck down.
    if (driving !== lastDriving) {for (const key of [...down]) hold(key, false); lastDriving = driving;}
    // Driving: push forward to accelerate, back to brake, sideways to steer. Flying: pitch and yaw.
    const [up, back, right, left] = driving ? ['w', 's', 'd', 'a'] : ['i', 'k', 'l', 'j'];
    hold(up, dy < -0.4); hold(back, dy > 0.4);
    hold(right, dx > 0.4); hold(left, dx < -0.4);
  };
  stick.addEventListener('pointerdown', e => {
    if (stickId !== -1) return;
    stickId = e.pointerId; try {stick.setPointerCapture(stickId);} catch {/* synthetic */} stick.classList.add('on');
  });
  stick.addEventListener('pointermove', e => {
    if (e.pointerId !== stickId) return;
    const r = stick.getBoundingClientRect();
    const dx = (e.clientX - r.left - r.width / 2) / (r.width / 2), dy = (e.clientY - r.top - r.height / 2) / (r.height / 2);
    const len = Math.hypot(dx, dy) || 1, k = len > 1 ? 1 / len : 1;
    steer(dx * k, dy * k);
  });
  const releaseStick = (e: PointerEvent) => {
    if (e.pointerId !== stickId) return;
    stickId = -1; stick.classList.remove('on'); knob.style.transform = '';
    for (const key of [...down]) hold(key, false);
  };
  stick.addEventListener('pointerup', releaseStick);
  stick.addEventListener('pointercancel', releaseStick);
  stick.addEventListener('lostpointercapture', releaseStick);

  // Tilt-to-steer: the phone's attitude drives pitch and yaw. The pose held when TILT is switched on becomes centre;
  // tilt the top away to pitch down, roll left/right to yaw. Long-press re-centres. iOS needs a permission gesture.
  const tiltBtn = root.querySelector<HTMLElement>('.ttilt')!;
  const tilt = {on: false, baseBeta: null as number | null, baseGamma: 0};
  const onOrient = (e: DeviceOrientationEvent) => {
    if (!tilt.on || e.beta === null || e.gamma === null) return;
    if (tilt.baseBeta === null) {tilt.baseBeta = e.beta; tilt.baseGamma = e.gamma;}
    const db = e.beta - tilt.baseBeta, dg = e.gamma - tilt.baseGamma;
    hold('k', db > 12); hold('i', db < -12);   // tilt top toward you = nose up
    hold('l', dg > 12); hold('j', dg < -12);   // roll right = yaw right
  };
  const setTilt = async (want: boolean) => {
    if (want) {
      const anyEvent = DeviceOrientationEvent as unknown as {requestPermission?: () => Promise<string>};
      if (typeof anyEvent.requestPermission === 'function') {
        try {if (await anyEvent.requestPermission() !== 'granted') {flash('Tilt permission denied'); return;}} catch {flash('Tilt unavailable'); return;}
      }
      tilt.baseBeta = null;
      addEventListener('deviceorientation', onOrient);
    } else {
      removeEventListener('deviceorientation', onOrient);
      for (const key of [...down]) hold(key, false);
    }
    tilt.on = want;
    tiltBtn.classList.toggle('on', want);
    tiltBtn.setAttribute('aria-pressed', String(want));
    flash(want ? 'Tilt on · hold to re-centre' : 'Tilt off');
  };
  let pressTimer = 0, longFired = false;
  tiltBtn.addEventListener('pointerdown', () => {longFired = false; pressTimer = window.setTimeout(() => {longFired = true; if (tilt.on) {tilt.baseBeta = null; flash('Re-centred');}}, 550);});
  const endPress = () => clearTimeout(pressTimer);
  tiltBtn.addEventListener('pointerup', endPress);
  tiltBtn.addEventListener('pointercancel', endPress);
  tiltBtn.addEventListener('click', () => {if (longFired) {longFired = false; return;} setTilt(!tilt.on);});

  // RCS pad: press-and-hold buttons that map straight to the translation keys.
  root.querySelectorAll<HTMLButtonElement>('.tbtn').forEach(button => {
    const key = button.dataset.key!;
    const up = (e: PointerEvent) => {button.releasePointerCapture?.(e.pointerId); button.classList.remove('on'); press(key, false);};
    button.addEventListener('pointerdown', e => {e.preventDefault(); try {button.setPointerCapture(e.pointerId);} catch {/* synthetic */} button.classList.add('on'); press(key, true);});
    button.addEventListener('pointerup', up);
    button.addEventListener('pointercancel', up);
    button.addEventListener('lostpointercapture', up);
  });

  // Turbo: a press-and-hold button that holds Shift, shown only while driving the buggy.
  const turboBtn = root.querySelector<HTMLButtonElement>('.tturbo')!;
  const turboUp = (e: PointerEvent) => {turboBtn.releasePointerCapture?.(e.pointerId); turboBtn.classList.remove('on'); press('shift', false);};
  turboBtn.addEventListener('pointerdown', e => {e.preventDefault(); try {turboBtn.setPointerCapture(e.pointerId);} catch {/* synthetic */} turboBtn.classList.add('on'); press('shift', true);});
  turboBtn.addEventListener('pointerup', turboUp);
  turboBtn.addEventListener('pointercancel', turboUp);
  turboBtn.addEventListener('lostpointercapture', turboUp);

  // Throttle slider: absolute 0..1 from the drag position; snaps to 0 near the bottom.
  const slider = root.querySelector<HTMLElement>('.tthrottle')!, fill = slider.querySelector('i')!, readout = slider.querySelector('b')!;
  const draw = () => {
    const v = getThrottle(); fill.style.height = `${v * 100}%`; readout.textContent = `${Math.round(v * 100)}%`;
    // While driving, the RCS pad and main-engine slider are irrelevant; the stick drives and TURBO replaces them.
    root.classList.toggle('driving', isDriving?.() ?? false);
  };
  let sliderId = -1;
  const setFrom = (e: PointerEvent) => {
    const r = slider.getBoundingClientRect();
    let v = 1 - (e.clientY - r.top - 8) / (r.height - 16);
    v = Math.max(0, Math.min(1, v)); if (v < 0.03) v = 0;
    setThrottle(v); draw();
  };
  slider.addEventListener('pointerdown', e => {sliderId = e.pointerId; try {slider.setPointerCapture(sliderId);} catch {/* synthetic */} setFrom(e);});
  slider.addEventListener('pointermove', e => {if (e.pointerId === sliderId) setFrom(e);});
  const releaseSlider = (e: PointerEvent) => {if (e.pointerId === sliderId) sliderId = -1;};
  slider.addEventListener('pointerup', releaseSlider);
  slider.addEventListener('pointercancel', releaseSlider);

  return {refresh: draw};
}
