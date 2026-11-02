package com.azzapp.rnskv;

public class NativeEventDispatcher {

  private long eventReceiver;


  public NativeEventDispatcher(long eventReceiver) {
    this.eventReceiver = eventReceiver;
  }

  public synchronized void dispatchEvent(String eventName, Object data) {
    if (eventReceiver == 0) {
      return;
    }
    nativeDispatchEvent(eventReceiver, eventName, data);
  }

  /**
   * Stops the dispatch of events before the receiver is destroyed: an event
   * being dispatched completes before this returns, the next ones are dropped.
   */
  public synchronized void invalidate() {
    eventReceiver = 0;
  }

  private static native void nativeDispatchEvent(long eventReceiver, String eventName, Object data);

}
