// word-extractor ships no types. It reads legacy Word 97-2003 (.doc) files,
// which are OLE2 binaries rather than zips, so mammoth cannot open them at
// all — a real lead sent one and the pipeline had nothing to extract with.
//
// Only the surface we actually use is declared. getBody() returns the document
// text; the package also exposes headers/footnotes/annotations, which a CV
// never needs.
declare module 'word-extractor' {
  interface WordDocument {
    getBody(): string;
    getFootnotes(): string;
    getHeaders(): string;
    getAnnotations(): string;
  }
  class WordExtractor {
    extract(source: Buffer | string): Promise<WordDocument>;
  }
  export default WordExtractor;
}
