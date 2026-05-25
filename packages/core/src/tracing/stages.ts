/**
 * The pipeline stages that every crawl flows through. A span MUST exist for each
 * one (ADR-010). Adding a stage here is a deliberate act — keep the set small.
 */
export const PIPELINE_STAGES = ['fetch', 'compile', 'execute', 'validate', 'self-heal'] as const;

export type PipelineStage = (typeof PIPELINE_STAGES)[number];
