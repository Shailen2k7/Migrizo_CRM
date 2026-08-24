// =============================================================================
// PRINT WRAPPER — turns a branded email document into a clean A4 print page.
//
// Kept OUT of the route handler so the exact bytes the browser prints can be
// rendered and inspected in a test, and so any other document (SLA, roadmap)
// can be made printable later without copying these rules around.
// =============================================================================

/**
 * Wrap a rendered branded-email HTML document for printing.
 *
 * @param html     the full document from renderInvoice / renderSLA / …
 * @param fileTitle what Chrome should offer as the "Save as PDF" filename
 * @param autoOpen  open the print dialog on load (false for silent previews)
 */
export function wrapForPrint(html: string, fileTitle: string, autoOpen = true): string {
  // Print rules:
  //  * A4 with a real margin — the email shell has its own padding, so the
  //    wrapper's screen padding is zeroed to avoid a double frame.
  //  * The page background is forced white; the email's grey canvas is a screen
  //    affordance and would flood a printed page with toner.
  //  * Keeping blocks whole is done with [data-keep], set by the script below.
  //    A blanket `tr, td { break-inside: avoid }` CANNOT work on a table-based
  //    email: the whole document lives inside one enormous <td>, so the rule
  //    tells the browser not to split the very element that must be split, and
  //    it responds by pushing the entire body to page 2 and leaving page 1
  //    empty below the logo. Marking only the SHORT boxes gets the intent —
  //    no sliced payment-details panel, no halved footer — with none of that.
  const printCss = `
  <style>
    @media print {
      @page { size: A4; margin: 12mm; }
      html, body { background: #ffffff !important; margin: 0 !important; padding: 0 !important;
                   -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      body > table { background: #ffffff !important; padding: 0 !important; }
      [data-keep] { page-break-inside: avoid; break-inside: avoid; }
      h1, h2 { page-break-after: avoid; break-after: avoid; }
      a { text-decoration: none; }
      #print-bar { display: none !important; }
      /* Shrink-to-fit — see fitOnePage() below. --fit is 1 unless the document
         is only slightly taller than one page, in which case it is the exact
         factor that pulls it back onto that page.
         zoom, NOT transform: a transform scales pixels but leaves the layout
         box its original height, so the browser still paginates as if nothing
         shrank — you get a smaller invoice AND a blank second page. zoom is a
         layout-affecting scale, which is what pagination reads. */
      body { zoom: var(--fit, 1); }
    }
    @media screen {
      body { background: #F2F4F8; }
      #print-bar { position: fixed; top: 0; left: 0; right: 0; z-index: 9; display: flex;
        align-items: center; justify-content: center; gap: 10px; padding: 10px;
        background: #16294E; color: #ffffff;
        font: 13px/1.4 -apple-system, "Segoe UI", Arial, sans-serif; }
      #print-bar button { font: inherit; font-weight: 700; cursor: pointer; border: 0;
        border-radius: 8px; padding: 7px 14px; background: #F4DE35; color: #16294E; }
      body > table { margin-top: 44px; }
    }
  </style>`;

  // window.onload (not DOMContentLoaded) so the logo and signature images are
  // painted before the dialog opens — otherwise they print as broken boxes.
  //
  // markKeep(): tag every box short enough to sit inside one page so the
  // browser moves it whole to the next page rather than slicing it. KEEP_MAX is
  // deliberately under half an A4 text column: taller than that and a block
  // SHOULD paginate, or a single long section would strand a blank page.
  // It runs on load and again on beforeprint, so a later Ctrl+P is correct too.
  const bar = `
  <div id="print-bar">
    <span>Choose <b>Save as PDF</b> as the destination.</span>
    <button onclick="window.print()">Print / Save as PDF</button>
  </div>
  <script>
    document.title = ${JSON.stringify(fileTitle)};
    var KEEP_MAX = 420;
    function markKeep() {
      var nodes = document.querySelectorAll('table, div');
      for (var i = 0; i < nodes.length; i++) {
        var n = nodes[i];
        if (n.id === 'print-bar') continue;
        if (n.offsetHeight > 0 && n.offsetHeight <= KEEP_MAX) n.setAttribute('data-keep', '');
        else n.removeAttribute('data-keep');
      }
    }

    // A4 minus 12mm margins, in CSS pixels at 96dpi: (297 - 24) * 96 / 25.4.
    var PAGE_H = 1032;
    // Never shrink past this — an invoice that needs more than a quarter off
    // is genuinely a two-page document, and squinting at 8pt type is worse
    // than turning a page.
    var MIN_SCALE = 0.76;
    /**
     * If the document is only a little taller than one page, scale it to fit
     * exactly one page. Measuring the 620px card (not the viewport) keeps this
     * independent of the on-screen toolbar and the grey screen canvas, so the
     * number is right whether the user prints immediately or hours later.
     */
    function fitOnePage() {
      var card = document.querySelector('body > table table');
      var h = card ? card.offsetHeight : 0;
      var fit = 1;
      if (h > PAGE_H && h <= PAGE_H / MIN_SCALE) fit = Math.floor((PAGE_H / h) * 1000) / 1000;
      document.body.style.setProperty('--fit', String(fit));
    }

    function prepare() { markKeep(); fitOnePage(); }
    window.addEventListener('beforeprint', prepare);
    window.onload = function () {
      prepare();
      ${autoOpen ? 'setTimeout(function () { window.print(); }, 400);' : ''}
    };
  </script>`;

  return html
    .replace('</head>', `${printCss}</head>`)
    .replace('</body>', `${bar}</body>`);
}

/** Strip characters no filesystem will accept in a filename. */
export function safeFileTitle(s: string): string {
  return s.replace(/[\\/:*?"<>|]/g, '-').replace(/\s+/g, ' ').trim();
}
