// =============================================================================
// SERVE-BYTES — the one place that turns stored file bytes into an HTTP body.
// -----------------------------------------------------------------------------
// WHY THIS FILE EXISTS
//
// Downloads from the inbox were arriving as 0-byte files. Every previous fix
// chased the FILENAME (extension missing, quotes, mime guessing) — but the name
// was never the problem. The BODY was empty.
//
// The cause: `new NextResponse(blob)`. Supabase's .download() hands back a Blob
// backed by a stream. Next's Node runtime on Netlify serialises that response
// through a Lambda-style adapter that does not always drain a stream body before
// closing it — so the browser is told "here is your CV" and receives nothing.
//
// The fix is boring and total: never hand a Blob to NextResponse. Read it fully
// into a Buffer first, assert the length, and send an explicit Content-Length.
// A file either arrives whole or we say honestly that we could not read it.
// There is no third outcome any more.
// =============================================================================
import { NextResponse } from 'next/server';

/** Fully drains a Blob / ArrayBuffer / stream into a Buffer. Never partial. */
export async function toBuffer(file: Blob | ArrayBuffer | Uint8Array): Promise<Buffer> {
  if (Buffer.isBuffer(file)) return file;
  if (file instanceof Uint8Array) return Buffer.from(file);
  if (file instanceof ArrayBuffer) return Buffer.from(new Uint8Array(file));
  // Blob — arrayBuffer() resolves only once every chunk has been read.
  const ab = await (file as Blob).arrayBuffer();
  return Buffer.from(new Uint8Array(ab));
}

const MIME_EXT: Record<string, string> = {
  'application/pdf': 'pdf',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.oasis.opendocument.text': 'odt',
  'text/plain': 'txt',
  'text/rtf': 'rtf', 'application/rtf': 'rtf',
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp',
  'image/gif': 'gif', 'image/heic': 'heic',
  'audio/ogg': 'ogg', 'audio/mpeg': 'mp3', 'audio/mp4': 'm4a',
  'video/mp4': 'mp4', 'video/3gpp': '3gp',
};

const EXT_MIME: Record<string, string> = {
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  odt: 'application/vnd.oasis.opendocument.text',
  txt: 'text/plain', rtf: 'application/rtf',
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
  webp: 'image/webp', gif: 'image/gif', heic: 'image/heic',
  ogg: 'audio/ogg', mp3: 'audio/mpeg', m4a: 'audio/mp4',
  mp4: 'video/mp4', '3gp': 'video/3gpp',
};

/**
 * MAGIC-BYTE SNIFFING. The customer's own filename is kept exactly as they sent
 * it (founder's rule), but when it has NO extension we must not guess wrong —
 * a .pdf saved as .docx will not open. Reading the first bytes is definitive.
 */
export function sniffExt(buf: Buffer): string | null {
  if (buf.length < 4) return null;
  const b = buf;
  if (b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46) return 'pdf';   // %PDF
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpg';
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'png';
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return 'gif';
  if (b.length > 11 && b.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  if (b.length > 11 && b.toString('ascii', 4, 12) === 'ftypheic') return 'heic';
  if (b[0] === 0xd0 && b[1] === 0xcf && b[2] === 0x11 && b[3] === 0xe0) return 'doc';   // OLE2
  if (b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04) return 'docx';  // ZIP → Office
  if (b.length > 11 && b.toString('ascii', 4, 8) === 'ftyp') return 'mp4';
  if (b[0] === 0x4f && b[1] === 0x67 && b[2] === 0x67 && b[3] === 0x53) return 'ogg';
  return null;
}

/**
 * Builds the filename the OS will actually write to disk.
 * Rule 1 (founder's): keep the customer's own name, untouched, if it has one.
 * Rule 2: it MUST end in a real extension, or nothing opens it.
 */
export function safeFilename(opts: {
  name?: string | null; path?: string | null; mime?: string | null; buf?: Buffer | null;
  fallback?: string;
}): { filename: string; ext: string } {
  const raw = (opts.name || '').replace(/[\r\n"\\]/g, '').replace(/[/\\]/g, '-').trim();
  const base = raw || (opts.fallback || 'CV');

  const existing = /\.(\w{2,5})$/.exec(base);
  if (existing && existing[1].toLowerCase() !== 'bin') {
    return { filename: base, ext: existing[1].toLowerCase() };
  }

  // No usable extension on the name — derive one, most reliable source first.
  const fromBytes = opts.buf ? sniffExt(opts.buf) : null;
  const fromPath = (opts.path || '').split('.').pop()?.toLowerCase();
  const fromMime = MIME_EXT[(opts.mime || '').split(';')[0].trim().toLowerCase()];
  const ext = fromBytes
    || (fromPath && /^\w{2,5}$/.test(fromPath) && fromPath !== 'bin' ? fromPath : null)
    || fromMime
    || 'pdf';

  const stem = base.replace(/\.bin$/i, '');
  return { filename: `${stem}.${ext}`, ext };
}

/** Content-Type that matches the bytes we are actually sending. */
export function mimeFor(ext: string, declared?: string | null): string {
  const d = (declared || '').split(';')[0].trim().toLowerCase();
  const byExt = EXT_MIME[ext];
  // A declared mime of octet-stream tells the browser nothing; prefer the ext.
  if (byExt && (!d || d === 'application/octet-stream' || d === 'binary/octet-stream')) return byExt;
  return d || byExt || 'application/octet-stream';
}

/**
 * The final response. Non-ASCII names (Hindi, accents) go out twice: a stripped
 * ASCII `filename=` for old clients and an RFC 5987 `filename*=` for real ones.
 */
export function fileResponse(
  buf: Buffer, filename: string, contentType: string, download: boolean
): NextResponse {
  const ascii = filename.replace(/[^\x20-\x7E]/g, '_');
  const encoded = encodeURIComponent(filename);
  // A fresh Uint8Array over exactly these bytes: satisfies BodyInit, and (unlike
  // handing over the Buffer's pooled ArrayBuffer) can never expose neighbouring
  // memory from Node's allocation pool.
  const body = new Uint8Array(buf.byteLength);
  body.set(buf);
  return new NextResponse(body, {
    headers: {
      'Content-Type': contentType,
      'Content-Length': String(buf.byteLength),
      'Content-Disposition':
        `${download ? 'attachment' : 'inline'}; filename="${ascii}"; filename*=UTF-8''${encoded}`,
      'Cache-Control': 'private, max-age=3600',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
