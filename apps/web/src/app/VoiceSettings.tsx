import { useCallback, useEffect, useRef, useState } from 'react';
import {
  deviceIdOrDefault,
  saveAudioSettings,
  useAudioSettings,
  type AudioSettings,
} from '../features/voice/audioSettings';
import { useKeyCapture } from '../features/voice/usePushToTalk';
import {
  keyLabel,
  saveKeybinds,
  setRebinding,
  useKeybinds,
  useRebinding,
  type Keybinds,
  type KeybindAction,
} from '../features/voice/voiceKeybinds';
import { isDesktopApp } from '../desktop/desktopBridge';
import './VoiceSettings.css';

type Devices = { inputs: MediaDeviceInfo[]; outputs: MediaDeviceInfo[]; labelled: boolean };

const canPickOutput = typeof HTMLMediaElement !== 'undefined' && 'setSinkId' in HTMLMediaElement.prototype;

/** The browser's microphones and speakers. Their names stay hidden until the page may use the mic. */
function useDevices(): [Devices, () => Promise<void>] {
  const [devices, setDevices] = useState<Devices>({ inputs: [], outputs: [], labelled: true });

  const refresh = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    const all = await navigator.mediaDevices.enumerateDevices();
    // "default" and "communications" are Chrome's aliases for a real device, listed separately;
    // the "System default" option already covers them.
    const real = (kind: MediaDeviceKind) =>
      all.filter((d) => d.kind === kind && d.deviceId && d.deviceId !== 'default' && d.deviceId !== 'communications');
    setDevices({
      inputs: real('audioinput'),
      outputs: real('audiooutput'),
      labelled: all.some((d) => d.kind === 'audioinput' && d.label),
    });
  }, []);

  useEffect(() => {
    void refresh();
    navigator.mediaDevices?.addEventListener?.('devicechange', refresh);
    return () => navigator.mediaDevices?.removeEventListener?.('devicechange', refresh);
  }, [refresh]);

  return [devices, refresh];
}

/**
 * Opens the microphone the way a call would, with the chosen device and processing, and reports
 * how loud it is (0–1). Optionally plays it back through the chosen speakers. Reopens when the
 * settings change, so switching noise suppression on and off while testing is audible.
 */
function useMicTest(settings: AudioSettings, running: boolean, hearMyself: boolean) {
  const [level, setLevel] = useState(0);
  const [error, setError] = useState<string>();
  const playback = useRef<HTMLAudioElement | null>(null);
  const { inputDeviceId, echoCancellation, noiseSuppression, autoGainControl, outputDeviceId } = settings;

  useEffect(() => {
    if (!running) return;
    let stopped = false;
    let frame = 0;
    let stream: MediaStream | undefined;
    let ctx: AudioContext | undefined;
    setError(undefined);
    navigator.mediaDevices
      .getUserMedia({
        audio: {
          ...(inputDeviceId && { deviceId: { exact: inputDeviceId } }),
          echoCancellation,
          noiseSuppression,
          autoGainControl,
        },
      })
      .then((s) => {
        stream = s;
        if (stopped) return;
        ctx = new AudioContext();
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 1024;
        ctx.createMediaStreamSource(s).connect(analyser);
        const samples = new Float32Array(analyser.fftSize);
        const tick = () => {
          analyser.getFloatTimeDomainData(samples);
          let sum = 0;
          for (const v of samples) sum += v * v;
          // RMS, scaled so ordinary speech fills most of the bar.
          setLevel(Math.min(1, Math.sqrt(sum / samples.length) * 4));
          frame = requestAnimationFrame(tick);
        };
        tick();
        if (hearMyself) {
          const audio = new Audio();
          audio.srcObject = s;
          playback.current = audio;
          const sink = canPickOutput
            ? (audio as HTMLAudioElement & { setSinkId(id: string): Promise<void> }).setSinkId(deviceIdOrDefault(outputDeviceId))
            : Promise.resolve();
          void sink.then(() => audio.play()).catch(() => undefined);
        }
      })
      .catch((err: unknown) => {
        if (!stopped) setError(err instanceof Error && err.name === 'NotAllowedError' ? 'Purrlor isn’t allowed to use the microphone.' : 'Couldn’t open that microphone.');
      });

    return () => {
      stopped = true;
      cancelAnimationFrame(frame);
      playback.current?.pause();
      playback.current = null;
      stream?.getTracks().forEach((t) => t.stop());
      void ctx?.close();
      setLevel(0);
    };
  }, [running, hearMyself, inputDeviceId, echoCancellation, noiseSuppression, autoGainControl, outputDeviceId]);

  return { level, error };
}

/** A short two-note chime through the chosen speakers. */
async function playTestSound(outputDeviceId: string): Promise<void> {
  const ctx = new AudioContext();
  const withSink = ctx as AudioContext & { setSinkId?: (id: string) => Promise<void> };
  if (outputDeviceId && withSink.setSinkId) await withSink.setSinkId(outputDeviceId);
  const gain = ctx.createGain();
  gain.connect(ctx.destination);
  [523.25, 783.99].forEach((freq, i) => {
    const start = ctx.currentTime + i * 0.18;
    const osc = ctx.createOscillator();
    osc.frequency.value = freq;
    const note = ctx.createGain();
    note.gain.setValueAtTime(0.0001, start);
    note.gain.exponentialRampToValueAtTime(0.25, start + 0.02);
    note.gain.exponentialRampToValueAtTime(0.0001, start + 0.3);
    osc.connect(note).connect(gain);
    osc.start(start);
    osc.stop(start + 0.32);
  });
  setTimeout(() => void ctx.close(), 800);
}

const BINDING_FIELD: Record<KeybindAction, keyof Keybinds> = {
  pushToTalk: 'pushToTalkKey',
  mute: 'muteKey',
  deafen: 'deafenKey',
};

/** One keybind: its key, and buttons to choose another or clear it. */
function KeybindRow({ action, label, clearable }: { action: KeybindAction; label: string; clearable: boolean }) {
  const binds = useKeybinds();
  const choosing = useRebinding() === action;
  const field = BINDING_FIELD[action];
  const bind = useCallback((binding: string) => saveKeybinds({ [field]: binding }), [field]);
  // Push-to-talk is one key you hold; the toggles can be combinations, so they don't fire while typing.
  useKeyCapture(choosing, bind, { allowCombos: action !== 'pushToTalk' });
  const binding = binds[field] as string;

  return (
    <div className="nu-voice-settings__keybind" data-nu-role={`voice-keybind-${action}`}>
      <span className="nu-voice-settings__keybind-label">{label}</span>
      <kbd className="nu-voice-settings__key">{choosing ? 'Press a key…' : keyLabel(binding)}</kbd>
      <button
        type="button"
        className="nu-button nu-button--secondary"
        onClick={() => setRebinding(choosing ? null : action)}
      >
        {choosing ? 'Cancel' : 'Change'}
      </button>
      {clearable && binding && !choosing && (
        <button type="button" className="nu-button nu-button--secondary" onClick={() => saveKeybinds({ [field]: '' })}>
          Clear
        </button>
      )}
    </div>
  );
}

function KeybindSettings() {
  const binds = useKeybinds();
  // Leaving the tab mid-choice mustn't leave every keybind paused.
  useEffect(() => () => setRebinding(null), []);

  return (
    <div className="nu-field" data-nu-role="voice-keybinds">
      Keybinds
      <label className="nu-field__checkbox-row">
        <input
          type="checkbox"
          data-nu-role="voice-settings-ptt"
          checked={binds.pushToTalk}
          onChange={(e) => saveKeybinds({ pushToTalk: e.target.checked })}
        />
        Push to talk: my mic is only on while I hold a key
      </label>
      {binds.pushToTalk && <KeybindRow action="pushToTalk" label="Hold to talk" clearable={false} />}
      <KeybindRow action="mute" label="Mute / unmute" clearable />
      <KeybindRow action="deafen" label="Deafen / undeafen" clearable />
      <span className="nu-field__hint">
        {isDesktopApp()
          ? 'These work while you’re in a call, even when Purrlor isn’t the window in front, like in a game. Purrlor only notices the keys set here.'
          : 'In a browser these work while Purrlor’s tab is in front. In the desktop app they work everywhere, in games too.'}{' '}
        A mouse’s side buttons work as well.
      </span>
    </div>
  );
}

function deviceName(d: MediaDeviceInfo, i: number, fallback: string): string {
  return d.label || `${fallback} ${i + 1}`;
}

/** Account Settings → Voice & Audio: this device's microphone, speakers, call volume and message sounds. */
export function VoiceSettings() {
  const settings = useAudioSettings();
  const [devices, refreshDevices] = useDevices();
  const [testing, setTesting] = useState(false);
  const [hearMyself, setHearMyself] = useState(false);
  const { level, error } = useMicTest(settings, testing, hearMyself);

  // Opening the mic once is what lets the browser tell us the devices' names.
  useEffect(() => {
    if (testing) void refreshDevices();
  }, [testing, refreshDevices]);

  // A device that was unplugged shows as the system default rather than a blank choice.
  const known = (id: string, list: MediaDeviceInfo[]) => (id && list.some((d) => d.deviceId === id) ? id : '');

  return (
    <div className="nu-voice-settings" data-nu-role="voice-settings">
      <p className="nu-field__hint">These apply to this device only, and to a call you’re in straight away.</p>

      <label className="nu-field">
        Microphone
        <select
          className="nu-field__input"
          data-nu-role="voice-settings-input"
          value={known(settings.inputDeviceId, devices.inputs)}
          onChange={(e) => saveAudioSettings({ inputDeviceId: e.target.value })}
        >
          <option value="">System default</option>
          {devices.inputs.map((d, i) => (
            <option key={d.deviceId} value={d.deviceId}>
              {deviceName(d, i, 'Microphone')}
            </option>
          ))}
        </select>
      </label>

      {canPickOutput && (
        <label className="nu-field">
          Speakers or headphones
          <select
            className="nu-field__input"
            data-nu-role="voice-settings-output"
            value={known(settings.outputDeviceId, devices.outputs)}
            onChange={(e) => saveAudioSettings({ outputDeviceId: e.target.value })}
          >
            <option value="">System default</option>
            {devices.outputs.map((d, i) => (
              <option key={d.deviceId} value={d.deviceId}>
                {deviceName(d, i, 'Speakers')}
              </option>
            ))}
          </select>
        </label>
      )}
      {!devices.labelled && (
        <p className="nu-field__hint">Device names show once Purrlor may use your microphone: test it below.</p>
      )}

      <div className="nu-field">
        Mic test
        <div className="nu-voice-settings__test">
          <button
            type="button"
            className={testing ? 'nu-button nu-button--secondary' : 'nu-button nu-button--primary'}
            data-nu-role="voice-settings-test"
            onClick={() => setTesting((t) => !t)}
          >
            {testing ? 'Stop' : 'Test my mic'}
          </button>
          <div className="nu-voice-settings__meter" role="meter" aria-label="Microphone level" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(level * 100)}>
            <div className="nu-voice-settings__meter-fill" style={{ width: `${level * 100}%` }} />
          </div>
        </div>
        <label className="nu-field__checkbox-row">
          <input type="checkbox" checked={hearMyself} onChange={(e) => setHearMyself(e.target.checked)} />
          Let me hear myself (use headphones)
        </label>
        {error && <p className="nu-field__error">{error}</p>}
      </div>

      <div className="nu-field">
        Voice processing
        <label className="nu-field__checkbox-row">
          <input
            type="checkbox"
            data-nu-role="voice-settings-noise"
            checked={settings.noiseSuppression}
            onChange={(e) => saveAudioSettings({ noiseSuppression: e.target.checked })}
          />
          Noise suppression
        </label>
        <label className="nu-field__checkbox-row">
          <input
            type="checkbox"
            checked={settings.echoCancellation}
            onChange={(e) => saveAudioSettings({ echoCancellation: e.target.checked })}
          />
          Echo cancellation
        </label>
        <label className="nu-field__checkbox-row">
          <input
            type="checkbox"
            checked={settings.autoGainControl}
            onChange={(e) => saveAudioSettings({ autoGainControl: e.target.checked })}
          />
          Automatic volume for my mic
        </label>
        <span className="nu-field__hint">
          Turn these off for music or a good studio mic: they’re tuned for speech and can make
          instruments sound thin.
        </span>
      </div>

      <label className="nu-field">
        Everyone’s volume: {Math.round(settings.outputVolume * 100)}%
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          data-nu-role="voice-settings-volume"
          value={settings.outputVolume}
          onChange={(e) => saveAudioSettings({ outputVolume: Number(e.target.value) })}
        />
        <span className="nu-field__hint">Each person’s own slider in a call adjusts them on top of this.</span>
      </label>

      <div className="nu-field" data-nu-role="message-sounds">
        Message sounds
        <label className="nu-field__checkbox-row">
          <input
            type="checkbox"
            data-nu-role="message-sound-sent"
            checked={settings.messageSentSound}
            onChange={(e) => saveAudioSettings({ messageSentSound: e.target.checked })}
          />
          A blip when my message is sent
        </label>
        <label className="nu-field__checkbox-row">
          <input
            type="checkbox"
            data-nu-role="message-sound-received"
            checked={settings.messageReceivedSound}
            onChange={(e) => saveAudioSettings({ messageReceivedSound: e.target.checked })}
          />
          A blip when a message comes in
        </label>
        <span className="nu-field__hint">
          Played by Purrlor’s tab itself, so they work without desktop notifications. Incoming ones
          follow your notification settings: a muted channel stays quiet.
        </span>
      </div>

      <KeybindSettings />

      <div className="nu-field">
        <button type="button" className="nu-button nu-button--secondary" onClick={() => void playTestSound(settings.outputDeviceId)}>
          Play a test sound
        </button>
      </div>
    </div>
  );
}
