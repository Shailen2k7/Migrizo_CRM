'use client';

// =============================================================================
// RICH EMAIL EDITOR
//
// A what-you-see-is-what-you-get editor for email content. Deliberately built
// with no external dependency, because this repo deploys by dragging files into
// GitHub and a new npm package is a needless risk in that workflow.
//
// What it gives you:
//   - Bold, italic, underline, bullet and numbered lists, headings, links
//   - Typing a URL and pressing space or enter turns it into a real link
//   - Pasting from Word, Docs or a webpage strips their formatting, which is
//     the single biggest cause of broken-looking emails
//   - The ENTIRE email is editable, signature and footer included. Nothing is
//     injected behind your back except an unsubscribe line, and only if the
//     template does not already contain one.
//   - Output is sanitised down to a small tag set that every mail client
//     renders the same way
// =============================================================================

import { useRef, useEffect, useCallback, useState } from 'react';
import {
  Bold, Italic, Underline, List, ListOrdered, Link2, Heading, Eraser, Undo2, Redo2,
} from 'lucide-react';
import { cn } from '@/lib/utils';

/** Tags a mail client can be trusted with. Everything else is unwrapped. */
const ALLOWED = new Set(['P', 'BR', 'B', 'STRONG', 'I', 'EM', 'U', 'UL', 'OL', 'LI', 'A', 'H3']);

/**
 * Reduce arbitrary editor HTML to the safe subset. Runs on every save, so it
 * also cleans up anything a browser's own editing commands leave behind.
 */
export function sanitizeEmailHtml(html: string): string {
  if (typeof document === 'undefined') return html;
  const root = document.createElement('div');
  root.innerHTML = html;

  const walk = (node: Element) => {
    Array.from(node.children).forEach((child) => {
      walk(child);
      if (!ALLOWED.has(child.tagName)) {
        // Keep the words, drop the tag.
        const parent = child.parentNode;
        if (!parent) return;
        while (child.firstChild) parent.insertBefore(child.firstChild, child);
        parent.removeChild(child);
        return;
      }
      // Strip every attribute except a link's href.
      Array.from(child.attributes).forEach((a) => {
        if (child.tagName === 'A' && a.name === 'href') return;
        child.removeAttribute(a.name);
      });
      if (child.tagName === 'A') {
        const href = child.getAttribute('href') || '';
        // Only real web links and mailto survive. No javascript: anything.
        // {{UNSUB_URL}} is a merge token replaced at send time, so it must survive.
        if (!/^(https?:\/\/|mailto:)/i.test(href) && !/\{\{\s*UNSUB_URL\s*\}\}/i.test(href)) {
          const parent = child.parentNode;
          if (parent) {
            while (child.firstChild) parent.insertBefore(child.firstChild, child);
            parent.removeChild(child);
          }
        }
      }
    });
  };
  walk(root);

  return root.innerHTML
    .replace(/<p>(\s|&nbsp;|<br\s*\/?>)*<\/p>/gi, '')   // empty paragraphs
    .replace(/\s+/g, ' ')
    .trim();
}

interface Props {
  value: string;
  onChange: (html: string) => void;
  /** Shown in the locked signature block so the preview matches reality. */
  minHeight?: number;
}

export default function RichEmailEditor({ value, onChange, minHeight = 340 }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState('');
  const savedRange = useRef<Range | null>(null);

  // Load incoming HTML once, and only when it genuinely differs, so the caret
  // is not thrown back to the start on every keystroke.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (el.innerHTML !== value) el.innerHTML = value || '<p><br/></p>';
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const emit = useCallback(() => {
    if (ref.current) onChange(ref.current.innerHTML);
  }, [onChange]);

  const exec = (cmd: string, arg?: string) => {
    ref.current?.focus();
    document.execCommand(cmd, false, arg);
    emit();
  };

  /** Turn the word just typed into a link if it looks like a URL. */
  const autoLink = useCallback(() => {
    const sel = window.getSelection();
    if (!sel || !sel.isCollapsed || !sel.anchorNode) return;
    const node = sel.anchorNode;
    if (node.nodeType !== Node.TEXT_NODE) return;
    if ((node.parentElement?.closest('a'))) return;  // already inside a link

    const text = node.textContent || '';
    const upto = text.slice(0, sel.anchorOffset);
    const m = upto.match(/(^|\s)((https?:\/\/[^\s]+)|(www\.[^\s]+))\s$/i);
    if (!m) return;

    const raw = m[2];
    const href = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    const start = upto.length - raw.length - 1;   // -1 for the trailing space

    const range = document.createRange();
    range.setStart(node, start);
    range.setEnd(node, start + raw.length);

    const a = document.createElement('a');
    a.setAttribute('href', href);
    a.textContent = raw;
    range.deleteContents();
    range.insertNode(a);

    // Put the caret back after the link and its space.
    const after = document.createRange();
    after.setStartAfter(a);
    after.collapse(true);
    sel.removeAllRanges();
    sel.addRange(after);
    emit();
  }, [emit]);

  const onKeyUp = (e: React.KeyboardEvent) => {
    if (e.key === ' ' || e.key === 'Enter') autoLink();
  };

  /** Paste as plain text. Word and Docs paste enormous unusable markup. */
  const onPaste = (e: React.ClipboardEvent) => {
    e.preventDefault();
    const text = e.clipboardData.getData('text/plain');
    document.execCommand('insertText', false, text);
    emit();
  };

  const openLink = () => {
    const sel = window.getSelection();
    savedRange.current = sel && sel.rangeCount ? sel.getRangeAt(0).cloneRange() : null;
    setLinkUrl('');
    setLinkOpen(true);
  };

  const applyLink = () => {
    let url = linkUrl.trim();
    if (!url) { setLinkOpen(false); return; }
    if (!/^(https?:\/\/|mailto:)/i.test(url)) url = `https://${url}`;
    ref.current?.focus();
    if (savedRange.current) {
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(savedRange.current);
    }
    document.execCommand('createLink', false, url);
    setLinkOpen(false);
    emit();
  };

  const Btn = ({ onClick, title, active, children }: {
    onClick: () => void; title: string; active?: boolean; children: React.ReactNode;
  }) => (
    <button type="button" title={title}
      onMouseDown={(e) => e.preventDefault()}   // keep the selection alive
      onClick={onClick}
      className={cn('w-8 h-8 rounded-lg flex items-center justify-center transition-colors',
        active ? 'bg-indigo-50 text-indigo-700' : 'text-muted hover:bg-surface-2 hover:text-ink')}>
      {children}
    </button>
  );

  return (
    <div className="rounded-xl border border-border overflow-hidden bg-white">

      {/* toolbar */}
      <div className="flex items-center gap-0.5 px-2 py-1.5 border-b border-border bg-surface-2/60 flex-wrap">
        <Btn onClick={() => exec('bold')} title="Bold"><Bold className="w-3.5 h-3.5" /></Btn>
        <Btn onClick={() => exec('italic')} title="Italic"><Italic className="w-3.5 h-3.5" /></Btn>
        <Btn onClick={() => exec('underline')} title="Underline"><Underline className="w-3.5 h-3.5" /></Btn>
        <div className="w-px h-5 bg-border mx-1" />
        <Btn onClick={() => exec('formatBlock', 'h3')} title="Small heading"><Heading className="w-3.5 h-3.5" /></Btn>
        <Btn onClick={() => exec('insertUnorderedList')} title="Bullet list"><List className="w-3.5 h-3.5" /></Btn>
        <Btn onClick={() => exec('insertOrderedList')} title="Numbered list"><ListOrdered className="w-3.5 h-3.5" /></Btn>
        <div className="w-px h-5 bg-border mx-1" />
        <Btn onClick={openLink} title="Insert link"><Link2 className="w-3.5 h-3.5" /></Btn>
        <Btn onClick={() => exec('removeFormat')} title="Clear formatting"><Eraser className="w-3.5 h-3.5" /></Btn>
        <div className="w-px h-5 bg-border mx-1" />
        <Btn onClick={() => exec('undo')} title="Undo"><Undo2 className="w-3.5 h-3.5" /></Btn>
        <Btn onClick={() => exec('redo')} title="Redo"><Redo2 className="w-3.5 h-3.5" /></Btn>
        <span className="ml-auto text-[11px] text-faint pr-1.5 hidden sm:block">
          Type a link and press space to make it clickable
        </span>
      </div>

      {/* link bar */}
      {linkOpen && (
        <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-indigo-50/50">
          <input autoFocus value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); applyLink(); }
                                if (e.key === 'Escape') setLinkOpen(false); }}
            placeholder="Paste or type a web address"
            className="flex-1 text-[13px] px-3 py-1.5 rounded-lg border border-border bg-surface outline-none focus:border-indigo-400" />
          <button type="button" onClick={applyLink}
            className="text-[12px] font-semibold px-3 py-1.5 rounded-lg bg-indigo-600 text-white">Add link</button>
          <button type="button" onClick={() => setLinkOpen(false)}
            className="text-[12px] px-2 py-1.5 text-muted hover:text-ink">Cancel</button>
        </div>
      )}

      {/* the message itself, styled exactly like the sent email */}
      <div
        ref={ref}
        contentEditable
        suppressContentEditableWarning
        onInput={emit}
        onKeyUp={onKeyUp}
        onBlur={emit}
        onPaste={onPaste}
        className="email-body px-5 py-4 outline-none"
        style={{
          minHeight,
          fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif",
          fontSize: 15, lineHeight: 1.7, color: '#222222',
        }}
      />

      <style jsx global>{`
        .email-body p { margin: 0 0 15px; }
        .email-body h3 { font-size: 16px; font-weight: 600; margin: 0 0 12px; }
        .email-body ul, .email-body ol { margin: 0 0 15px; padding-left: 22px; }
        .email-body li { margin-bottom: 6px; }
        .email-body a { color: #1A4FBF; }
        .email-body b, .email-body strong { font-weight: 600; }
        .email-body:empty:before {
          content: 'Write your email here.';
          color: #B0B0B8;
        }
      `}</style>
    </div>
  );
}
