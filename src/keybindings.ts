export type CommandId =
  | 'settings.open'
  | 'commandPalette.open'
  | 'file.save'
  | 'file.open'
  | 'search.find'
  | 'ai.askDocument';

export interface KeybindingEntry {
  readonly commandId: CommandId;
  readonly chord: string;
  readonly protected?: boolean;
}

export interface KeybindingConflict {
  readonly chord: string;
  readonly commands: readonly CommandId[];
}

export const DEFAULT_KEYBINDINGS: readonly KeybindingEntry[] = [
  { commandId: 'settings.open', chord: 'Ctrl+,', protected: true },
  { commandId: 'commandPalette.open', chord: 'Ctrl+Shift+P', protected: true },
  { commandId: 'file.save', chord: 'Ctrl+S' },
  { commandId: 'file.open', chord: 'Ctrl+O' },
  { commandId: 'search.find', chord: 'Ctrl+F' },
  { commandId: 'ai.askDocument', chord: 'Ctrl+Shift+A' },
];

const VALID_COMMAND_IDS = new Set<string>(DEFAULT_KEYBINDINGS.map((b) => b.commandId));

export function normalizeChord(chord: string): string {
  return chord
    .split('+')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => (part.length === 1 ? part.toUpperCase() : part[0].toUpperCase() + part.slice(1).toLowerCase()))
    .join('+');
}

export function sanitizeKeybindings(raw: unknown): KeybindingEntry[] {
  const byCommand = new Map<CommandId, KeybindingEntry>(
    DEFAULT_KEYBINDINGS.map((b) => [b.commandId, { ...b }]),
  );

  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (!item || typeof item !== 'object') continue;
      const rec = item as Record<string, unknown>;
      if (typeof rec.commandId !== 'string' || !VALID_COMMAND_IDS.has(rec.commandId)) continue;
      if (typeof rec.chord !== 'string') continue;
      const normalized = normalizeChord(rec.chord);
      if (!normalized || normalized.length > 40) continue;
      const cmd = rec.commandId as CommandId;
      const existing = byCommand.get(cmd);
      byCommand.set(cmd, {
        commandId: cmd,
        chord: normalized,
        protected: existing?.protected,
      });
    }
  }

  // Ensure protected commands always retain a non-empty chord.
  for (const def of DEFAULT_KEYBINDINGS) {
    if (def.protected) {
      const current = byCommand.get(def.commandId);
      if (!current || !current.chord) {
        byCommand.set(def.commandId, { ...def });
      }
    }
  }

  return Array.from(byCommand.values());
}

export function detectKeybindingConflicts(bindings: readonly KeybindingEntry[]): KeybindingConflict[] {
  const byChord = new Map<string, CommandId[]>();
  for (const b of bindings) {
    const norm = normalizeChord(b.chord);
    if (!norm) continue;
    const list = byChord.get(norm) ?? [];
    list.push(b.commandId);
    byChord.set(norm, list);
  }

  const conflicts: KeybindingConflict[] = [];
  for (const [chord, commands] of byChord.entries()) {
    if (commands.length > 1) {
      conflicts.push({ chord, commands });
    }
  }
  return conflicts;
}

export function resetKeybindings(): KeybindingEntry[] {
  return DEFAULT_KEYBINDINGS.map((b) => ({ ...b }));
}
