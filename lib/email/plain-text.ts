// =============================================================================
// PLAIN TEXT <-> EMAIL HTML
//
// Templates are stored as HTML because that is what gets emailed, but nobody
// should have to type <p> tags to write an email. These two functions let the
// editor show ordinary text and convert on save.
//
// The rules are the ones people already know from messaging apps:
//
//   - a blank line starts a new paragraph
//   - a single line break stays a line break
//   - *text between asterisks* comes out bold
//   - {{name}} is replaced with the recipient's first name when sent
//
// Nothing else is interpreted, and any HTML the person types is escaped rather
// than executed, so a stray < cannot break the email.
// =============================================================================

/** Ordinary typed text -> the HTML that gets emailed. */
export function plainToHtml(plain: string): string {
  const escaped = (plain || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  return escaped
    .replace(/\r\n/g, '\n')
    .split(/\n{2,}/)                       // blank line = new paragraph
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => {
      const withBold = block
        // **bold** and *bold* both work, so neither habit is punished.
        .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
        .replace(/\*(.+?)\*/g, '<b>$1</b>')
        .split('\n')
        .map((line) => line.trim())
        .join('<br/>');
      return `<p>${withBold}</p>`;
    })
    .join('');
}

/** The stored HTML -> ordinary text for editing. */
export function htmlToPlain(html: string): string {
  return (html || '')
    .replace(/<\s*br\s*\/?\s*>/gi, '\n')
    .replace(/<\s*\/\s*p\s*>/gi, '\n\n')
    .replace(/<\s*p[^>]*>/gi, '')
    .replace(/<\s*(b|strong)\s*>/gi, '*')
    .replace(/<\s*\/\s*(b|strong)\s*>/gi, '*')
    .replace(/<[^>]+>/g, '')               // anything else simply goes
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
