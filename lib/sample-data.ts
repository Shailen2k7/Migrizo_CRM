import type { LeadStage, PaymentStatus } from './types';

interface SampleLead {
  full_name: string;
  phone: string;
  email: string;
  visa_type: string;
  stage: LeadStage;
  score: number;
  daysOffsetForFollowUp: number; // negative = past, positive = future
  payment_status: PaymentStatus;
  amount_paid: number;
  last_note: string;
}

const VISA_TYPES = ['UK Global Talent', 'UK Innovator Founder', 'UK Skilled Worker', 'Canada Express Entry', 'Australia 491', 'Germany Blue Card'];

const SAMPLE_DATA: SampleLead[] = [
  { full_name: 'Aditi Sharma',     phone: '+91 98214 22341', email: 'aditi.sharma@gmail.com',    visa_type: 'UK Global Talent',     stage: 'proposal',     score: 88, daysOffsetForFollowUp: 0,   payment_status: 'partial', amount_paid: 75000,  last_note: 'Sent proposal yesterday. Needs to discuss timeline with spouse before signing.' },
  { full_name: 'Rohan Mehta',      phone: '+91 99102 33421', email: 'rohan.mehta@outlook.com',   visa_type: 'UK Innovator Founder', stage: 'partial',      score: 92, daysOffsetForFollowUp: 1,   payment_status: 'partial', amount_paid: 125000, last_note: 'Kickstart paid. Working on business plan v2 with our team. Endorsement target: 6 weeks.' },
  { full_name: 'Priya Iyer',       phone: '+91 87123 56789', email: 'priya.iyer@yahoo.in',       visa_type: 'UK Global Talent',     stage: 'consultation', score: 76, daysOffsetForFollowUp: 0,   payment_status: 'none',    amount_paid: 0,      last_note: 'Consultation scheduled for 11am today. Strong tech profile.' },
  { full_name: 'Karan Singh',      phone: '+91 91234 78901', email: 'karan.singh@hotmail.com',   visa_type: 'Canada Express Entry', stage: 'qualified',    score: 71, daysOffsetForFollowUp: 2,   payment_status: 'none',    amount_paid: 0,      last_note: 'PR score 478. Eligible. Awaiting decision on whether to proceed.' },
  { full_name: 'Neha Reddy',       phone: '+91 99887 65432', email: 'neha.reddy@gmail.com',      visa_type: 'UK Skilled Worker',    stage: 'connected',    score: 58, daysOffsetForFollowUp: 3,   payment_status: 'none',    amount_paid: 0,      last_note: 'Working at TCS. Looking to relocate to London. Sponsor licence query pending.' },
  { full_name: 'Aman Khanna',      phone: '+91 98123 45678', email: 'aman.khanna@gmail.com',     visa_type: 'UK Global Talent',     stage: 'won',          score: 95, daysOffsetForFollowUp: 0,   payment_status: 'paid',    amount_paid: 280000, last_note: 'Endorsement approved 2 weeks ago. Visa stamp received. Onboarded for post-approval support.' },
  { full_name: 'Sneha Pillai',     phone: '+91 90876 54321', email: 'sneha.pillai@outlook.com',  visa_type: 'UK Innovator Founder', stage: 'proposal',     score: 81, daysOffsetForFollowUp: -1,  payment_status: 'none',    amount_paid: 0,      last_note: 'Sent proposal Tuesday. Said she would review with co-founder. No reply yet.' },
  { full_name: 'Vikram Joshi',     phone: '+91 97654 32109', email: 'vikram.joshi@yahoo.com',    visa_type: 'Australia 491',        stage: 'qualified',    score: 66, daysOffsetForFollowUp: 4,   payment_status: 'none',    amount_paid: 0,      last_note: 'Engineer profile. State sponsorship under review. Will follow up after document collection.' },
  { full_name: 'Ananya Kapoor',    phone: '+91 96543 21098', email: 'ananya.kapoor@gmail.com',   visa_type: 'UK Global Talent',     stage: 'attempted',    score: 45, daysOffsetForFollowUp: -2,  payment_status: 'none',    amount_paid: 0,      last_note: 'Called twice — no answer. Sent WhatsApp with consultation link.' },
  { full_name: 'Arjun Nair',       phone: '+91 98765 43210', email: 'arjun.nair@gmail.com',      visa_type: 'Germany Blue Card',    stage: 'connected',    score: 62, daysOffsetForFollowUp: 5,   payment_status: 'none',    amount_paid: 0,      last_note: 'Tech lead, salary qualifies. Considering Berlin vs Munich. Sending company list.' },
  { full_name: 'Ritu Agarwal',     phone: '+91 95432 10987', email: 'ritu.agarwal@hotmail.com',  visa_type: 'UK Skilled Worker',    stage: 'won',          score: 90, daysOffsetForFollowUp: 0,   payment_status: 'paid',    amount_paid: 200000, last_note: 'CoS issued. Visa application submitted last week. Decision expected in 3 weeks.' },
  { full_name: 'Sandeep Verma',    phone: '+91 94321 09876', email: 'sandeep.verma@gmail.com',   visa_type: 'UK Innovator Founder', stage: 'new',          score: 50, daysOffsetForFollowUp: 1,   payment_status: 'none',    amount_paid: 0,      last_note: 'Came in via LinkedIn. SaaS founder, looking for endorsement options.' },
  { full_name: 'Meera Choudhury',  phone: '+91 93210 98765', email: 'meera.choudhury@yahoo.in',  visa_type: 'Canada Express Entry', stage: 'partial',      score: 84, daysOffsetForFollowUp: 7,   payment_status: 'partial', amount_paid: 95000,  last_note: 'CRS profile uploaded. Documents being collected. Aiming for next quarterly draw.' },
  { full_name: 'Yash Bhatia',      phone: '+91 92109 87654', email: 'yash.bhatia@outlook.com',   visa_type: 'UK Global Talent',     stage: 'consultation', score: 73, daysOffsetForFollowUp: 0,   payment_status: 'none',    amount_paid: 0,      last_note: 'Mid-level designer at Razorpay. Portfolio review tomorrow at 4pm.' },
  { full_name: 'Pooja Bansal',     phone: '+91 91098 76543', email: 'pooja.bansal@gmail.com',    visa_type: 'UK Skilled Worker',    stage: 'lost',         score: 0,  daysOffsetForFollowUp: 0,   payment_status: 'none',    amount_paid: 0,      last_note: 'Decided to take a domestic role instead. Asked us to keep her file open for future.' },
  { full_name: 'Rajesh Kumar',     phone: '+91 90987 65432', email: 'rajesh.kumar@yahoo.com',    visa_type: 'UK Global Talent',     stage: 'proposal',     score: 79, daysOffsetForFollowUp: 2,   payment_status: 'none',    amount_paid: 0,      last_note: 'Senior PM at Flipkart. Strong product portfolio. Proposal sent for digital tech track.' },
  { full_name: 'Divya Menon',      phone: '+91 89876 54321', email: 'divya.menon@gmail.com',     visa_type: 'UK Innovator Founder', stage: 'qualified',    score: 68, daysOffsetForFollowUp: 6,   payment_status: 'none',    amount_paid: 0,      last_note: 'D2C brand founder. Revenue ₹2.4cr ARR. Innovation criteria to be assessed.' },
  { full_name: 'Tushar Goel',      phone: '+91 88765 43210', email: 'tushar.goel@outlook.com',   visa_type: 'Germany Blue Card',    stage: 'attempted',    score: 40, daysOffsetForFollowUp: -3,  payment_status: 'none',    amount_paid: 0,      last_note: 'Number on do-not-call list. Sent intro email instead. No response so far.' },
  { full_name: 'Shreya Mathur',    phone: '+91 87654 32109', email: 'shreya.mathur@gmail.com',   visa_type: 'UK Global Talent',     stage: 'won',          score: 93, daysOffsetForFollowUp: 0,   payment_status: 'paid',    amount_paid: 320000, last_note: 'Promoted client. Referred 3 friends. Endorsement won, visa stamped.' },
  { full_name: 'Nitin Bhardwaj',   phone: '+91 86543 21098', email: 'nitin.bhardwaj@yahoo.in',   visa_type: 'Canada Express Entry', stage: 'connected',    score: 55, daysOffsetForFollowUp: 8,   payment_status: 'none',    amount_paid: 0,      last_note: 'IT graduate from VIT. CRS estimate around 420. Needs IELTS prep.' },
  { full_name: 'Kavita Rao',       phone: '+91 85432 10987', email: 'kavita.rao@gmail.com',      visa_type: 'UK Skilled Worker',    stage: 'partial',      score: 86, daysOffsetForFollowUp: 4,   payment_status: 'partial', amount_paid: 80000,  last_note: 'Sponsorship secured from London hospital. CoS pending. Visa filing in 2 weeks.' },
  { full_name: 'Harsh Patel',      phone: '+91 84321 09876', email: 'harsh.patel@outlook.com',   visa_type: 'UK Innovator Founder', stage: 'new',          score: 50, daysOffsetForFollowUp: 1,   payment_status: 'none',    amount_paid: 0,      last_note: 'Cold inquiry from website. Has fintech idea. Wants free consultation call.' },
  { full_name: 'Mansi Saxena',     phone: '+91 83210 98765', email: 'mansi.saxena@yahoo.com',    visa_type: 'UK Global Talent',     stage: 'proposal',     score: 82, daysOffsetForFollowUp: 0,   payment_status: 'none',    amount_paid: 0,      last_note: 'Strong AI research background. PhD from IIT-B. Proposal sent, awaiting decision.' },
  { full_name: 'Akshay Reddy',     phone: '+91 82109 87654', email: 'akshay.reddy@gmail.com',    visa_type: 'Australia 491',        stage: 'attempted',    score: 35, daysOffsetForFollowUp: -5,  payment_status: 'none',    amount_paid: 0,      last_note: 'Stopped responding 5 days ago after consultation. Last touch: pricing question.' },
  { full_name: 'Tanvi Joshi',      phone: '+91 81098 76543', email: 'tanvi.joshi@hotmail.com',   visa_type: 'UK Global Talent',     stage: 'qualified',    score: 70, daysOffsetForFollowUp: 3,   payment_status: 'none',    amount_paid: 0,      last_note: 'Marketing director at OYO. Strong leadership profile. Endorsement criteria reviewed.' },
];

export interface SeedRow {
  workspace_id: string;
  created_by: string;
  full_name: string;
  phone: string;
  email: string;
  visa_type: string;
  stage: LeadStage;
  score: number;
  next_follow_up: string | null;
  payment_status: PaymentStatus;
  amount_paid: number;
  amount_total: number;
  last_note: string;
  last_note_at: string;
  last_note_author_id: string;
  tags: string[];
  is_sample: true;
}

export function buildSampleLeads(workspaceId: string, userId: string): SeedRow[] {
  const now = Date.now();
  const dayMs = 86400000;
  return SAMPLE_DATA.map((d) => {
    const followUpDate = new Date(now + d.daysOffsetForFollowUp * dayMs);
    if (d.daysOffsetForFollowUp === 0) followUpDate.setHours(15, 0, 0, 0); // 3pm today
    return {
      workspace_id: workspaceId,
      created_by: userId,
      full_name: d.full_name,
      phone: d.phone,
      email: d.email,
      visa_type: d.visa_type,
      stage: d.stage,
      score: d.score,
      next_follow_up: d.stage === 'won' || d.stage === 'lost' ? null : followUpDate.toISOString(),
      payment_status: d.payment_status,
      amount_paid: d.amount_paid,
      amount_total: d.stage === 'won' ? d.amount_paid : 350000,
      last_note: d.last_note,
      last_note_at: new Date(now - Math.floor(Math.random() * 5) * dayMs).toISOString(),
      last_note_author_id: userId,
      tags: [],
      is_sample: true as const,
    };
  });
}
