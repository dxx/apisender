import { StreamLanguage, type StreamParser } from "@codemirror/language";

const KEYWORDS = new Set([
  "syntax", "import", "edition", "package", "option", "message", "enum",
  "service", "rpc", "returns", "stream", "reserved", "extend", "extensions",
  "repeated", "optional", "required", "map", "oneof", "group", "weak", "public",
]);

const TYPES = new Set([
  "double", "float", "int32", "int64", "uint32", "uint64", "sint32", "sint64",
  "fixed32", "fixed64", "sfixed32", "sfixed64", "bool", "string", "bytes",
]);

interface ProtoState {
  inBlockComment: boolean;
}

const parser: StreamParser<ProtoState> = {
  name: "proto",
  startState: () => ({ inBlockComment: false }),
  copyState: (s) => ({ inBlockComment: s.inBlockComment }),
  token(stream, state) {
    if (state.inBlockComment) {
      if (stream.match("*/")) {
        state.inBlockComment = false;
        return "comment";
      }
      stream.skipTo("*/");
      if (!stream.eol()) stream.next();
      return "comment";
    }

    if (stream.match("//")) {
      stream.skipToEnd();
      return "comment";
    }
    if (stream.match("/*")) {
      state.inBlockComment = true;
      return "comment";
    }

    if (stream.match(/^"([^"\\]|\\.)*"/) || stream.match(/^'([^'\\]|\\.)*'/)) {
      return "string";
    }

    if (stream.match(/^[-+]?\d*\.\d+([eE][-+]?\d+)?/) ||
        stream.match(/^[-+]?\d+[eE][-+]?\d+/) ||
        stream.match(/^[-+]?(0[xX][0-9a-fA-F]+|0[0-7]*|\d+)/)) {
      return "number";
    }

    const ch = stream.peek();
    if (!ch) {
      stream.next();
      return null;
    }

    if (/[a-zA-Z_]/.test(ch)) {
      stream.eatWhile(/[a-zA-Z0-9_.]/);
      const word = stream.current();
      if (KEYWORDS.has(word)) return "keyword";
      if (TYPES.has(word)) return "atom";
      const next = stream.peek();
      if (next === "(") return "keyword";
      return "variableName";
    }

    if (/[{}()\[\]<>,;]/.test(ch)) {
      stream.next();
      return "punctuation";
    }

    if (/[=+\-*/]/.test(ch)) {
      stream.next();
      return "punctuation";
    }

    stream.next();
    return null;
  },
  languageData: {
    commentTokens: { line: "//", block: { open: "/*", close: "*/" } },
  },
};

export const protoLanguage = StreamLanguage.define(parser);
