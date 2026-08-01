import { StreamLanguage } from "@codemirror/language";
import type { StreamParser, StringStream } from "@codemirror/language";

interface HttpState {
  inBody: boolean;
  inHeaders: boolean;
  inUrl: boolean;
  bodyIsJson: boolean;
}

const httpStreamParser: StreamParser<HttpState> = {
  name: "http",
  startState: () => ({
    inBody: false,
    inHeaders: false,
    inUrl: false,
    bodyIsJson: false,
  }),
  copyState: (s) => ({
    inBody: s.inBody,
    inHeaders: s.inHeaders,
    inUrl: s.inUrl,
    bodyIsJson: s.bodyIsJson,
  }),
  token: (stream, state) => {
    if (stream.sol()) {
      if (stream.match(/###/, false)) {
        state.inBody = false;
        state.inHeaders = false;
        state.inUrl = false;
        state.bodyIsJson = false;
        stream.match(/###.*/);
        return "heading";
      }
      if (stream.match(/^\s*#/) || stream.match(/^\s*\/\//)) {
        stream.skipToEnd();
        return "comment";
      }
      if (stream.match(/^\s*@\w+/, false)) {
        stream.match(/^\s*@\w+/);
        if (stream.peek() === "=") {
          stream.next();
          stream.skipToEnd();
        } else {
          stream.skipToEnd();
        }
        return "variableName";
      }
      const methods = /^(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS|CONNECT|TRACE|WEBSOCKET|GRPC)\b/i;
      if (stream.match(methods, false) && !state.inBody && !state.inHeaders) {
        stream.match(methods);
        state.inHeaders = true;
        state.inUrl = true;
        return "keyword";
      }
      if (!state.inBody && !state.inHeaders) {
        if (stream.match(/\s*https?:\/\//)) {
          state.inUrl = true;
          return "url";
        }
        if (stream.match(/\s*\{\{[^}]+\}\}/)) {
          state.inUrl = true;
          return "variableName";
        }
      }
      if (stream.match(/^\s*$/, false)) {
        stream.next();
        if (state.inHeaders || state.inUrl) {
          state.inBody = true;
          state.inHeaders = false;
          state.inUrl = false;
        }
        return "";
      }
      if (state.inBody) {
        if (stream.match(/\{\{[^}]+\}\}/)) return "variableName";
        if (!state.bodyIsJson && /^\s*[\{\[]/.test(stream.string)) {
          state.bodyIsJson = true;
        }
        if (state.bodyIsJson) return tokenJson(stream);
        stream.skipToEnd();
        return "string";
      }
      const colonIdx = stream.string.indexOf(":");
      if (colonIdx > 0 && !state.inBody) {
        stream.match(/^[^:]+/);
        state.inUrl = false;
        return "propertyName";
      }
      stream.skipToEnd();
      return "";
    }
    if (state.inUrl) {
      stream.match(/\s*/);
      if (stream.match(/\{\{[^}]+\}\}/)) return "variableName";
      if (stream.match(/[^{]+/)) return "url";
      stream.next();
      return "url";
    }
    if (state.inBody) {
      if (stream.match(/\{\{[^}]+\}\}/)) return "variableName";
      if (state.bodyIsJson) return tokenJson(stream);
      stream.skipToEnd();
      return "string";
    }
    if (stream.match(/\{\{[^}]+\}\}/)) return "variableName";
    if (state.inHeaders && stream.match(/\s*https?:\/\/\S+/)) {
      return "url";
    }
    if (stream.match(":")) return "operator";
    stream.skipToEnd();
    return "string";
  },
  blankLine: (state) => {
    if (state.inHeaders || state.inUrl) {
      state.inBody = true;
      state.inHeaders = false;
      state.inUrl = false;
    }
  },
};

function tokenJson(stream: StringStream): string {
  if (stream.match(/"(?:[^"\\]|\\.)*"\s*:/)) return "propertyName";
  if (stream.match(/"(?:[^"\\]|\\.)*"/)) return "string";
  if (stream.match(/-?\d+\.\d+(?:[eE][+-]?\d+)?/)) return "number";
  if (stream.match(/-?\d+/)) return "number";
  if (stream.match(/\b(?:true|false|null)\b/)) return "atom";
  if (stream.match(/[{}\[\],]/)) return "punctuation";
  stream.next();
  return "";
}

export const httpLanguage = StreamLanguage.define(httpStreamParser);

interface ResponseState {
  inBody: boolean;
  seenStatusLine: boolean;
}

const responseStreamParser: StreamParser<ResponseState> = {
  name: "http-response",
  startState: () => ({ inBody: false, seenStatusLine: false }),
  copyState: (s) => ({ inBody: s.inBody, seenStatusLine: s.seenStatusLine }),
  token: (stream, state) => {
    if (stream.sol()) {
      if (!state.seenStatusLine) {
        if (stream.match(/^HTTP\/[\d.]+\s+\d{3}/, false)) {
          stream.match(/^HTTP\/[\d.]+\s+\d{3}/);
          state.seenStatusLine = true;
          return "keyword";
        }
        state.seenStatusLine = true;
        state.inBody = true;
        return tokenizeBody(stream);
      }

      if (!state.inBody) {
        if (stream.match(/^\s*$/, false)) {
          stream.next();
          state.inBody = true;
          return "";
        }
        if (stream.match(/^[A-Za-z0-9-]+(?=\s*:)/, false)) {
          stream.match(/^[A-Za-z0-9-]+/);
          return "propertyName";
        }
        if (stream.match(/^\s*[^:]+:/, false)) {
          stream.match(/^[^:]+:/);
          return "propertyName";
        }
        stream.skipToEnd();
        return "";
      }

      return tokenizeBody(stream);
    }

    if (!state.seenStatusLine) {
      stream.skipToEnd();
      return "keyword";
    }

    if (!state.inBody) {
      if (stream.match(":")) return "punctuation";
      stream.skipToEnd();
      return "string";
    }

    return tokenizeBody(stream);
  },
  blankLine: (state) => {
    if (state.seenStatusLine && !state.inBody) state.inBody = true;
  },
};

function tokenizeBody(stream: StringStream): string {
  if (stream.match(/"(?:[^"\\]|\\.)*"/)) return "string";
  if (stream.match(/-?\d+\.\d+(?:[eE][+-]?\d+)?/)) return "number";
  if (stream.match(/-?\d+/)) return "number";
  if (stream.match(/\b(?:true|false|null)\b/)) return "atom";
  if (stream.match(/[{}\[\],]/)) return "punctuation";
  stream.next();
  return "";
}

export const responseLanguage = StreamLanguage.define(responseStreamParser);
