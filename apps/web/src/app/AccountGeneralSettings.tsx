import { useEffect, useState, type FormEvent } from 'react';
import { useSetAtom } from 'jotai';
import { welcomeGuideOpenAtom } from './state/onboarding';
import { Avatar } from '../components/Avatar';
import { BackgroundPushSettings } from './BackgroundPushSettings';
import { InstallAppSettings } from './InstallAppSettings';
import { KeywordNotificationSettings } from './KeywordNotificationSettings';
import { PostNotificationSettings } from './PostNotificationSettings';
import { useMatrixClient } from '../matrix/MatrixClientContext';
import {
  loadOwnPresence,
  removeAccountBanner,
  updateAccountAvatar,
  updateAccountBanner,
  updateDisplayName,
  updateOwnPresence,
  type UserPresence,
} from '../matrix/account';
import { updateExtendedProfile } from '../matrix/extendedProfile';
import { NAME_COLOR_PRESETS, nameColorStyle, rememberNameColor, sanitizeNameColor } from '../matrix/nameColor';
import { nameHue } from '../components/Avatar';
import {
  DEFAULT_TYPING_VERB,
  describeTyping,
  rememberTypingVerb,
  sanitizeTypingVerb,
  TYPING_VERB_MAX_LENGTH,
} from '../matrix/typingVerb';
import { useExtendedProfile } from '../matrix/hooks/useExtendedProfile';
import { useMediaUrl } from '../matrix/hooks/useMediaUrl';
import { useOwnPresence } from '../matrix/hooks/useOwnPresence';
import { useOwnProfile } from '../matrix/hooks/useOwnProfile';
import { getNotificationPermission, requestNotificationPermission, type NotificationSupport } from '../matrix/notifications';

const BIO_MAX_LENGTH = 400;

const PRESENCE_OPTIONS: { value: UserPresence; label: string }[] = [
  { value: 'online', label: '🟢 Online' },
  { value: 'unavailable', label: '🌙 Away' },
  { value: 'offline', label: '⚪ Invisible' },
];

function notificationStatusLabel(status: NotificationSupport): string {
  if (status === 'unsupported') return 'Not supported in this browser';
  if (status === 'granted') return 'Enabled';
  if (status === 'denied') return 'Blocked — allow notifications for this site in your browser settings';
  return 'Not enabled';
}

export function AccountGeneralSettings({ onClose }: { onClose: () => void }) {
  const openWelcomeGuide = useSetAtom(welcomeGuideOpenAtom);
  const mx = useMatrixClient();
  const profile = useOwnProfile();
  const ownPresence = useOwnPresence();
  const { profile: extendedProfile, loading: extendedProfileLoading } = useExtendedProfile(profile.userId);
  // The profile and presence arrive after the form opens (useOwnProfile starts on the fallback
  // handle; after a while away the client may have no presence for you yet). Each field fills in
  // once they do, unless already edited, and only an edited field is saved: the form used to
  // start on the handle and an empty status and write them back, resetting both.
  const [name, setName] = useState(profile.displayName);
  const [nameTouched, setNameTouched] = useState(false);
  const [avatarFile, setAvatarFile] = useState<File>();
  const [bannerFile, setBannerFile] = useState<File>();
  const [removeBanner, setRemoveBanner] = useState(false);
  const [bio, setBio] = useState('');
  const [bioTouched, setBioTouched] = useState(false);
  const [typingVerb, setTypingVerb] = useState('');
  const [typingVerbTouched, setTypingVerbTouched] = useState(false);
  const [nameColor, setNameColor] = useState('');
  const [nameColorTouched, setNameColorTouched] = useState(false);
  const [presence, setPresence] = useState<UserPresence>(() => (ownPresence.presence as UserPresence) || 'online');
  const [presenceTouched, setPresenceTouched] = useState(false);
  const [statusMsg, setStatusMsg] = useState(() => ownPresence.statusMsg ?? '');
  const [statusTouched, setStatusTouched] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();
  const [notificationStatus, setNotificationStatus] = useState<NotificationSupport>(getNotificationPermission);
  const bannerPreviewUrl = useMediaUrl(bannerFile ? null : extendedProfile.bannerUrl, { width: 600, height: 180, method: 'crop' });

  useEffect(() => {
    if (!nameTouched) setName(profile.displayName);
  }, [profile.displayName, nameTouched]);
  useEffect(() => {
    void loadOwnPresence(mx);
  }, [mx]);
  useEffect(() => {
    if (!presenceTouched && ownPresence.presence) setPresence(ownPresence.presence as UserPresence);
    if (!statusTouched) setStatusMsg(ownPresence.statusMsg ?? '');
  }, [ownPresence.presence, ownPresence.statusMsg, presenceTouched, statusTouched]);

  // The fetch is async (see useExtendedProfile.ts) — prefill the bio textarea once it resolves,
  // but only if the user hasn't already started typing, so a slow fetch can't stomp on a draft.
  useEffect(() => {
    if (!bioTouched && extendedProfile.bio) setBio(extendedProfile.bio);
  }, [extendedProfile.bio, bioTouched]);
  useEffect(() => {
    if (!typingVerbTouched && extendedProfile.typingVerb) setTypingVerb(sanitizeTypingVerb(extendedProfile.typingVerb));
  }, [extendedProfile.typingVerb, typingVerbTouched]);
  useEffect(() => {
    if (!nameColorTouched && extendedProfile.nameColor) setNameColor(sanitizeNameColor(extendedProfile.nameColor));
  }, [extendedProfile.nameColor, nameColorTouched]);

  const chooseNameColor = (color: string) => {
    setNameColor(color);
    setNameColorTouched(true);
  };
  const previewName = name.trim() || profile.displayName || 'You';
  const customNameColor = nameColor && !(NAME_COLOR_PRESETS as readonly string[]).includes(nameColor);

  const handleEnableNotifications = async () => {
    setNotificationStatus(await requestNotificationPermission());
  };

  const handleSubmit = async (evt: FormEvent) => {
    evt.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError(undefined);
    try {
      const tasks: Promise<void>[] = [];
      if (avatarFile) tasks.push(updateAccountAvatar(mx, avatarFile));
      if (bannerFile) tasks.push(updateAccountBanner(mx, bannerFile));
      else if (removeBanner) tasks.push(removeAccountBanner(mx));
      const trimmedName = name.trim();
      if (nameTouched && trimmedName && trimmedName !== profile.displayName) tasks.push(updateDisplayName(mx, trimmedName));
      const trimmedBio = bio.trim();
      if (bioTouched && trimmedBio !== (extendedProfile.bio ?? '')) {
        tasks.push(updateExtendedProfile(mx, { bio: trimmedBio || null }));
      }
      const cleanVerb = sanitizeTypingVerb(typingVerb);
      if (typingVerbTouched && cleanVerb !== sanitizeTypingVerb(extendedProfile.typingVerb)) {
        // Saying "typing" is the same as not setting one, so it's stored as no value at all.
        const stored = cleanVerb === DEFAULT_TYPING_VERB ? '' : cleanVerb;
        tasks.push(
          updateExtendedProfile(mx, { typingVerb: stored || null }).then(() => rememberTypingVerb(profile.userId, stored))
        );
      }
      if (nameColorTouched && nameColor !== sanitizeNameColor(extendedProfile.nameColor)) {
        tasks.push(
          updateExtendedProfile(mx, { nameColor: nameColor || null }).then(() => rememberNameColor(profile.userId, nameColor))
        );
      }
      const trimmedStatus = statusMsg.trim();
      const presenceChanged = presenceTouched && presence !== ownPresence.presence;
      const statusChanged = statusTouched && trimmedStatus !== (ownPresence.statusMsg ?? '');
      if (presenceChanged || statusChanged) {
        tasks.push(updateOwnPresence(mx, presence, statusChanged ? trimmedStatus : undefined));
      }
      await Promise.all(tasks);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save changes');
      setSubmitting(false);
    }
  };

  return (
    <form className="nu-modal-form" onSubmit={handleSubmit}>
      <div
        className="nu-account-settings__banner"
        style={bannerPreviewUrl ? { backgroundImage: `url(${bannerPreviewUrl})` } : undefined}
        data-nu-role="account-settings-banner-preview"
      >
        <div className="nu-account-settings__banner-actions">
          <label className="nu-button nu-button--secondary nu-file-picker">
            {bannerFile ? bannerFile.name : bannerPreviewUrl ? 'Change banner' : 'Add banner'}
            <input
              type="file"
              accept="image/*"
              data-nu-role="account-settings-banner-input"
              onChange={(e) => {
                setBannerFile(e.target.files?.[0]);
                setRemoveBanner(false);
              }}
            />
          </label>
          {(bannerPreviewUrl || bannerFile) && !removeBanner && (
            <button
              type="button"
              className="nu-button nu-button--secondary"
              data-nu-role="account-settings-banner-remove"
              onClick={() => {
                setBannerFile(undefined);
                setRemoveBanner(true);
              }}
            >
              Remove
            </button>
          )}
        </div>
      </div>
      <div className="nu-account-settings__avatar-row">
        <Avatar name={name || profile.displayName} mxcUrl={avatarFile ? null : profile.avatarUrl} size={56} />
        <label className="nu-button nu-button--secondary nu-file-picker nu-account-settings__avatar-picker">
          {avatarFile ? avatarFile.name : 'Change avatar'}
          <input
            type="file"
            accept="image/*"
            onChange={(e) => setAvatarFile(e.target.files?.[0])}
          />
        </label>
        <span className="nu-field__hint">GIF or animated WEBP avatars animate for everyone.</span>
      </div>
      <label className="nu-field">
        Display name
        <input
          className="nu-field__input"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setNameTouched(true);
          }}
          required
        />
      </label>
      <label className="nu-field">
        Matrix ID
        <input className="nu-field__input" value={profile.userId} disabled />
      </label>
      <label className="nu-field">
        Bio
        <textarea
          className="nu-field__input nu-account-settings__bio-input"
          data-nu-role="account-settings-bio"
          value={bio}
          onChange={(e) => {
            setBio(e.target.value);
            setBioTouched(true);
          }}
          placeholder={extendedProfileLoading ? 'Loading…' : "Tell people a bit about yourself"}
          maxLength={BIO_MAX_LENGTH}
          rows={3}
        />
        <span className="nu-field__hint">
          {bio.length}/{BIO_MAX_LENGTH}
        </span>
      </label>
      <label className="nu-field">
        Typing status
        <input
          className="nu-field__input"
          data-nu-role="account-settings-typing-verb"
          value={typingVerb}
          onChange={(e) => {
            setTypingVerb(e.target.value);
            setTypingVerbTouched(true);
          }}
          placeholder={extendedProfileLoading ? 'Loading…' : DEFAULT_TYPING_VERB}
          maxLength={TYPING_VERB_MAX_LENGTH + 4}
          autoComplete="off"
        />
        <span className="nu-field__hint" data-nu-role="account-settings-typing-preview">
          Others see: {describeTyping([{ name: name.trim() || profile.displayName || 'You', verb: sanitizeTypingVerb(typingVerb) }])}
        </span>
      </label>
      <div className="nu-field" data-nu-role="account-settings-name-color">
        Name color
        <div className="nu-account-settings__name-colors" role="radiogroup" aria-label="Name color">
          <button
            type="button"
            role="radio"
            aria-checked={!nameColor}
            className="nu-account-settings__name-color nu-account-settings__name-color--auto"
            data-nu-role="account-settings-name-color-auto"
            title="Automatic (picked from your name)"
            aria-label="Automatic"
            style={{ ['--nu-swatch' as string]: `hsl(${nameHue(previewName)}, 70%, 78%)` }}
            onClick={() => chooseNameColor('')}
          >
            A
          </button>
          {NAME_COLOR_PRESETS.map((color) => (
            <button
              key={color}
              type="button"
              role="radio"
              aria-checked={nameColor === color}
              className="nu-account-settings__name-color"
              data-nu-role="account-settings-name-color-preset"
              title={color}
              aria-label={color}
              style={{ ['--nu-swatch' as string]: color }}
              onClick={() => chooseNameColor(color)}
            />
          ))}
          <label
            className={
              customNameColor
                ? 'nu-account-settings__name-color nu-account-settings__name-color--custom nu-account-settings__name-color--selected'
                : 'nu-account-settings__name-color nu-account-settings__name-color--custom'
            }
            title="Pick any color"
            style={customNameColor ? { ['--nu-swatch' as string]: nameColor } : undefined}
          >
            <span aria-hidden="true">+</span>
            <input
              type="color"
              data-nu-role="account-settings-name-color-custom"
              aria-label="Pick any color"
              value={nameColor || '#ffffff'}
              onChange={(e) => chooseNameColor(sanitizeNameColor(e.target.value))}
            />
          </label>
        </div>
        <span className="nu-field__hint" data-nu-role="account-settings-name-color-preview">
          In chat:{' '}
          <strong style={{ color: nameColorStyle(nameColor || `hsl(${nameHue(previewName)}, 70%, 78%)`) }}>{previewName}</strong>
          {' '}· a role's color still shows instead, if you have one.
        </span>
      </div>
      <label className="nu-field">
        Status
        <select
          className="nu-field__input"
          data-nu-role="account-settings-presence"
          value={presence}
          onChange={(e) => {
            setPresence(e.target.value as UserPresence);
            setPresenceTouched(true);
          }}
        >
          {PRESENCE_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </label>
      <label className="nu-field">
        Custom status message
        <input
          className="nu-field__input"
          data-nu-role="account-settings-status-msg"
          value={statusMsg}
          onChange={(e) => {
            setStatusMsg(e.target.value);
            setStatusTouched(true);
          }}
          placeholder="What's on your mind?"
          maxLength={256}
        />
      </label>
      <div className="nu-field">
        Desktop notifications
        <div className="nu-account-settings__notifications">
          <span className="nu-field__hint">{notificationStatusLabel(notificationStatus)}</span>
          {notificationStatus === 'default' && (
            <button
              type="button"
              className="nu-button nu-button--secondary"
              data-nu-role="account-settings-enable-notifications"
              onClick={handleEnableNotifications}
            >
              Enable
            </button>
          )}
        </div>
      </div>
      <InstallAppSettings />
      <BackgroundPushSettings />
      <PostNotificationSettings />
      <KeywordNotificationSettings />
      <div className="nu-field" data-nu-role="account-settings-welcome">
        Getting started
        <p className="nu-field__hint">The short tour new accounts get: joining Spaces, and what's where.</p>
        <button
          type="button"
          className="nu-button nu-button--secondary"
          data-nu-role="account-settings-show-welcome"
          onClick={() => {
            openWelcomeGuide(true);
            onClose();
          }}
        >
          Show the welcome guide
        </button>
      </div>
      {error && (
        <p className="nu-field__error" data-nu-role="account-settings-error">
          {error}
        </p>
      )}
      <div className="nu-form-actions">
        <button type="button" className="nu-button nu-button--secondary" onClick={onClose}>
          Cancel
        </button>
        <button type="submit" className="nu-button nu-button--primary" disabled={submitting}>
          {submitting ? 'Saving…' : 'Save'}
        </button>
      </div>
    </form>
  );
}
