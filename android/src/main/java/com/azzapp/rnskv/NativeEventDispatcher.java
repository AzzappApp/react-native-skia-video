package com.sheunglaili.rnskv;

public class NativeEventDispatcher {

  private long eventReceiver;


  public NativeEventDispatcher(long eventReceiver) {
    this.eventReceiver = eventReceiver;
  }

  public void dispatchEvent(String eventName, Object data) {
    nativeDispatchEvent(eventReceiver, eventName, data);
  }

  private static native void nativeDispatchEvent(long eventReceiver, String eventName, Object data);

}
