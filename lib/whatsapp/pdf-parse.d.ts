// pdf-parse ships no types, and we import the inner module directly (its
// index.js runs a debug harness on import that breaks under Next's bundler).
declare module 'pdf-parse/lib/pdf-parse.js' {
  interface PdfParseResult {
    text: string;
    numpages: number;
    info: Record<string, unknown>;
  }
  function pdfParse(buffer: Buffer): Promise<PdfParseResult>;
  export default pdfParse;
}
