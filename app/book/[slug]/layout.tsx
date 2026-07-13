// Per-booking-page metadata so shared links preview as a consultation invite
// (not the internal CRM). Dynamically reads the member's name + meeting title.
import type { Metadata } from 'next';
import { createClient } from '@supabase/supabase-js';

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const fallback: Metadata = {
    title: 'Book a Consultation · Migrizo',
    description: 'Schedule your UK Global Talent Visa consultation with Migrizo. Smart. Fast. Reliable Visas.',
  };
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) return fallback;
    const admin = createClient(url, key, { auth: { persistSession: false } });
    const { data: m } = await admin.from('scheduler_members')
      .select('display_name, title, active').eq('slug', slug).maybeSingle();
    if (!m) return fallback;

    const title = `${m.title || 'Consultation'} with ${m.display_name} · Migrizo`;
    const description = `Book your ${m.title || 'consultation'} with ${m.display_name} at Migrizo. Choose a time that works for you — Smart. Fast. Reliable Visas.`;
    const ogImage = 'https://crm.migrizo.com/migrizo-og.png';

    return {
      title,
      description,
      robots: { index: false, follow: false }, // booking pages shouldn't be indexed
      openGraph: {
        title,
        description,
        url: `https://crm.migrizo.com/book/${slug}`,
        siteName: 'Migrizo',
        type: 'website',
        images: [{ url: ogImage, width: 1200, height: 630, alt: 'Migrizo — Book a Consultation' }],
      },
      twitter: { card: 'summary_large_image', title, description, images: [ogImage] },
    };
  } catch {
    return fallback;
  }
}

export default function BookLayout({ children }: { children: React.ReactNode }) {
  return children;
}
