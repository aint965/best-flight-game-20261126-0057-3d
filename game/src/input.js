// Keyboard and pointer input. Held keys give a steering vector; one-shot presses (start,
// pause, restart) are queued as bit flags and taken once by the loop, so a press between two
// frames is never lost and never counted twice.
import { STEP } from './config.js';

export const ACTION_CONFIRM = 1;
export const ACTION_PAUSE = 2;
export const ACTION_RESTART = 4;
export const ACTION_CAMERA = 8;

const PITCH_UP = new Set(['ArrowDown', 'KeyS']);
const PITCH_DOWN = new Set(['ArrowUp', 'KeyW']);
const ROLL_LEFT = new Set(['ArrowLeft', 'KeyA']);
const ROLL_RIGHT = new Set(['ArrowRight', 'KeyD']);
const YAW_LEFT = new Set(['KeyQ']);
const YAW_RIGHT = new Set(['KeyE']);
const THROTTLE_UP = new Set(['ShiftLeft', 'ShiftRight']);
const THROTTLE_DOWN = new Set(['ControlLeft', 'ControlRight', 'KeyC']);
const CONFIRM = new Set(['Space', 'Enter']);
const PAUSE = new Set(['KeyP', 'Escape']);
const RESTART = new Set(['KeyR']);
const CAMERA = new Set(['KeyV']);

export function createInput() {
  const held = new Set();
  let actions = 0;

  window.addEventListener('keydown', (event) => {
    if (CONFIRM.has(event.code)) {
      if (!event.repeat) actions |= ACTION_CONFIRM;
    } else if (PAUSE.has(event.code)) {
      if (!event.repeat) actions |= ACTION_PAUSE;
    } else if (RESTART.has(event.code)) {
      if (!event.repeat) actions |= ACTION_RESTART;
    } else if (CAMERA.has(event.code)) {
      if (!event.repeat) actions |= ACTION_CAMERA;
    } else if (
      PITCH_UP.has(event.code) || PITCH_DOWN.has(event.code)
      || ROLL_LEFT.has(event.code) || ROLL_RIGHT.has(event.code)
      || YAW_LEFT.has(event.code) || YAW_RIGHT.has(event.code)
      || THROTTLE_UP.has(event.code) || THROTTLE_DOWN.has(event.code)
    ) {
      held.add(event.code);
    } else return;
    event.preventDefault();
  });
  window.addEventListener('keyup', (event) => held.delete(event.code));
  // A key released while the tab is hidden never sends keyup: let go of everything on blur.
  window.addEventListener('blur', () => held.clear());

  function has(set) {
    for (const code of set) if (held.has(code)) return true;
    return false;
  }

  return {
    /** The steering vector for this frame: pitch/roll/yaw in [-1, 1] plus throttle holds. */
    read() {
      return {
        pitch: (has(PITCH_UP) ? 1 : 0) - (has(PITCH_DOWN) ? 1 : 0),
        roll: (has(ROLL_RIGHT) ? 1 : 0) - (has(ROLL_LEFT) ? 1 : 0),
        yaw: (has(YAW_RIGHT) ? 1 : 0) - (has(YAW_LEFT) ? 1 : 0),
        throttleUp: has(THROTTLE_UP),
        throttleDown: has(THROTTLE_DOWN),
      };
    },
    /** The one-shot presses since the last call, as ACTION_* flags. */
    takeActions() {
      const taken = actions;
      actions = 0;
      return taken;
    },
    /** For the driver: press and release a key programmatically. */
    press(code) {
      held.add(code);
    },
    release(code) {
      held.delete(code);
    },
    queueAction(flag) {
      actions |= flag;
    },
  };
}

/** The step constant is imported so the module's public surface documents the fixed loop. */
export const INPUT_STEP = STEP;
