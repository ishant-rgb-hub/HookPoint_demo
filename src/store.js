'use strict';

/**
 * In-memory storage for evaluated incoming events and mock test state.
 */
class AppStore {
  constructor() {
    /** @type {Array<object>} */
    this.inboundEvents = [];
    this.maxInboundEvents = 500;
    /** @type {Map<string, number>} */
    this.mockCounters = new Map();
  }

  /**
   * Log an incoming verified webhook.
   */
  addInboundEvent(event) {
    if (this.inboundEvents.length >= this.maxInboundEvents) {
      this.inboundEvents.shift();
    }
    const record = {
      id: event.eventId || `inb_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      eventId: event.eventId || null,
      event: event.event || 'unknown',
      payload: event.payload,
      timestamp: event.timestamp || null,
      receivedAt: Date.now(),
      headers: {
        'x-webhook-signature': event.headers?.['x-webhook-signature'] || event.headers?.['X-Webhook-Signature'],
        'x-webhook-id': event.headers?.['x-webhook-id'] || event.headers?.['X-Webhook-Id'],
        'x-webhook-event': event.headers?.['x-webhook-event'] || event.headers?.['X-Webhook-Event'],
        'content-type': event.headers?.['content-type']
      }
    };
    this.inboundEvents.push(record);
    return record;
  }

  /**
   * Query inbound events with pagination.
   */
  getInboundEvents(options = {}) {
    let list = [...this.inboundEvents].reverse();
    if (options.event) {
      list = list.filter((e) => e.event === options.event);
    }
    const limit = options.limit ? parseInt(options.limit, 10) : 50;
    const offset = options.offset ? parseInt(options.offset, 10) : 0;
    return {
      total: list.length,
      events: list.slice(offset, offset + limit)
    };
  }

  /**
   * Clear inbound events.
   */
  clearInboundEvents() {
    this.inboundEvents = [];
  }

  /**
   * Increment and return mock counter for simulating transient failures.
   */
  incrementMockCounter(key) {
    const val = (this.mockCounters.get(key) || 0) + 1;
    this.mockCounters.set(key, val);
    return val;
  }

  resetMockCounter(key) {
    this.mockCounters.delete(key);
  }
}

module.exports = {
  AppStore,
  defaultStore: new AppStore()
};
