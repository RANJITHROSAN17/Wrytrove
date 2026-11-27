export interface NoteFileSnapshot {
  readonly path: string;
  readonly content: string;
  readonly sha256: string;
  readonly readable?: boolean;
  readonly skipReason?: string;
}

export interface PlannedLinkEdit {
  readonly id: string;
  readonly sourcePath: string;
  readonly line: number;
  readonly originalLink: string;
  readonly proposedLink: string;
  readonly expectedSha256: string;
  readonly ambiguous: boolean;
  accepted: boolean;
}

export interface SkippedNoteFile {
  readonly path: string;
  readonly reason: string;
}

export interface NoteMovePlan {
  readonly oldPath: string;
  readonly newPath: string;
  readonly sourceExpectedSha256: string;
  readonly sourceContent: string;
  readonly affectedLinks: PlannedLinkEdit[];
  readonly ambiguousLinks: PlannedLinkEdit[];
  readonly skippedFiles: SkippedNoteFile[];
}

function stemOf(path: string): string {
  const base = path.split('/').pop() ?? path;
  return base.replace(/\.md$/iu, '');
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

export function planNoteMoveTransaction(input: {
  oldPath: string;
  newPath: string;
  files: readonly NoteFileSnapshot[];
}): NoteMovePlan {
  const sourceFile = input.files.find((f) => f.path === input.oldPath);
  if (!sourceFile) {
    throw new Error(`Source note not found: ${input.oldPath}`);
  }
  if (input.oldPath === input.newPath) {
    throw new Error('Destination path must differ from source path.');
  }

  const oldStem = stemOf(input.oldPath);
  const newStem = stemOf(input.newPath);

  // Detect duplicate stems across readable files to flag ambiguous wikilinks.
  const stemCounts = new Map<string, number>();
  for (const f of input.files) {
    if (f.readable === false) continue;
    const s = stemOf(f.path).toLowerCase();
    stemCounts.set(s, (stemCounts.get(s) ?? 0) + 1);
  }
  const isStemAmbiguous = (stemCounts.get(oldStem.toLowerCase()) ?? 0) > 1;

  const affectedLinks: PlannedLinkEdit[] = [];
  const ambiguousLinks: PlannedLinkEdit[] = [];
  const skippedFiles: SkippedNoteFile[] = [];

  const oldPathNoExt = input.oldPath.replace(/\.md$/iu, '');
  const newPathNoExt = input.newPath.replace(/\.md$/iu, '');
  const linkRegex = new RegExp(
    `\\[\\[(${escapeRegExp(input.oldPath)}|${escapeRegExp(oldPathNoExt)}|${escapeRegExp(oldStem)})((?:#[^\\]|]+)?(?:\\|[^\\]]+)?)\\]\\]`,
    'gu',
  );

  for (const file of input.files) {
    if (file.readable === false) {
      skippedFiles.push({ path: file.path, reason: file.skipReason ?? 'unreadable' });
      continue;
    }
    if (file.path === input.oldPath) continue;

    const lines = file.content.split('\n');
    for (let i = 0; i < lines.length; i += 1) {
      const lineText = lines[i];
      for (const match of lineText.matchAll(linkRegex)) {
        const target = match[1];
        const suffix = match[2] ?? '';
        const replacementTarget =
          target === input.oldPath
            ? input.newPath
            : target === oldPathNoExt
              ? newPathNoExt
              : newStem;
        const edit: PlannedLinkEdit = {
          id: `${file.path}:${i + 1}:${match.index ?? 0}`,
          sourcePath: file.path,
          line: i + 1,
          originalLink: match[0],
          proposedLink: `[[${replacementTarget}${suffix}]]`,
          expectedSha256: file.sha256,
          ambiguous: isStemAmbiguous && target !== input.oldPath && target !== oldPathNoExt,
          accepted: !(isStemAmbiguous && target !== input.oldPath && target !== oldPathNoExt),
        };
        affectedLinks.push(edit);
        if (edit.ambiguous) {
          ambiguousLinks.push(edit);
        }
      }
    }
  }

  return {
    oldPath: input.oldPath,
    newPath: input.newPath,
    sourceExpectedSha256: sourceFile.sha256,
    sourceContent: sourceFile.content,
    affectedLinks,
    ambiguousLinks,
    skippedFiles,
  };
}

export interface NoteTransactionFs {
  readHash(path: string): Promise<string | null>;
  readContent(path: string): Promise<string | null>;
  stageWrite(path: string, content: string, expectedHash: string | null): Promise<void>;
  removeFile(path: string, expectedHash: string): Promise<void>;
  rebuildIndex(): Promise<void>;
}

export interface NoteTransactionResult {
  readonly status: 'committed' | 'aborted' | 'partial';
  readonly updatedFiles: readonly string[];
  readonly skippedAmbiguousCount: number;
  readonly reason?: string;
  readonly manualCopyPath?: string;
}

export async function executeNoteMoveTransaction(
  plan: NoteMovePlan,
  fs: NoteTransactionFs,
): Promise<NoteTransactionResult> {
  // 1. Pre-flight conflict checks before any mutation.
  const currentSourceHash = await fs.readHash(plan.oldPath);
  if (currentSourceHash !== plan.sourceExpectedSha256) {
    return {
      status: 'aborted',
      updatedFiles: [],
      skippedAmbiguousCount: plan.ambiguousLinks.filter((l) => !l.accepted).length,
      reason: 'Source note changed externally before transaction.',
      manualCopyPath: plan.oldPath,
    };
  }

  const destHash = await fs.readHash(plan.newPath);
  if (destHash !== null) {
    return {
      status: 'aborted',
      updatedFiles: [],
      skippedAmbiguousCount: plan.ambiguousLinks.filter((l) => !l.accepted).length,
      reason: `Destination already exists: ${plan.newPath}`,
      manualCopyPath: plan.oldPath,
    };
  }

  const acceptedEdits = plan.affectedLinks.filter((e) => e.accepted);
  const editsByFile = new Map<string, PlannedLinkEdit[]>();
  for (const edit of acceptedEdits) {
    const list = editsByFile.get(edit.sourcePath) ?? [];
    list.push(edit);
    editsByFile.set(edit.sourcePath, list);
  }

  for (const [sourcePath, edits] of editsByFile.entries()) {
    const actualHash = await fs.readHash(sourcePath);
    if (actualHash !== edits[0].expectedSha256) {
      return {
        status: 'aborted',
        updatedFiles: [],
        skippedAmbiguousCount: plan.ambiguousLinks.filter((l) => !l.accepted).length,
        reason: `Linked file changed externally: ${sourcePath}`,
        manualCopyPath: plan.oldPath,
      };
    }
  }

  // 2. Stage new path.
  await fs.stageWrite(plan.newPath, plan.sourceContent, null);
  const updatedFiles: string[] = [plan.newPath];

  // 3. Apply accepted link repairs.
  try {
    for (const [sourcePath, edits] of editsByFile.entries()) {
      const content = await fs.readContent(sourcePath);
      if (content === null) {
        throw new Error(`Unable to read ${sourcePath} during commit.`);
      }
      let nextContent = content;
      for (const edit of edits) {
        nextContent = nextContent.replace(edit.originalLink, edit.proposedLink);
      }
      await fs.stageWrite(sourcePath, nextContent, edits[0].expectedSha256);
      updatedFiles.push(sourcePath);
    }

    // 4. Remove old path only after all writes succeed.
    await fs.removeFile(plan.oldPath, plan.sourceExpectedSha256);

    // 5. Rebuild index only after commit.
    await fs.rebuildIndex();

    return {
      status: 'committed',
      updatedFiles,
      skippedAmbiguousCount: plan.ambiguousLinks.filter((l) => !l.accepted).length,
    };
  } catch (err) {
    return {
      status: 'partial',
      updatedFiles,
      skippedAmbiguousCount: plan.ambiguousLinks.filter((l) => !l.accepted).length,
      reason: err instanceof Error ? err.message : 'Transaction failed during link repair.',
      manualCopyPath: plan.oldPath,
    };
  }
}
