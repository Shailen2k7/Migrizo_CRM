'use client';

// =============================================================================
// PIPELINES DATA LAYER — types + usePipelines() hook
// -----------------------------------------------------------------------------
// Self-contained: talks to Supabase directly so it does NOT require changes to
// app-provider.tsx. Backed by migration 003 (pipelines + stages tables).
// =============================================================================

import { useCallback, useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { toast } from 'sonner';

export interface Pipeline {
  id: string;
  workspace_id: string;
  name: string;
  visa_type: string | null;
  sort_order: number;
  is_default: boolean;
  created_at: string;
  updated_at: string;
}

export interface Stage {
  id: string;
  pipeline_id: string;
  workspace_id: string;
  name: string;
  stage_key: string;
  color: StageColor;
  sort_order: number;
  stage_type: 'active' | 'won' | 'lost';
  created_at: string;
  updated_at: string;
}

// ---- Color palette for stage columns (name → chip/board tints) --------------
export type StageColor =
  | 'red' | 'blue' | 'amber' | 'violet' | 'green' | 'slate'
  | 'pink' | 'cyan' | 'indigo' | 'orange';

export const STAGE_COLORS: Record<StageColor, { bg: string; fg: string; dot: string; soft: string }> = {
  red:    { bg: '#FEE2E2', fg: '#B91C1C', dot: '#EF4444', soft: '#FEF5F5' },
  blue:   { bg: '#DBEAFE', fg: '#1E40AF', dot: '#3B82F6', soft: '#F4F8FE' },
  amber:  { bg: '#FEF3C7', fg: '#B45309', dot: '#F59E0B', soft: '#FEFAF0' },
  violet: { bg: '#EDE9FE', fg: '#5B21B6', dot: '#7C3AED', soft: '#F8F6FE' },
  green:  { bg: '#E6F7EE', fg: '#047857', dot: '#10B981', soft: '#F2FBF6' },
  slate:  { bg: '#F4F4F6', fg: '#6B7280', dot: '#9CA3AF', soft: '#F8F8FA' },
  pink:   { bg: '#FCE7F3', fg: '#9D174D', dot: '#EC4899', soft: '#FEF5FA' },
  cyan:   { bg: '#ECFEFF', fg: '#0E7490', dot: '#06B6D4', soft: '#F5FEFF' },
  indigo: { bg: '#EEF2FF', fg: '#4338CA', dot: '#6366F1', soft: '#F6F8FF' },
  orange: { bg: '#FFEDD5', fg: '#C2410C', dot: '#F97316', soft: '#FFF8F1' },
};

export const STAGE_COLOR_LIST = Object.keys(STAGE_COLORS) as StageColor[];

export function getStageColor(c: string | null | undefined) {
  return STAGE_COLORS[(c as StageColor) || 'slate'] || STAGE_COLORS.slate;
}

// Slug for stage_key: 'Invoice Sent' -> 'invoice_sent'; suffix keeps it unique.
function slugify(name: string): string {
  const base = name.toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'stage';
  return `${base}_${Math.random().toString(36).slice(2, 6)}`;
}

// =============================================================================
// usePipelines — fetch + CRUD for pipelines and stages
// =============================================================================
export function usePipelines(workspaceId: string) {
  const supabase = useMemo(() => createClient(), []);
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [stages, setStages] = useState<Stage[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const [{ data: p, error: pe }, { data: s, error: se }] = await Promise.all([
      supabase.from('pipelines').select('*').order('sort_order').order('created_at'),
      supabase.from('stages').select('*').order('sort_order').order('created_at'),
    ]);
    if (pe || se) {
      // Most common cause: migration 003 not applied yet.
      toast.error('Pipelines not available — has migration 003 been run in Supabase?');
      setLoading(false);
      return;
    }
    setPipelines((p as Pipeline[]) || []);
    setStages((s as Stage[]) || []);
    setLoading(false);
  }, [supabase]);

  useEffect(() => { refresh(); }, [refresh]);

  const stagesFor = useCallback(
    (pipelineId: string) => stages.filter((s) => s.pipeline_id === pipelineId).sort((a, b) => a.sort_order - b.sort_order),
    [stages]
  );

  // ---- Pipeline CRUD ---------------------------------------------------------

  const createPipeline = useCallback(async (name: string, visaType?: string | null): Promise<Pipeline | null> => {
    const clean = name.trim();
    if (!clean) { toast.error('Give the pipeline a name'); return null; }
    const sort = pipelines.length ? Math.max(...pipelines.map((p) => p.sort_order)) + 1 : 0;
    const { data, error } = await supabase
      .from('pipelines')
      .insert({ workspace_id: workspaceId, name: clean, visa_type: visaType || null, sort_order: sort, is_default: false })
      .select()
      .single();
    if (error) { toast.error(`Could not create pipeline: ${error.message}`); return null; }
    const pipeline = data as Pipeline;

    // Seed a sensible starter set the user can rename/extend immediately.
    const seed = [
      { name: 'New Leads',   color: 'blue',   stage_type: 'active', sort_order: 0 },
      { name: 'In Progress', color: 'amber',  stage_type: 'active', sort_order: 1 },
      { name: 'Won',         color: 'green',  stage_type: 'won',    sort_order: 2 },
      { name: 'Lost',        color: 'slate',  stage_type: 'lost',   sort_order: 3 },
    ].map((s) => ({ ...s, pipeline_id: pipeline.id, workspace_id: workspaceId, stage_key: slugify(s.name) }));
    const { data: seeded, error: se } = await supabase.from('stages').insert(seed).select();
    if (se) { toast.error(`Pipeline created but stages failed: ${se.message}`); }

    setPipelines((prev) => [...prev, pipeline]);
    if (seeded) setStages((prev) => [...prev, ...(seeded as Stage[])]);
    toast.success(`Pipeline "${clean}" created`);
    return pipeline;
  }, [supabase, workspaceId, pipelines]);

  const renamePipeline = useCallback(async (id: string, name: string) => {
    const clean = name.trim();
    if (!clean) return;
    setPipelines((prev) => prev.map((p) => (p.id === id ? { ...p, name: clean } : p)));
    const { error } = await supabase.from('pipelines').update({ name: clean }).eq('id', id);
    if (error) { toast.error(`Rename failed: ${error.message}`); refresh(); }
  }, [supabase, refresh]);

  // leadsCount lets the caller block deleting a pipeline that still has leads.
  const deletePipeline = useCallback(async (id: string, leadsCount: number): Promise<boolean> => {
    const target = pipelines.find((p) => p.id === id);
    if (!target) return false;
    if (target.is_default) { toast.error('The default pipeline cannot be deleted'); return false; }
    if (leadsCount > 0) { toast.error(`Move its ${leadsCount} lead${leadsCount === 1 ? '' : 's'} to another pipeline first`); return false; }
    const { error } = await supabase.from('pipelines').delete().eq('id', id);
    if (error) { toast.error(`Delete failed: ${error.message}`); return false; }
    setPipelines((prev) => prev.filter((p) => p.id !== id));
    setStages((prev) => prev.filter((s) => s.pipeline_id !== id));
    toast.success(`Deleted "${target.name}"`);
    return true;
  }, [supabase, pipelines]);

  // ---- Stage CRUD --------------------------------------------------------------

  const createStage = useCallback(async (pipelineId: string, name: string, color: StageColor = 'blue', stageType: Stage['stage_type'] = 'active'): Promise<Stage | null> => {
    const clean = name.trim();
    if (!clean) { toast.error('Give the stage a name'); return null; }
    const siblings = stages.filter((s) => s.pipeline_id === pipelineId);
    const sort = siblings.length ? Math.max(...siblings.map((s) => s.sort_order)) + 1 : 0;
    const { data, error } = await supabase
      .from('stages')
      .insert({ pipeline_id: pipelineId, workspace_id: workspaceId, name: clean, stage_key: slugify(clean), color, sort_order: sort, stage_type: stageType })
      .select()
      .single();
    if (error) { toast.error(`Could not add stage: ${error.message}`); return null; }
    setStages((prev) => [...prev, data as Stage]);
    return data as Stage;
  }, [supabase, workspaceId, stages]);

  const updateStage = useCallback(async (id: string, patch: Partial<Pick<Stage, 'name' | 'color' | 'stage_type'>>) => {
    setStages((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } as Stage : s)));
    const { error } = await supabase.from('stages').update(patch).eq('id', id);
    if (error) { toast.error(`Update failed: ${error.message}`); refresh(); }
  }, [supabase, refresh]);

  // Swap sort_order with the neighbour above/below.
  const moveStage = useCallback(async (id: string, dir: 'up' | 'down') => {
    const s = stages.find((x) => x.id === id);
    if (!s) return;
    const siblings = stages.filter((x) => x.pipeline_id === s.pipeline_id).sort((a, b) => a.sort_order - b.sort_order);
    const idx = siblings.findIndex((x) => x.id === id);
    const swapWith = dir === 'up' ? siblings[idx - 1] : siblings[idx + 1];
    if (!swapWith) return;
    setStages((prev) => prev.map((x) => {
      if (x.id === s.id) return { ...x, sort_order: swapWith.sort_order };
      if (x.id === swapWith.id) return { ...x, sort_order: s.sort_order };
      return x;
    }));
    const [{ error: e1 }, { error: e2 }] = await Promise.all([
      supabase.from('stages').update({ sort_order: swapWith.sort_order }).eq('id', s.id),
      supabase.from('stages').update({ sort_order: s.sort_order }).eq('id', swapWith.id),
    ]);
    if (e1 || e2) { toast.error('Reorder failed'); refresh(); }
  }, [supabase, stages, refresh]);

  const deleteStage = useCallback(async (id: string): Promise<boolean> => {
    const target = stages.find((s) => s.id === id);
    if (!target) return false;
    const siblings = stages.filter((s) => s.pipeline_id === target.pipeline_id);
    if (siblings.length <= 1) { toast.error('A pipeline needs at least one stage'); return false; }
    const { error } = await supabase.from('stages').delete().eq('id', id);
    if (error) { toast.error(`Delete failed: ${error.message}`); return false; }
    setStages((prev) => prev.filter((s) => s.id !== id));
    return true;
  }, [supabase, stages]);

  return {
    pipelines, stages, loading, refresh, stagesFor,
    createPipeline, renamePipeline, deletePipeline,
    createStage, updateStage, moveStage, deleteStage,
  };
}
