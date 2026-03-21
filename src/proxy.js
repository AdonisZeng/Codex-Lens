import { createServer } from 'http';
import { parseSSEStream } from './lib/sse-parser.js';
import { createLogger } from './lib/logger.js';

const DEFAULT_UPSTREAM = 'https://api.openai.com';
const PROXY_PORT = 8080;

const logger = createLogger('Proxy');

export class ProxyServer {
  constructor(wsEmitter, port = PROXY_PORT) {
    this.port = port;
    this.wsEmitter = wsEmitter;
    this.server = null;
  }

  async start() {
    return new Promise((resolve) => {
      this.server = createServer(async (req, res) => {
        const baseUrl = process.env.OPENAI_BASE_URL || DEFAULT_UPSTREAM;
        const url = new URL(req.url, baseUrl);
        const upstreamUrl = `${baseUrl}${url.pathname}${url.search}`;

        logger.info(`Incoming request: ${req.method} ${upstreamUrl}`);

        const headers = { ...req.headers };
        delete headers.host;

        const chunks = [];
        for await (const chunk of req) {
          chunks.push(chunk);
        }
        const body = chunks.length > 0 ? Buffer.concat(chunks) : null;

        const requestData = {
          timestamp: new Date().toISOString(),
          method: req.method,
          url: upstreamUrl,
          headers: headers,
          body: body ? JSON.parse(body.toString()) : null,
        };

        try {
          logger.debug(`Forwarding to upstream: ${upstreamUrl}`);

          const upstreamRes = await fetch(upstreamUrl, {
            method: req.method,
            headers: headers,
            body: body,
          });

          this.wsEmitter({
            type: 'api_request',
            data: requestData,
          });

          const responseHeaders = {};
          for (const [key, value] of upstreamRes.headers.entries()) {
            if (key.toLowerCase() !== 'content-encoding' &&
                key.toLowerCase() !== 'transfer-encoding') {
              responseHeaders[key] = value;
            }
          }

          const contentType = upstreamRes.headers.get('content-type') || '';
          const isStreaming = contentType.includes('text/event-stream') ||
                              contentType.includes('stream');

          if (isStreaming) {
            logger.debug('Streaming response detected');
            res.writeHead(upstreamRes.status, responseHeaders);

            const clonedRes = upstreamRes.body.clone();

            this.parseStream(clonedRes, (event) => {
              this.wsEmitter({ type: 'sse_event', data: event });
            });

            upstreamRes.body.pipe(res);
          } else {
            const responseBody = await upstreamRes.text();

            this.wsEmitter({
              type: 'api_response',
              data: {
                timestamp: new Date().toISOString(),
                status: upstreamRes.status,
                headers: responseHeaders,
                body: responseBody,
              },
            });

            logger.info(`Response received: ${upstreamRes.status}`);

            res.writeHead(upstreamRes.status, responseHeaders);
            res.end(responseBody);
          }
        } catch (error) {
          logger.errorWithStack('Proxy error:', error);
          res.writeHead(502, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: error.message }));
        }
      });

      this.server.listen(this.port, () => {
        logger.info(`Proxy server started on port ${this.port}`);
        resolve(this.port);
      });
    });
  }

  parseStream(stream, onEvent) {
    const decoder = new TextDecoder();
    let buffer = '';

    const reader = stream.getReader();

    const read = () => {
      reader.read().then(({ done, value }) => {
        if (done) {
          if (buffer.trim()) {
            const event = parseSSEStream(buffer);
            if (event) onEvent(event);
          }
          return;
        }

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.trim()) {
            const event = parseSSEStream(line);
            if (event) onEvent(event);
          }
        }

        read();
      });
    };

    read();
  }

  stop() {
    if (this.server) {
      this.server.close();
      logger.info('Proxy server stopped');
    }
  }
}

export function createProxyServer(wsEmitter, port) {
  return new ProxyServer(wsEmitter, port);
}
