// =============================================================================
// FORM-HELLO PARSER — recognising "Hello! I filled out your form…"
//
// Meta's click-to-WhatsApp flow drops the lead's ANSWERS into their first
// message as labelled lines. That message is the strongest signal the CRM
// ever receives: it says "I am a brand-new enquiry, treat me as one" — even
// when the phone number is old, wrong-country, or different from the form's,
// and even when a lead with this name already exists from last month.
//
// Founder rule (v2): a form-hello ALWAYS gets T1 (deduped to one per 24h),
// and always gets a lead — found by email, or created on the spot. The
// message body is the source of truth, not the WhatsApp sender id.
//
// Parsing is deliberately forgiving: label variants ("filled in" / "filled
// out"), unicode names (Akshay सोनवणे), junk spacing, any line order.
// =============================================================================

export interface FormHello {
  isFormHello: boolean;
  fullName: string | null;
  email: string | null;
  phone: string | null;       // the number typed INTO the form (often ≠ sender)
  expertise: string | null;
  readiness: string | null;
}

const EMPTY: FormHello = {
  isFormHello: false, fullName: null, email: null, phone: null,
  expertise: null, readiness: null,
};

/** Pull the value after a labelled field, tolerant of spacing and casing. */
function field(text: string, label: RegExp): string | null {
  const m = text.match(label);
  const v = m?.[1]?.trim().replace(/\s+/g, ' ') ?? null;
  return v && v.length > 0 && v.length < 200 ? v : null;
}

export function parseFormHello(text: string): FormHello {
  const t = (text || '').trim();
  if (!t) return EMPTY;

  const greeting = /hello!?\s+i\s+filled\s+(?:in|out)\s+your\s+form/i.test(t);
  const fullName = field(t, /full\s*name\s*[:：]\s*(.+)/i);
  const phone = field(t, /phone\s*(?:number)?\s*[:：]\s*([+\d][\d\s\-()]{6,})/i);
  const email = field(t, /e-?mail\s*[:：]\s*([^\s]+@[^\s]+)/i);

  // A form-hello is the greeting line, OR a message that carries the labelled
  // answers even if Meta trimmed the greeting. Two labelled fields = a form.
  const labelledFields = [fullName, phone, email].filter(Boolean).length;
  const isFormHello = greeting || labelledFields >= 2;
  if (!isFormHello) return EMPTY;

  return {
    isFormHello: true,
    fullName,
    email: email ? email.toLowerCase() : null,
    phone,
    expertise: field(t, /field\s+of\s+expertise[^:：]*[:：]\s*(.+)/i),
    readiness: field(t, /readiness\s+to\s+invest[^:：]*[:：]\s*(.+)/i),
  };
}
