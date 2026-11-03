/**
 * Runs PyMuPDF (Pyodide) off the page's thread, so a long conversion no
 * longer freezes the window. The page sends `init` once with the engine
 * URLs it resolved (this worker has no storage or desktop bridge), then
 * `call`s by method name; results and errors come back by id. What the
 * engine prints is forwarded as `log`, which carries pdf2docx's page
 * progress.
 */

interface InitMessage {
  type: 'init';
  pymupdfUrl: string;
  ghostscriptUrl: string;
}

interface CallMessage {
  type: 'call';
  id: number;
  method: string;
  args: unknown[];
}

type Incoming = InitMessage | CallMessage;

type Engine = Record<string, (...args: unknown[]) => Promise<unknown>> & {
  load(): Promise<void>;
};

const ctx = self as unknown as {
  postMessage(message: unknown): void;
  onmessage: ((event: MessageEvent<Incoming>) => void) | null;
};

let engine: Promise<Engine> | null = null;

function forwardConsole(): void {
  for (const level of ['log', 'info', 'warn'] as const) {
    const original = console[level].bind(console);
    console[level] = (...parts: unknown[]) => {
      original(...parts);
      ctx.postMessage({ type: 'log', text: parts.map(String).join(' ') });
    };
  }
}

async function start(message: InitMessage): Promise<Engine> {
  const module = await import(
    /* @vite-ignore */ `${message.pymupdfUrl}dist/index.js`
  );
  if (typeof module.PyMuPDF !== 'function') {
    throw new Error('PyMuPDF module did not export expected PyMuPDF class.');
  }
  const instance = new module.PyMuPDF({
    assetPath: `${message.pymupdfUrl}assets/`,
    ghostscriptUrl: message.ghostscriptUrl,
  }) as Engine;
  await instance.load();
  return instance;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

ctx.onmessage = (event) => {
  const message = event.data;
  if (message.type === 'init') {
    if (!engine) {
      forwardConsole();
      engine = start(message);
    }
    engine.then(
      () => ctx.postMessage({ type: 'ready' }),
      (error) => ctx.postMessage({ type: 'failed', message: errorText(error) })
    );
    return;
  }

  const { id, method, args } = message;
  if (!engine) {
    ctx.postMessage({ type: 'error', id, message: 'Engine not started' });
    return;
  }
  engine
    .then((instance) => {
      const fn = instance[method];
      if (typeof fn !== 'function') {
        throw new Error(`PyMuPDF has no method ${method}`);
      }
      return fn.apply(instance, args);
    })
    .then(
      (result) => ctx.postMessage({ type: 'result', id, result }),
      (error) =>
        ctx.postMessage({ type: 'error', id, message: errorText(error) })
    );
};
