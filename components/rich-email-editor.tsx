'use client';

// =============================================================================
// RICH EMAIL EDITOR
//
// The approved editor, wired for production. Built with no external package
// because this repo deploys by dragging files into GitHub, and adding an npm
// dependency in that workflow is a needless way to break a build.
//
// Everything is inline-styled on save. Mail clients strip <style> blocks
// unpredictably, so a font size written as a class would survive in the editor
// and vanish in Gmail. Sizes, colours, typefaces and the small-print style are
// all written as inline style attributes, which every client honours.
//
// The sanitiser keeps that small set of style properties and throws away
// everything else, so a paste from Word cannot smuggle in layout that breaks
// the email.
// =============================================================================

import { useRef, useEffect, useCallback, useState } from 'react';
import {
  Bold, Italic, Underline, Strikethrough, List, ListOrdered, Link2,
  AlignLeft, AlignCenter, Minus, Eraser, Undo2, Redo2, Baseline, Type, PanelBottom,
} from 'lucide-react';
import { cn } from '@/lib/utils';

// ── what survives a save ────────────────────────────────────────────────────
const ALLOWED_TAGS = new Set(['P','BR','B','STRONG','I','EM','U','S','STRIKE','UL','OL','LI','A','H3','SPAN','DIV','HR']);
const ALLOWED_STYLE = ['font-size','color','font-family','text-align','font-weight','font-style','text-decoration','line-height'];

const FINE = 'font-size:12px;line-height:1.6;color:#8A8A90';

/** Keep only the style properties a mail client renders reliably. */
function cleanStyle(el: Element): string {
  const raw = el.getAttribute('style') || '';
  const kept: string[] = [];
  raw.split(';').forEach((decl) => {
    const i = decl.indexOf(':');
    if (i < 0) return;
    const prop = decl.slice(0, i).trim().toLowerCase();
    const val = decl.slice(i + 1).trim();
    if (!val || val.length > 120) return;
    if (/url\s*\(|expression|javascript:/i.test(val)) return;   // no smuggling
    if (ALLOWED_STYLE.includes(prop)) kept.push(`${prop}:${val}`);
  });
  return kept.join(';');
}

/**
 * Reduce editor HTML to a safe, email-friendly subset. Runs on every save.
 */
export function sanitizeEmailHtml(html: string): string {
  if (typeof document === 'undefined') return html;
  const root = document.createElement('div');
  root.innerHTML = html;

  // Browsers still emit <font> for some commands. Rewrite it as a styled span.
  root.querySelectorAll('font').forEach((f) => {
    const span = document.createElement('span');
    const bits: string[] = [];
    if (f.getAttribute('color')) bits.push(`color:${f.getAttribute('color')}`);
    if (f.getAttribute('face')) bits.push(`font-family:${f.getAttribute('face')}`);
    if (bits.length) span.setAttribute('style', bits.join(';'));
    span.innerHTML = f.innerHTML;
    f.replaceWith(span);
  });

  const unwrap = (el: Element) => {
    const parent = el.parentNode;
    if (!parent) return;
    while (el.firstChild) parent.insertBefore(el.firstChild, el);
    parent.removeChild(el);
  };

  const walk = (node: Element) => {
    Array.from(node.children).forEach((child) => {
      walk(child);
      if (!ALLOWED_TAGS.has(child.tagName)) { unwrap(child); return; }

      const style = cleanStyle(child);
      const href = child.tagName === 'A' ? (child.getAttribute('href') || '') : '';
      Array.from(child.attributes).forEach((a) => child.removeAttribute(a.name));
      if (style) child.setAttribute('style', style);

      if (child.tagName === 'A') {
        // {{UNSUB_URL}} is a merge token replaced at send time, so it must live.
        const ok = /^(https?:\/\/|mailto:)/i.test(href) || /\{\{\s*UNSUB_URL\s*\}\}/i.test(href);
        if (ok) child.setAttribute('href', href); else unwrap(child);
        return;
      }
      // A span carrying nothing is just noise.
      if (child.tagName === 'SPAN' && !style) unwrap(child);
    });
  };
  walk(root);

  return root.innerHTML
    .replace(/<p[^>]*>(\s|&nbsp;|<br\s*\/?>)*<\/p>/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

const SIZES = [9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 20, 22, 24, 28];
const FONTS: [string, string][] = [
  ['Default', "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif"],
  ['Georgia', "Georgia,'Times New Roman',serif"],
  ['Times', "'Times New Roman',Times,serif"],
  ['Arial', 'Arial,Helvetica,sans-serif'],
  ['Verdana', 'Verdana,Geneva,sans-serif'],
  ['Courier', "'Courier New',monospace"],
];
const COLORS = ['#222222','#6E6E73','#8A8A90','#1A4FBF','#4F46E5','#2F9E68',
                '#B0791B','#C9455C','#6D4AC9','#0E7490','#B45309','#000000'];

interface Props {
  value: string;
  onChange: (html: string) => void;
  minHeight?: number;
}

export default function RichEmailEditor({ value, onChange, minHeight = 430 }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const savedRange = useRef<Range | null>(null);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState('');
  const [colorOpen, setColorOpen] = useState(false);
  const [active, setActive] = useState<Record<string, boolean>>({});

  // Load once. Re-writing innerHTML on every keystroke throws the caret home.
  useEffect(() => {
    const el = ref.current;
    if (el && el.innerHTML !== value) el.innerHTML = value || '<p><br/></p>';
    try { document.execCommand('styleWithCSS', false, 'true'); } catch { /* older browsers */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const emit = useCallback(() => {
    if (ref.current) onChange(ref.current.innerHTML);
  }, [onChange]);

  const refresh = useCallback(() => {
    const q = (c: string) => { try { return document.queryCommandState(c); } catch { return false; } };
    setActive({ bold: q('bold'), italic: q('italic'), underline: q('underline'), strikeThrough: q('strikeThrough') });
  }, []);

  const exec = (cmd: string, arg?: string) => {
    ref.current?.focus();
    document.execCommand(cmd, false, arg);
    emit(); refresh();
  };

  /** execCommand only understands sizes 1-7, so tag then rewrite as real px. */
  const setSize = (px: string) => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    document.execCommand('fontSize', false, '7');
    el.querySelectorAll('font[size="7"]').forEach((f) => {
      const s = document.createElement('span');
      s.style.fontSize = `${px}px`;
      s.innerHTML = f.innerHTML;
      f.replaceWith(s);
    });
    emit();
  };

  /**
   * Toggle the small grey footer styling on whichever line the cursor is in.
   * Detected by the grey colour, not the size, so you can still resize a
   * small-print line with the Size menu afterwards and toggle it off cleanly.
   */
  const toggleFine = () => {
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return;
    let n: Node | null = sel.anchorNode;
    if (n && n.nodeType === Node.TEXT_NODE) n = n.parentNode;
    const block = (n as Element | null)?.closest?.('p,li,h3,div');
    if (!block || !ref.current?.contains(block)) return;
    const isFine = /#8A8A90/i.test(block.getAttribute('style') || '');
    if (isFine) block.removeAttribute('style'); else block.setAttribute('style', FINE);
    emit(); ref.current?.focus();
  };

  /**
   * One press inserts the complete Migrizo footer block at the end of the
   * email: company line, the "you received this" line, and a working
   * Unsubscribe link, already in small grey print. If a footer is already
   * there, pressing again just moves the cursor to it instead of duplicating.
   */
  const insertFooter = () => {
    const el = ref.current;
    if (!el) return;
    const existing = Array.from(el.querySelectorAll('a'))
      .find((a) => /\{\{\s*UNSUB_URL\s*\}\}/i.test(a.getAttribute('href') || ''));
    if (existing) {
      const sel = window.getSelection();
      const r = document.createRange();
      r.selectNodeContents(existing.closest('p,div') || existing);
      r.collapse(false);
      sel?.removeAllRanges(); sel?.addRange(r);
      el.focus();
      return;
    }
    const p1 = document.createElement('p');
    p1.setAttribute('style', FINE);
    p1.innerHTML = 'Migrizo Ventures Pvt Ltd. &middot; ' +
      '<a href="https://www.migrizo.com">www.migrizo.com</a> &middot; ' +
      '<a href="mailto:info@migrizo.com">info@migrizo.com</a>';
    const p2 = document.createElement('p');
    p2.setAttribute('style', FINE);
    p2.innerHTML = 'You received this because you enquired with Migrizo about the UK Global Talent Visa. ' +
      '<a href="{{UNSUB_URL}}">Unsubscribe</a>';
    el.appendChild(p1);
    el.appendChild(p2);
    emit(); el.focus();
  };

  /** Typing a web address and pressing space turns it into a link. */
  const autoLink = useCallback(() => {
    const sel = window.getSelection();
    if (!sel || !sel.isCollapsed || !sel.anchorNode) return;
    const node = sel.anchorNode;
    if (node.nodeType !== Node.TEXT_NODE) return;
    if (node.parentElement?.closest('a')) return;

    const upto = (node.textContent || '').slice(0, sel.anchorOffset);
    const m = upto.match(/(^|\s)((https?:\/\/[^\s]+)|(www\.[^\s]+))\s$/i);
    if (!m) return;

    const raw = m[2];
    const href = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    const start = upto.length - raw.length - 1;

    const range = document.createRange();
    range.setStart(node, start);
    range.setEnd(node, start + raw.length);
    const a = document.createElement('a');
    a.setAttribute('href', href);
    a.textContent = raw;
    range.deleteContents();
    range.insertNode(a);

    const after = document.createRange();
    after.setStartAfter(a); after.collapse(true);
    sel.removeAllRanges(); sel.addRange(after);
    emit();
  }, [emit]);

  const openLink = () => {
    const sel = window.getSelection();
    savedRange.current = sel && sel.rangeCount ? sel.getRangeAt(0).cloneRange() : null;
    setLinkUrl(''); setLinkOpen(true);
  };
  const applyLink = () => {
    let url = linkUrl.trim();
    if (!url) { setLinkOpen(false); return; }
    if (!/^(https?:\/\/|mailto:)/i.test(url)) url = `https://${url}`;
    ref.current?.focus();
    if (savedRange.current) {
      const sel = window.getSelection();
      sel?.removeAllRanges(); sel?.addRange(savedRange.current);
    }
    document.execCommand('createLink', false, url);
    setLinkOpen(false); emit();
  };

  const Btn = ({ onClick, title, on, children }: {
    onClick: () => void; title: string; on?: boolean; children: React.ReactNode;
  }) => (
    <button type="button" title={title} onMouseDown={(e) => e.preventDefault()} onClick={onClick}
      className={cn('w-8 h-8 rounded-lg flex items-center justify-center transition-colors flex-shrink-0',
        on ? 'bg-indigo-50 text-indigo-700' : 'text-muted hover:bg-surface-2 hover:text-ink')}>
      {children}
    </button>
  );
  const Sep = () => <div className="w-px h-5 bg-border mx-1.5 flex-shrink-0" />;
  const picker = 'text-[12.5px] h-8 px-2 rounded-lg border border-border bg-surface text-ink-2 outline-none focus:border-indigo-400 cursor-pointer flex-shrink-0';

  return (
    <div className="rounded-xl border border-border overflow-hidden bg-white">

      {/* toolbar */}
      <div className="flex items-center gap-0.5 px-2.5 py-2 border-b border-border bg-surface-2/50 flex-wrap">
        <select className={picker} title="Typeface" defaultValue=""
          onChange={(e) => { if (e.target.value) exec('fontName', e.target.value); e.target.value = ''; }}>
          <option value="">Font</option>
          {FONTS.map(([label, stack]) => <option key={label} value={stack}>{label}</option>)}
        </select>
        <select className={cn(picker, 'ml-1')} title="Text size" defaultValue=""
          onChange={(e) => { if (e.target.value) setSize(e.target.value); e.target.value = ''; }}>
          <option value="">Size</option>
          {SIZES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>

        <Sep />
        <Btn onClick={() => exec('bold')} title="Bold" on={active.bold}><Bold className="w-3.5 h-3.5" /></Btn>
        <Btn onClick={() => exec('italic')} title="Italic" on={active.italic}><Italic className="w-3.5 h-3.5" /></Btn>
        <Btn onClick={() => exec('underline')} title="Underline" on={active.underline}><Underline className="w-3.5 h-3.5" /></Btn>
        <Btn onClick={() => exec('strikeThrough')} title="Strikethrough" on={active.strikeThrough}><Strikethrough className="w-3.5 h-3.5" /></Btn>

        <div className="relative">
          <Btn onClick={() => setColorOpen((v) => !v)} title="Text colour"><Baseline className="w-3.5 h-3.5" /></Btn>
          {colorOpen && (
            <>
              <div className="fixed inset-0 z-[80]" onClick={() => setColorOpen(false)} />
              <div className="absolute top-9 left-0 z-[90] p-2.5 rounded-xl border border-border bg-surface shadow-lg">
                <div className="grid grid-cols-6 gap-1.5">
                  {COLORS.map((c) => (
                    <button key={c} type="button" onMouseDown={(e) => e.preventDefault()}
                      onClick={() => { exec('foreColor', c); setColorOpen(false); }}
                      className="w-[22px] h-[22px] rounded-md border border-black/10"
                      style={{ background: c }} title={c} />
                  ))}
                </div>
              </div>
            </>
          )}
        </div>

        <Sep />
        <Btn onClick={() => exec('justifyLeft')} title="Align left"><AlignLeft className="w-3.5 h-3.5" /></Btn>
        <Btn onClick={() => exec('justifyCenter')} title="Centre"><AlignCenter className="w-3.5 h-3.5" /></Btn>
        <Btn onClick={() => exec('insertUnorderedList')} title="Bullets"><List className="w-3.5 h-3.5" /></Btn>
        <Btn onClick={() => exec('insertOrderedList')} title="Numbers"><ListOrdered className="w-3.5 h-3.5" /></Btn>

        <Sep />
        <Btn onClick={openLink} title="Insert link"><Link2 className="w-3.5 h-3.5" /></Btn>
        <Btn onClick={toggleFine} title="Small print, makes the current line small and grey"><Type className="w-3.5 h-3.5" /></Btn>
        <Btn onClick={insertFooter} title="Insert the Migrizo footer with the unsubscribe link"><PanelBottom className="w-3.5 h-3.5" /></Btn>
        <Btn onClick={() => exec('insertHTML', '<hr>')} title="Divider line"><Minus className="w-3.5 h-3.5" /></Btn>
        <Btn onClick={() => exec('removeFormat')} title="Clear formatting"><Eraser className="w-3.5 h-3.5" /></Btn>

        <Sep />
        <Btn onClick={() => exec('undo')} title="Undo"><Undo2 className="w-3.5 h-3.5" /></Btn>
        <Btn onClick={() => exec('redo')} title="Redo"><Redo2 className="w-3.5 h-3.5" /></Btn>

        <span className="ml-auto text-[11px] text-faint pr-1 hidden lg:block">
          Type a link and press space to make it clickable
        </span>
      </div>

      {/* link bar */}
      {linkOpen && (
        <div className="flex items-center gap-2 px-3 py-2.5 border-b border-border bg-indigo-50/60">
          <input autoFocus value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); applyLink(); }
              if (e.key === 'Escape') setLinkOpen(false);
            }}
            placeholder="Paste or type a web address, then press Enter"
            className="flex-1 text-[13px] px-3 py-1.5 rounded-lg border border-indigo-200 bg-surface outline-none focus:border-indigo-400" />
          <button type="button" onClick={applyLink}
            className="text-[12.5px] font-medium px-3 py-1.5 rounded-lg bg-indigo-600 text-white">Add link</button>
          <button type="button" onClick={() => setLinkOpen(false)}
            className="text-[12.5px] px-2 py-1.5 text-muted hover:text-ink">Cancel</button>
        </div>
      )}

      {/* the writing surface */}
      <div className="px-6 py-5">
        <div
          ref={ref}
          contentEditable
          suppressContentEditableWarning
          onInput={emit}
          onBlur={emit}
          onKeyUp={(e) => { if (e.key === ' ' || e.key === 'Enter') autoLink(); refresh(); }}
          onMouseUp={refresh}
          onPaste={(e) => {
            e.preventDefault();
            document.execCommand('insertText', false, e.clipboardData.getData('text/plain'));
            emit();
          }}
          className="email-body outline-none"
          style={{
            minHeight,
            maxWidth: 640,
            fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif",
            fontSize: 15, lineHeight: 1.7, color: '#222222',
          }}
        />
      </div>

      <style jsx global>{`
        .email-body p { margin: 0 0 15px; }
        .email-body h3 { font-size: 17px; font-weight: 600; margin: 0 0 12px; }
        .email-body ul, .email-body ol { margin: 0 0 15px; padding-left: 22px; }
        .email-body li { margin-bottom: 6px; }
        .email-body a { color: #1A4FBF; }
        .email-body b, .email-body strong { font-weight: 600; }
        .email-body hr { border: none; border-top: 1px solid #E6E6EA; margin: 22px 0; }
        .email-body:empty:before { content: 'Write your email here.'; color: #B8B8BE; }
      `}</style>
    </div>
  );
}
