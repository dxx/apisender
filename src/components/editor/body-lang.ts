import { StreamLanguage } from "@codemirror/language";
import type { Language, StreamParser } from "@codemirror/language";
import { jsonLanguage } from "@codemirror/lang-json";
import { xmlLanguage } from "@codemirror/lang-xml";
import { htmlLanguage } from "@codemirror/lang-html";

export type BodyFormat = "json" | "xml" | "html" | "text";

const textParser: StreamParser<unknown> = {
  name: "text",
  startState: () => null,
  copyState: (s) => s,
  token: (stream) => {
    stream.skipToEnd();
    return "";
  },
};

const textLanguage = StreamLanguage.define(textParser);

export function getBodyLanguage(format: BodyFormat): Language {
  switch (format) {
    case "json":
      return jsonLanguage;
    case "xml":
      return xmlLanguage;
    case "html":
      return htmlLanguage;
    case "text":
      return textLanguage;
  }
}
