// ============================================================================
// proctoring.js (NEW) — webcam monitoring, fullscreen enforcement, and
// tab/focus-switch detection for the test-taking page.
// ----------------------------------------------------------------------------
// Kept as its own module (rather than folded into test.js) so the exam-taking
// logic and the proctoring logic can each be read and reasoned about on their
// own. Every piece here is OPT-IN per test — see session.test.proctoring in
// the API response — so a test created before this feature existed activates
// none of this and behaves exactly as it always did.
//
// HONEST LIMITATION: like the anti-copy measures in security.js, all of this
// is browser-side and therefore a deterrent, not a guarantee — a determined
// student can still find ways around it (e.g. a second device). What IS
// reliable is that every violation is logged and counted server-side, and
// the configured auto-submit threshold is enforced by the server regardless
// of what the browser does next.
// ============================================================================

/** Debounces rapid repeated events (e.g. blur+visibilitychange firing together for one switch). */
function makeDebouncer(windowMs) {
  let last = 0;
  return () => {
    const now = Date.now();
    if (now - last < windowMs) return false;
    last = now;
    return true;
  };
}

// ---------------------------------------------------------------------------
// Tab switching / focus loss (Feature 2)
// ---------------------------------------------------------------------------
export function initTabSwitchDetection(onViolation) {
  const shouldFire = makeDebouncer(1500);

  function handleVisibility() {
    if (document.hidden && shouldFire()) onViolation('tab_switch', 'visibilitychange');
  }
  function handleBlur() {
    if (shouldFire()) onViolation('tab_switch', 'blur');
  }

  document.addEventListener('visibilitychange', handleVisibility);
  window.addEventListener('blur', handleBlur);

  return {
    stop() {
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('blur', handleBlur);
    },
  };
}

// ---------------------------------------------------------------------------
// Fullscreen enforcement (Feature 3)
// ---------------------------------------------------------------------------
export function isFullscreen() {
  return !!(document.fullscreenElement || document.webkitFullscreenElement);
}

export async function requestFullscreen() {
  const el = document.documentElement;
  const request = el.requestFullscreen || el.webkitRequestFullscreen;
  if (!request) throw new Error('Fullscreen is not supported in this browser.');
  await request.call(el);
}

/**
 * Starts watching for fullscreen exits. Only reports a violation once the
 * student has been in fullscreen and then left it — the initial gate (see
 * test.js) is what gets them INTO fullscreen in the first place.
 */
export function initFullscreenEnforcement(onViolation) {
  const shouldFire = makeDebouncer(1000);
  let armed = isFullscreen();

  function handleChange() {
    const now = isFullscreen();
    if (armed && !now && shouldFire()) {
      onViolation('fullscreen_exit');
    }
    armed = now || armed; // stays armed once they've entered fullscreen at least once
  }

  document.addEventListener('fullscreenchange', handleChange);
  document.addEventListener('webkitfullscreenchange', handleChange);

  return {
    stop() {
      document.removeEventListener('fullscreenchange', handleChange);
      document.removeEventListener('webkitfullscreenchange', handleChange);
    },
  };
}

// ---------------------------------------------------------------------------
// Webcam monitoring (Feature 1)
// ---------------------------------------------------------------------------
/** Requests camera access and attaches the stream to the given <video> element for the preview. */
export async function startWebcam(videoEl) {
  const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
  videoEl.srcObject = stream;
  await videoEl.play().catch(() => {}); // autoplay can reject harmlessly on some browsers until user-interaction; muted+playsinline covers most cases
  return stream;
}

/**
 * Watches an already-acquired webcam stream for it going away (track ended,
 * permission revoked mid-test, camera unplugged) and polls readyState as a
 * fallback since 'ended' isn't fired by every browser/OS combination.
 */
export function watchWebcamStream(stream, onViolation) {
  const shouldFire = makeDebouncer(3000);
  const [track] = stream.getVideoTracks();
  if (!track) return { stop() {} };

  function reportIfDead() {
    if (track.readyState !== 'live' && shouldFire()) {
      onViolation('webcam_off', `readyState=${track.readyState}`);
    }
  }

  track.addEventListener('ended', reportIfDead);
  const pollId = setInterval(reportIfDead, 4000);

  return {
    stop() {
      track.removeEventListener('ended', reportIfDead);
      clearInterval(pollId);
    },
  };
}
