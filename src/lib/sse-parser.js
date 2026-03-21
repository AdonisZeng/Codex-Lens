export function parseSSEStream(data) {
  if (!data || typeof data !== 'string') {
    return null;
  }

  const lines = data.split('\n');
  const event = {
    type: null,
    data: null,
    id: null,
    retry: null
  };

  for (const line of lines) {
    if (line.startsWith('event:')) {
      event.type = line.slice(6).trim();
    } else if (line.startsWith('data:')) {
      const value = line.slice(5).trim();
      try {
        event.data = JSON.parse(value);
      } catch {
        event.data = value;
      }
    } else if (line.startsWith('id:')) {
      event.id = line.slice(3).trim();
    } else if (line.startsWith('retry:')) {
      event.retry = parseInt(line.slice(7).trim(), 10);
    }
  }

  if (event.type === 'null' && !event.data) {
    return null;
  }

  return event;
}

export function parseSSELines(lines) {
  const events = [];

  for (const line of lines) {
    const event = parseSSEStream(line);
    if (event) {
      events.push(event);
    }
  }

  return events;
}

export function extractDelta(event) {
  if (!event || !event.data) return null;

  if (event.data.type === 'content_block_delta') {
    return event.data.delta;
  }

  return null;
}

export function extractToolUse(event) {
  if (!event || !event.data) return null;

  if (event.data.type === 'tool_use') {
    return event.data;
  }

  return null;
}

export function extractMessage(event) {
  if (!event || !event.data) return null;

  if (event.data.type === 'message') {
    return event.data.message;
  }

  return null;
}
