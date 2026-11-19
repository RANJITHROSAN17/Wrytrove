export type ObservationRow = Record<string, string>;

export interface StudyFinding {
  file: string;
  rule: string;
  detail?: string;
}

export interface ValidationResult {
  ok: boolean;
  errors: string[];
}

export interface FixtureManifestResult {
  ok: boolean;
  errors: string[];
  count: number;
}

export interface StudyCheckResult {
  ok: boolean;
  files_scanned: number;
  fixture_count: number;
  findings: StudyFinding[];
}

export interface EvidenceCoverage {
  sufficient: boolean;
  blockers: string[];
  session_count: number;
  persona_codes: string[];
  display_codes: string[];
  assistive_codes: string[];
  task_ids: string[];
}

export interface FindingCount {
  code: string;
  count: number;
  max_severity: string;
}

export interface PersonaSummary {
  persona_code: string;
  session_count: number;
  task_count: number;
  independent_completion_rate: number | null;
  median_duration_seconds: number | null;
  median_error_count: number | null;
  median_help_count: number | null;
  error_total: number;
  hesitation_seconds_total: number;
  completion: Record<string, number>;
  comprehension: Record<string, number>;
  findings: FindingCount[];
  qualitative_finding_codes: string[];
}

export interface ConditionSummary {
  code: string;
  task_count: number;
  independent_completion_rate: number | null;
  error_total: number;
  finding_codes: string[];
}

export interface AccessibilityFinding {
  display_code: string;
  at_code: string;
  task_id: string;
  finding_code: string;
  count: number;
  max_severity: string;
  route: string;
}

export interface DecisionRecommendation {
  id: string;
  title: string;
  route: string;
  outcome: string;
  basis: string;
}

export interface StudySummary {
  version: 1;
  status: string;
  session_count: number;
  evidence: EvidenceCoverage;
  personas: PersonaSummary[];
  conditions: {
    display: ConditionSummary[];
    assistive: ConditionSummary[];
  };
  accessibility_findings: AccessibilityFinding[];
  decisions: DecisionRecommendation[];
  pilot_exception: unknown;
  privacy_note: string;
}

export declare const DEFAULT_STUDY_ROOT: string;
export declare const MIN_SESSIONS: number;
export declare const PERSONA_CODES: readonly string[];
export declare const TASK_IDS: readonly string[];
export declare const DISPLAY_CODES: readonly string[];
export declare const REQUIRED_DISPLAY_CODES: readonly string[];
export declare const AT_CODES: readonly string[];
export declare const REQUIRED_AT_CODES: readonly string[];
export declare const COMPLETION_CODES: readonly string[];
export declare const COMPREHENSION_CODES: readonly string[];
export declare const SEVERITY_CODES: readonly string[];
export declare const FINDING_CODES: readonly string[];
export declare const OBSERVATION_COLUMNS: readonly string[];

export declare function parseCsv(text: string): ObservationRow[];
export declare function validateObservationRows(rows: ObservationRow[]): ValidationResult;
export declare function evaluateEvidenceCoverage(rows: ObservationRow[]): EvidenceCoverage;
export declare function summarizeObservations(rows: ObservationRow[], options?: { pilotException?: unknown }): StudySummary;
export declare function renderSummaryMarkdown(summary: StudySummary): string;
export declare function scanText(text: string, relativePath?: string, fixtureSnippets?: readonly string[]): StudyFinding[];
export declare function verifyFixtureManifest(root?: string): Promise<FixtureManifestResult>;
export declare function writeFixtureManifest(root?: string): Promise<FixtureManifestResult>;
export declare function collectPrivacyFindings(root?: string): Promise<{ findings: StudyFinding[]; files_scanned: number }>;
export declare function checkStudy(root?: string): Promise<StudyCheckResult>;
