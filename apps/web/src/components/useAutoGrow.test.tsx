import { useRef, useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useAutoGrow } from './useAutoGrow';

function Box({ initial }: { initial: string }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [text, setText] = useState(initial);
  useAutoGrow(ref, text);
  return <textarea ref={ref} data-testid="box" value={text} onChange={(e) => setText(e.target.value)} />;
}

// jsdom lays nothing out: here each line of text is 20px tall, and the border 2px.
const proto = HTMLTextAreaElement.prototype;
const layout = ['scrollHeight', 'offsetHeight', 'clientHeight'] as const;

describe('useAutoGrow', () => {
  beforeEach(() => {
    Object.defineProperties(proto, {
      scrollHeight: { configurable: true, get: (function (this: HTMLTextAreaElement) { return this.value.split('\n').length * 20; }) },
      offsetHeight: { configurable: true, get: () => 22 },
      clientHeight: { configurable: true, get: () => 20 },
    });
  });
  afterEach(() => {
    for (const key of layout) delete (proto as unknown as Record<string, unknown>)[key];
  });

  it('fits the box to its text, border included, and shrinks it again', () => {
    render(<Box initial="one line" />);
    const box = screen.getByTestId('box') as HTMLTextAreaElement;
    expect(box.style.height).toBe('22px');
    fireEvent.change(box, { target: { value: 'one\ntwo\nthree' } });
    expect(box.style.height).toBe('62px');
    fireEvent.change(box, { target: { value: 'back to one' } });
    expect(box.style.height).toBe('22px');
  });
});
