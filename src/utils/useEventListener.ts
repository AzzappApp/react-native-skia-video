import { useEffect } from 'react';

const useEventListener = <TEvent extends string, Thandler>(
  emitter: { on(event: TEvent, callback: Thandler): () => void } | null,
  eventName: TEvent,
  handler: any
) => {
  useEffect(
    () => (emitter && handler ? emitter.on(eventName, handler) : () => {}),
    [emitter, eventName, handler]
  );
};

export default useEventListener;
