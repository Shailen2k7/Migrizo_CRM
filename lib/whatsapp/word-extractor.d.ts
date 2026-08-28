// word-extractor ships no types. We use exactly this much of it.
declare module 'word-extractor' {
  class Document {
    getBody(): string;
  }
  export default class WordExtractor {
    extract(input: Buffer | string): Promise<Document>;
  }
}
