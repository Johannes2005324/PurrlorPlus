import { useLayoutEffect, useRef, useState } from 'react';
import { useTypingMembers } from '../../matrix/hooks/useTypingMembers';
import { describeTyping, describeTypingCount, useTypingVerbs } from '../../matrix/typingVerb';
import './TypingIndicator.css';

/** "Alice is typing…", in each person's own words where they've set one — "Alice is yelling…"
 *  (their profile's typing status, matrix/typingVerb.ts). Too long for one line (long names, two
 *  people's own words, a phone's width), it's the count instead: "2 people are typing…". */
export function TypingIndicator({ roomId }: { roomId: string }) {
  const typing = useTypingMembers(roomId);
  const verbs = useTypingVerbs(typing.map((member) => member.userId));
  const textRef = useRef<HTMLSpanElement>(null);
  const [tooLong, setTooLong] = useState(false);

  const full = describeTyping(typing.map((member) => ({ name: member.name, verb: verbs[member.userId] })));
  // One person keeps their name, cut short with "…" (the CSS) if it must be.
  const text = tooLong && typing.length > 1 ? describeTypingCount(typing.length) : full;

  // Measured with the full wording each time it changes, before paint, so the long form never
  // flashes up cut off.
  useLayoutEffect(() => {
    setTooLong(false);
  }, [full]);
  useLayoutEffect(() => {
    const el = textRef.current;
    if (!tooLong && el && el.scrollWidth > el.clientWidth) setTooLong(true);
  }, [tooLong, text]);

  if (typing.length === 0) {
    return <div className="nu-typing-indicator" data-nu-role="typing-indicator" />;
  }

  return (
    <div className="nu-typing-indicator" data-nu-role="typing-indicator">
      <span ref={textRef} className="nu-typing-indicator__text" title={full}>
        {text}
      </span>
      <span className="nu-typing-indicator__dots" aria-hidden="true">
        <span className="nu-typing-indicator__dot" />
        <span className="nu-typing-indicator__dot" />
        <span className="nu-typing-indicator__dot" />
      </span>
    </div>
  );
}
