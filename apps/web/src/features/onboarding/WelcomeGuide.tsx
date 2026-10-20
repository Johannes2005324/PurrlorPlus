import { useRef, useState, type ChangeEvent } from 'react';
import { useSetAtom } from 'jotai';
import type { Room } from 'matrix-js-sdk';
import { railSectionAtom, profileUserIdAtom, selectedRoomIdAtom, selectedSpaceIdAtom } from '../../app/state/selection';
import { Avatar } from '../../components/Avatar';
import { Icon, type IconName } from '../../components/Icon';
import { Modal } from '../../components/Modal';
import { useMatrixClient } from '../../matrix/MatrixClientContext';
import { useOwnProfile } from '../../matrix/hooks/useOwnProfile';
import { markOnboardingDone } from '../../matrix/onboarding';
import { CreateSpaceModal } from '../servers/CreateSpaceModal';
import { JoinWithLink, PublicSpacesToJoin, useOpenJoined } from './JoinSpace';
import './Onboarding.css';

/**
 * The welcome guide: four short steps for someone new (matrix/onboarding.ts decides who). Who you
 * are, joining a Space (this server's public ones, an invite link, or your own), what's where on
 * screen, and where to go next. Every step can be skipped, and closing it at any point counts as
 * having seen it; Account Settings opens it again.
 */

type Step = 'you' | 'spaces' | 'tour' | 'done';
const STEPS: Step[] = ['you', 'spaces', 'tour', 'done'];

function ProfileStep() {
  const mx = useMatrixClient();
  const profile = useOwnProfile();
  const [name, setName] = useState(profile.displayName);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const fileRef = useRef<HTMLInputElement>(null);

  const saveName = async () => {
    const next = name.trim();
    if (!next || next === profile.displayName) return;
    setBusy(true);
    try {
      await mx.setDisplayName(next);
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Couldn’t save your name');
    } finally {
      setBusy(false);
    }
  };

  const pickPicture = async (evt: ChangeEvent<HTMLInputElement>) => {
    const file = evt.target.files?.[0];
    evt.target.value = '';
    if (!file) return;
    setBusy(true);
    setError(undefined);
    try {
      const { content_uri: url } = await mx.uploadContent(file, { name: file.name, type: file.type });
      await mx.setAvatarUrl(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Couldn’t upload that picture');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="nu-onboarding__step" data-nu-role="welcome-step-you">
      <p className="nu-onboarding__lead">Purrlor is a place for your communities: chat, voice, posts and profile pages. First, how people will see you.</p>
      <div className="nu-onboarding__you">
        <button type="button" className="nu-onboarding__avatar" onClick={() => fileRef.current?.click()} disabled={busy} title="Choose a picture">
          <Avatar name={profile.displayName || profile.userId} mxcUrl={profile.avatarUrl} size={72} />
          <span className="nu-onboarding__avatar-edit">
            <Icon name="camera" size={14} />
          </span>
        </button>
        <input ref={fileRef} type="file" accept="image/*" hidden onChange={(evt) => void pickPicture(evt)} />
        <label className="nu-field nu-onboarding__name">
          Your name
          <input
            className="nu-field__input"
            data-nu-role="welcome-name"
            value={name}
            maxLength={100}
            onChange={(evt) => {
              setName(evt.target.value);
              setSaved(false);
            }}
            onBlur={() => void saveName()}
          />
          <span className="nu-field__hint">{saved ? 'Saved.' : `People can also find you as @${profile.userId.slice(1).split(':')[0]}.`}</span>
        </label>
      </div>
      {error && <p className="nu-field__error">{error}</p>}
    </div>
  );
}

const TOUR: { icon: IconName; title: string; text: string }[] = [
  { icon: 'paw', title: 'Home', text: 'Your direct messages and group chats. Someone writes to you and they get a bubble of their own here.' },
  { icon: 'globe', title: 'Global feed', text: 'Posts from everyone on this server (and servers it links up with), and your own profile page.' },
  { icon: 'hash', title: 'Spaces and channels', text: 'Each Space is a community. Its channels list beside it: # for text, a speaker for voice. Click a voice channel to join the call. Drag Spaces into your own order.' },
  { icon: 'bell', title: 'Notifications', text: 'Mentions, replies, likes and photo tags, all in one place.' },
  { icon: 'compass', title: 'Discover', text: 'Find more public Spaces to join. Invites from people land just above it.' },
  { icon: 'settings', title: 'Settings', text: 'The gear by your name: your profile, notifications on your phone, how the app looks, and your data.' },
];

export function WelcomeGuide({ onClose }: { onClose: () => void }) {
  const mx = useMatrixClient();
  const [step, setStep] = useState<Step>('you');
  const [joined, setJoined] = useState<Room[]>([]);
  const [creating, setCreating] = useState(false);
  const openJoined = useOpenJoined();
  const setSpace = useSetAtom(selectedSpaceIdAtom);
  const setRoom = useSetAtom(selectedRoomIdAtom);
  const setFeedOpen = useSetAtom(railSectionAtom);
  const setProfile = useSetAtom(profileUserIdAtom);
  const index = STEPS.indexOf(step);

  const finish = (then?: () => void) => {
    void markOnboardingDone(mx).catch(() => undefined);
    onClose();
    if (then) then();
    else if (joined[0]) openJoined(joined[0]);
  };

  const noteJoined = (room: Room) => setJoined((prev) => (prev.some((r) => r.roomId === room.roomId) ? prev : [...prev, room]));

  if (creating) {
    return (
      <CreateSpaceModal
        onClose={() => setCreating(false)}
        onCreated={(roomId) => {
          setCreating(false);
          finish(() => {
            setFeedOpen('messages');
            setProfile(null);
            setSpace(roomId);
            setRoom(null);
          });
        }}
      />
    );
  }

  return (
    <Modal title={step === 'you' ? 'Welcome to Purrlor' : step === 'spaces' ? 'Join a Space' : step === 'tour' ? 'Finding your way around' : 'You’re all set'} onClose={() => finish()} wide>
      <div className="nu-onboarding" data-nu-role="welcome-guide">
        <ol className="nu-onboarding__dots" aria-label={`Step ${index + 1} of ${STEPS.length}`}>
          {STEPS.map((s, i) => (
            <li key={s} className={i <= index ? 'nu-onboarding__dot nu-onboarding__dot--on' : 'nu-onboarding__dot'} />
          ))}
        </ol>

        {step === 'you' && <ProfileStep />}

        {step === 'spaces' && (
          <div className="nu-onboarding__step" data-nu-role="welcome-step-spaces">
            <p className="nu-onboarding__lead">
              Spaces are communities, each with its own channels, voice rooms and posts. Join one or two to get started.
            </p>
            <PublicSpacesToJoin onJoined={noteJoined} />
            <JoinWithLink onJoined={noteJoined} />
            <p className="nu-field__hint">
              Or{' '}
              <button type="button" className="nu-onboarding__link" data-nu-role="welcome-create-space" onClick={() => setCreating(true)}>
                start your own Space
              </button>{' '}
              and invite your friends.
            </p>
            {joined.length > 0 && (
              <p className="nu-onboarding__joined" role="status" data-nu-role="welcome-joined">
                <Icon name="check" size={14} /> Joined {joined.map((room) => room.name).join(', ')}.
              </p>
            )}
          </div>
        )}

        {step === 'tour' && (
          <div className="nu-onboarding__step" data-nu-role="welcome-step-tour">
            <p className="nu-onboarding__lead">The column on the far left takes you everywhere:</p>
            <ul className="nu-onboarding__tour">
              {TOUR.map((item) => (
                <li key={item.title} className="nu-onboarding__tour-item">
                  <span className="nu-onboarding__tour-icon" aria-hidden="true">
                    <Icon name={item.icon} size={20} />
                  </span>
                  <span>
                    <strong>{item.title}.</strong> {item.text}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {step === 'done' && (
          <div className="nu-onboarding__step" data-nu-role="welcome-step-done">
            <p className="nu-onboarding__lead">
              {joined.length > 0 ? `${joined[0].name} is waiting for you.` : 'Join a Space whenever you’re ready: Discover is the compass in the left column.'}
            </p>
            <ul className="nu-onboarding__tips">
              <li>
                <strong>Make your profile yours.</strong> Your profile has a page you can decorate: colours, music, art, friends.{' '}
                <button
                  type="button"
                  className="nu-onboarding__link"
                  onClick={() =>
                    finish(() => {
                      setFeedOpen('feed');
                      setProfile(mx.getUserId());
                    })
                  }
                >
                  Open my profile
                </button>
              </li>
              <li>
                <strong>Get notified on your phone.</strong> Account Settings → Account → Background push notifications.
              </li>
              <li>
                <strong>Mention someone</strong> with @ and their name; <strong>react</strong> by hovering a message.
              </li>
              <li>
                <strong>Keep your recovery key safe.</strong> It’s the only way to read your encrypted messages on a new device.
              </li>
            </ul>
          </div>
        )}

        <div className="nu-onboarding__actions">
          {index > 0 && (
            <button type="button" className="nu-button nu-button--secondary" onClick={() => setStep(STEPS[index - 1])}>
              Back
            </button>
          )}
          <span className="nu-onboarding__spacer" />
          {step !== 'done' && (
            <button type="button" className="nu-onboarding__skip" data-nu-role="welcome-skip" onClick={() => finish()}>
              Skip
            </button>
          )}
          {step === 'done' ? (
            <button type="button" className="nu-button nu-button--primary" data-nu-role="welcome-finish" onClick={() => finish()}>
              {joined.length > 0 ? `Go to ${joined[0].name}` : 'Start exploring'}
            </button>
          ) : (
            <button type="button" className="nu-button nu-button--primary" data-nu-role="welcome-next" onClick={() => setStep(STEPS[index + 1])}>
              Next
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}
