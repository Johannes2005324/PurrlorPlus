import { useState } from 'react';
import { saveDensity, useIrcMode } from './density';
import { readEffectsSetting, resolveEffects, saveEffectsSetting, saveTickerOn, useTickerOn, type EffectsSetting } from './effects';

const CHOICES: { value: EffectsSetting; label: string; hint: string }[] = [
  { value: 'auto', label: 'Auto', hint: 'Full on a machine with a graphics card, Safe where the browser draws in software or your system asks for less motion.' },
  { value: 'full', label: 'Full (GPU)', hint: 'Glass panels with blur, the shard wallpaper and animations. Looks best; wants a graphics card.' },
  { value: 'safe', label: 'Safe', hint: 'Flat panels, no wallpaper, blur or animation. The same layout and colors, light enough for an older or weaker machine.' },
];

/**
 * Appearance → Effects: how much drawing this device does (app/effects.ts), and the notification
 * ticker. Both are kept on this device only, since one account can sign in on a gaming PC and an
 * old laptop.
 */
export function EffectsSettings() {
  const [setting, setSetting] = useState<EffectsSetting>(readEffectsSetting);
  const tickerOn = useTickerOn();
  const choose = (value: EffectsSetting) => {
    setSetting(value);
    saveEffectsSetting(value);
  };
  return (
    <section className="nu-field nu-effects-settings" data-nu-role="effects-settings">
      <span className="nu-effects-settings__title">Effects</span>
      <p className="nu-field__hint">On this device only.{setting === 'auto' && ` Auto is using ${resolveEffects('auto') === 'full' ? 'Full' : 'Safe'} here.`}</p>
      <div className="nu-effects-settings__choices" role="radiogroup" aria-label="Effects">
        {CHOICES.map((choice) => (
          <label key={choice.value} className="nu-effects-settings__choice" data-nu-role={`effects-${choice.value}`}>
            <input type="radio" name="nu-effects" value={choice.value} checked={setting === choice.value} onChange={() => choose(choice.value)} />
            <span>
              <strong>{choice.label}</strong>
              <span className="nu-field__hint">{choice.hint}</span>
            </span>
          </label>
        ))}
      </div>
      <label className="nu-field__checkbox-row" data-nu-role="ticker-setting">
        <input type="checkbox" checked={tickerOn} onChange={(e) => saveTickerOn(e.target.checked)} />
        Notification ticker along the bottom
      </label>
    </section>
  );
}

/** Appearance → Layout: IRC mode (app/density.ts). On this device only, like Effects. */
export function DensitySetting() {
  const ircMode = useIrcMode();
  return (
    <section className="nu-field nu-effects-settings" data-nu-role="density-settings">
      <span className="nu-effects-settings__title">Layout</span>
      <label className="nu-field__checkbox-row" data-nu-role="irc-mode-setting">
        <input type="checkbox" checked={ircMode} onChange={(e) => saveDensity(e.target.checked ? 'irc' : 'comfortable')} />
        IRC mode
      </label>
      <p className="nu-field__hint">
        Everything tighter: an icon-only rail, narrower channel and member lists, and messages packed close with the name and
        time on one line. On this device only.
      </p>
    </section>
  );
}
