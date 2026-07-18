import { EventEmitter, once } from "node:events";
import {
  createCodexUpstreamError,
  redactCodexDiagnostic,
  toCodexUpstreamError
} from "../../shared/codex-upstream-contracts.js";

const DEFAULT_MAX_MESSAGE_BYTES = 4 * 1024 * 1024;
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export class CodexAppServerJsonRpcClient {
  constructor(options) {
    if (!options?.readable || !options?.writable) {
      throw new TypeError("CodexAppServerJsonRpcClient requires readable and writable streams.");
    }
    this.readable = options.readable;
    this.writable = options.writable;
    this.maxMessageBytes = options.maxMessageBytes ?? DEFAULT_MAX_MESSAGE_BYTES;
    this.requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    this.onDiagnostic = options.onDiagnostic ?? (() => undefined);
    this.events = new EventEmitter();
    this.pending = new Map();
    this.buffer = "";
    this.nextRequestId = 1;
    this.closed = false;
    this.serverRequestHandler = null;
    this.onData = (chunk) => this.handleData(chunk);
    this.onEnd = () => this.closeWithError(createCodexUpstreamError(
      "CODEX_APP_SERVER_CLOSED",
      "Codex App Server stdout closed."
    ));
    this.onError = (cause) => this.closeWithError(toCodexUpstreamError(cause, "CODEX_APP_SERVER_CLOSED"));
    this.readable.on("data", this.onData);
    this.readable.on("end", this.onEnd);
    this.readable.on("error", this.onError);
    this.writable.on("error", this.onError);
  }

  subscribe(listener) {
    this.events.on("notification", listener);
    return () => this.events.off("notification", listener);
  }

  subscribeUnknown(listener) {
    this.events.on("unknown", listener);
    return () => this.events.off("unknown", listener);
  }

  setServerRequestHandler(handler) {
    this.serverRequestHandler = typeof handler === "function" ? handler : null;
  }

  request(method, params, options = {}) {
    if (this.closed) {
      return Promise.reject(createCodexUpstreamError("CODEX_APP_SERVER_CLOSED", "JSON-RPC client is closed."));
    }
    if (typeof method !== "string" || !method) {
      return Promise.reject(createCodexUpstreamError("CODEX_APP_SERVER_PROTOCOL_ERROR", "Missing JSON-RPC method."));
    }

    const id = this.nextRequestId++;
    const timeoutMs = options.timeoutMs ?? this.requestTimeoutMs;
    return new Promise((resolve, reject) => {
      let timeoutId = null;
      const onAbort = () => {
        this.finishPending(id, createCodexUpstreamError("CODEX_APP_SERVER_CLOSED", `Request ${method} was aborted.`));
      };
      const cleanup = () => {
        if (timeoutId) clearTimeout(timeoutId);
        options.signal?.removeEventListener("abort", onAbort);
      };
      this.pending.set(id, { resolve, reject, cleanup, method });

      if (options.signal?.aborted) {
        onAbort();
        return;
      }
      options.signal?.addEventListener("abort", onAbort, { once: true });
      timeoutId = setTimeout(() => {
        this.finishPending(id, createCodexUpstreamError(
          "CODEX_APP_SERVER_TIMEOUT",
          `JSON-RPC request ${method} timed out after ${timeoutMs}ms.`,
          { retriable: true, details: { method, timeoutMs } }
        ));
      }, timeoutMs);

      this.writeMessage({ method, id, ...(params === undefined ? {} : { params }) }).catch((cause) => {
        this.finishPending(id, toCodexUpstreamError(cause));
      });
    });
  }

  async notify(method, params) {
    await this.writeMessage({ method, ...(params === undefined ? {} : { params }) });
  }

  async respond(id, result) {
    await this.writeMessage({ id, result });
  }

  async respondError(id, code, message) {
    await this.writeMessage({ id, error: { code, message } });
  }

  async writeMessage(message) {
    if (this.closed) {
      throw createCodexUpstreamError("CODEX_APP_SERVER_CLOSED", "Cannot write to a closed JSON-RPC client.");
    }
    const line = `${JSON.stringify(message)}\n`;
    if (Buffer.byteLength(line, "utf8") > this.maxMessageBytes) {
      throw createCodexUpstreamError("CODEX_APP_SERVER_PROTOCOL_ERROR", "Outgoing JSON-RPC message exceeds the limit.");
    }
    if (!this.writable.write(line, "utf8")) {
      await once(this.writable, "drain");
    }
  }

  handleData(chunk) {
    if (this.closed) return;
    this.buffer += chunk.toString("utf8");
    if (Buffer.byteLength(this.buffer, "utf8") > this.maxMessageBytes && !this.buffer.includes("\n")) {
      this.closeWithError(createCodexUpstreamError(
        "CODEX_APP_SERVER_PROTOCOL_ERROR",
        "Incoming JSON-RPC message exceeds the limit."
      ));
      return;
    }

    let newline = this.buffer.indexOf("\n");
    while (newline !== -1) {
      const line = this.buffer.slice(0, newline).trim();
      this.buffer = this.buffer.slice(newline + 1);
      if (line) this.handleLine(line);
      newline = this.buffer.indexOf("\n");
    }
  }

  handleLine(line) {
    if (Buffer.byteLength(line, "utf8") > this.maxMessageBytes) {
      this.closeWithError(createCodexUpstreamError("CODEX_APP_SERVER_PROTOCOL_ERROR", "Incoming JSON-RPC line exceeds the limit."));
      return;
    }
    let message;
    try {
      message = JSON.parse(line);
    } catch (cause) {
      this.onDiagnostic({ type: "protocol.invalid-json", message: redactCodexDiagnostic(cause) });
      this.events.emit("unknown", { reason: "invalid-json" });
      return;
    }
    if (!isRecord(message)) {
      this.events.emit("unknown", { reason: "non-object" });
      return;
    }

    if ((Object.hasOwn(message, "result") || Object.hasOwn(message, "error")) && Object.hasOwn(message, "id")) {
      const pending = this.pending.get(message.id);
      if (!pending) {
        this.events.emit("unknown", { reason: "unknown-response", id: message.id });
        return;
      }
      this.pending.delete(message.id);
      pending.cleanup();
      if (message.error) {
        pending.reject(createCodexUpstreamError(
          "CODEX_APP_SERVER_PROTOCOL_ERROR",
          typeof message.error?.message === "string" ? message.error.message : `JSON-RPC ${pending.method} failed.`,
          { details: { method: pending.method, rpcCode: message.error?.code } }
        ));
      } else {
        pending.resolve(message.result);
      }
      return;
    }

    if (typeof message.method === "string" && Object.hasOwn(message, "id")) {
      void this.handleServerRequest(message);
      return;
    }

    if (typeof message.method === "string") {
      this.events.emit("notification", message);
      return;
    }

    this.events.emit("unknown", { reason: "unrecognized-message" });
  }

  async handleServerRequest(message) {
    if (!this.serverRequestHandler) {
      await this.respondError(message.id, -32601, `Unsupported server request: ${message.method}`).catch(() => undefined);
      return;
    }
    try {
      const result = await this.serverRequestHandler(message);
      await this.respond(message.id, result);
    } catch (cause) {
      const error = toCodexUpstreamError(cause);
      await this.respondError(message.id, -32000, error.safeMessage).catch(() => undefined);
    }
  }

  finishPending(id, error) {
    const pending = this.pending.get(id);
    if (!pending) return;
    this.pending.delete(id);
    pending.cleanup();
    pending.reject(error);
  }

  closeWithError(error) {
    if (this.closed) return;
    this.closed = true;
    for (const [id] of this.pending) this.finishPending(id, error);
    this.events.emit("closed", error);
  }

  dispose(reason = "disposed") {
    if (!this.closed) {
      this.closeWithError(createCodexUpstreamError("CODEX_APP_SERVER_CLOSED", `JSON-RPC client ${reason}.`));
    }
    this.readable.off("data", this.onData);
    this.readable.off("end", this.onEnd);
    this.readable.off("error", this.onError);
    this.writable.off("error", this.onError);
    this.events.removeAllListeners();
  }
}

