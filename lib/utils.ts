import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Indian Rupee formatter
export function formatINR(n: number): string {
  if (!n && n !== 0) return '—';
  if (n >= 10000000) return `₹${(n / 10000000).toFixed(2)}Cr`;
  if (n >= 100000) return `₹${(n / 100000).toFixed(2)}L`;
  if (n >= 1000) return `₹${(n / 1000).toFixed(1)}K`;
  return `₹${n.toLocaleString('en-IN')}`;
}

export function formatINRFull(n: number): string {
  return '₹' + (n ?? 0).toLocaleString('en-IN');
}

export function initials(name: string): string {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

// Deterministic avatar color from string
const AVATAR_COLORS = ['#6366F1', '#10B981', '#F59E0B', '#EC4899', '#7C3AED', '#0EA5E9', '#DC2626', '#4338CA'];
export function avatarColor(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

export function scoreColor(s: number): string {
  if (s >= 80) return '#10B981';
  if (s >= 60) return '#6366F1';
  if (s >= 40) return '#F59E0B';
  return '#9CA3AF';
}

// Relative time formatter
export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return '—';
  const date = new Date(iso);
  const now = Date.now();
  const diff = now - date.getTime();
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return 'just now';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} min ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} hr ago`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d ago`;
  if (day < 30) return `${Math.floor(day / 7)}w ago`;
  if (day < 365) return `${Math.floor(day / 30)}mo ago`;
  return `${Math.floor(day / 365)}y ago`;
}

export function formatFollowUp(iso: string | null | undefined): { text: string; overdue: boolean } {
  if (!iso) return { text: '—', overdue: false };
  const date = new Date(iso);
  const now = new Date();
  const diffMs = date.getTime() - now.getTime();
  const diffDays = Math.floor(diffMs / 86400000);
  const overdue = diffMs < 0;
  const time = date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

  const today = new Date(); today.setHours(0, 0, 0, 0);
  const d = new Date(date); d.setHours(0, 0, 0, 0);
  const dayDiff = Math.round((d.getTime() - today.getTime()) / 86400000);

  if (dayDiff === 0) return { text: `Today · ${time}`, overdue: overdue };
  if (dayDiff === 1) return { text: `Tomorrow · ${time}`, overdue: false };
  if (dayDiff === -1) return { text: `Yesterday · overdue`, overdue: true };
  if (overdue) return { text: `${Math.abs(diffDays)}d overdue`, overdue: true };
  if (dayDiff < 7) return { text: date.toLocaleDateString('en-US', { weekday: 'short' }) + ` · ${time}`, overdue: false };
  return { text: date.toLocaleDateString('en-US', { day: 'numeric', month: 'short' }), overdue: false };
}

// Normalize phone to +91 format for Indian numbers
export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, '');
  if (!digits) return null;
  if (digits.length === 10) return `+91 ${digits.slice(0, 5)} ${digits.slice(5)}`;
  if (digits.length === 12 && digits.startsWith('91')) {
    return `+91 ${digits.slice(2, 7)} ${digits.slice(7)}`;
  }
  if (digits.length === 11 && digits.startsWith('0')) {
    return `+91 ${digits.slice(1, 6)} ${digits.slice(6)}`;
  }
  return `+${digits}`;
}

// Normalize email
export function normalizeEmail(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const t = raw.trim().toLowerCase();
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(t) ? t : null;
}

export function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

export function todayDateString(): string {
  return new Date().toLocaleDateString('en-US', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}
