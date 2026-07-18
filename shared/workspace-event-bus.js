function createSubscriptionKey(eventType, listener) {
  return `${eventType}:${listener.toString()}`;
}

export function createWorkspaceEventBus() {
  const listenersByType = new Map();
  const subscriptionKeys = new Set();

  function subscribe(eventType, listener) {
    if (typeof eventType !== "string" || !eventType || typeof listener !== "function") {
      return () => undefined;
    }

    const subscriptionKey = createSubscriptionKey(eventType, listener);
    if (subscriptionKeys.has(subscriptionKey)) {
      return () => unsubscribe(eventType, listener);
    }

    const current = listenersByType.get(eventType) ?? new Set();
    current.add(listener);
    listenersByType.set(eventType, current);
    subscriptionKeys.add(subscriptionKey);

    return () => unsubscribe(eventType, listener);
  }

  function unsubscribe(eventType, listener) {
    const current = listenersByType.get(eventType);
    if (!current) {
      return;
    }

    current.delete(listener);
    subscriptionKeys.delete(createSubscriptionKey(eventType, listener));
    if (current.size === 0) {
      listenersByType.delete(eventType);
    }
  }

  async function publish(event) {
    const listeners = listenersByType.get(event?.type);
    if (!listeners?.size) {
      return;
    }

    for (const listener of listeners) {
      try {
        await listener(event);
      } catch (error) {
        console.error("WorkspaceEventBus listener failed", error);
      }
    }
  }

  function clear() {
    listenersByType.clear();
    subscriptionKeys.clear();
  }

  return {
    subscribe,
    unsubscribe,
    publish,
    clear
  };
}
