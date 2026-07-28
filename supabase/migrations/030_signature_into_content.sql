-- ============================================================================
-- 030: MAKE THE SIGNATURE PART OF THE EDITABLE EMAIL
--
-- Until now the signature, booking link and footer were injected by the shared
-- email frame, which meant they could not be edited in the editor. They are
-- now part of the template content itself, so every word of an email is
-- editable.
--
-- This appends the signature block to any seeded template that does not
-- already have one, so nothing is lost in the switch.
--
-- The trade to be aware of: the signature now lives in 14 separate templates.
-- Changing your phone number means editing 14 emails rather than one file.
-- The Templates tab makes that quick, but it is worth knowing.
--
-- Safe to run repeatedly. Only adds a signature where one is missing.
-- ============================================================================

create or replace function public.append_email_signature(p_workspace_id uuid)
returns int
language plpgsql security definer set search_path = public as $fn$
declare
  sig text;
  n int := 0;
begin
  sig :=
    '<p>You can book a time with me here:<br/>' ||
    '<a href="https://crm.migrizo.com/book/shailen">https://crm.migrizo.com/book/shailen</a></p>' ||
    '<p>Warm regards,<br/>' ||
    'Shailen Pathak<br/>' ||
    'Lead Consultant, Global Talent Visa<br/>' ||
    'Migrizo<br/>' ||
    'WhatsApp +44 7887 348822</p>' ||
    '<p>Migrizo Ventures Pvt Ltd. &middot; www.migrizo.com &middot; info@migrizo.com<br/>' ||
    'You received this because you enquired with Migrizo about the UK Global Talent Visa. ' ||
    '<a href="{{UNSUB_URL}}">Unsubscribe</a></p>';

  update public.email_templates
     set html = html || sig,
         updated_at = now()
   where workspace_id = p_workspace_id
     and is_seeded
     and html not like '%Warm regards%';

  get diagnostics n = row_count;
  return n;
end;
$fn$;

grant execute on function public.append_email_signature(uuid) to authenticated;

do $$
declare w record;
begin
  for w in select id from public.workspaces loop
    perform public.append_email_signature(w.id);
  end loop;
end $$;

notify pgrst, 'reload schema';

-- ── VERIFICATION ────────────────────────────────────────────────────────────
-- with_signature must equal seeded_templates. missing_unsubscribe must be 0.

select
  count(*) filter (where is_seeded) as seeded_templates,
  count(*) filter (where is_seeded and html like '%Warm regards%') as with_signature,
  count(*) filter (where is_seeded and html not like '%UNSUB_URL%') as missing_unsubscribe,
  count(*) filter (where is_seeded and html ~ '\[[A-Z]') as placeholders_left
from public.email_templates;
