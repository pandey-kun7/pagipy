import { DiffCollectionItem, StructuredDiff } from '../../shared/types.js';

interface MarkdownSection {
  heading: string;
  level: number;
  lines: string[];
}

export class DeterministicDiffEngine {
  /**
   * Parses markdown text into structural sections keyed by headings.
   */
  parseSections(markdown: string): MarkdownSection[] {
    const rawLines = markdown.split('\n');
    const sections: MarkdownSection[] = [];
    let currentHeading = 'Document Root';
    let currentLevel = 0;
    let currentLines: string[] = [];

    for (const rawLine of rawLines) {
      const line = rawLine.trimEnd();
      const headingMatch = line.match(/^(#{1,6})\s+(.*)$/);

      if (headingMatch) {
        if (currentLines.length > 0 || currentHeading !== 'Document Root') {
          sections.push({
            heading: currentHeading,
            level: currentLevel,
            lines: currentLines,
          });
        }
        currentLevel = headingMatch[1].length;
        currentHeading = headingMatch[2].trim();
        currentLines = [];
      } else {
        if (line.trim().length > 0) {
          currentLines.push(line);
        }
      }
    }

    if (currentLines.length > 0 || sections.length === 0) {
      sections.push({
        heading: currentHeading,
        level: currentLevel,
        lines: currentLines,
      });
    }

    return sections;
  }

  /**
   * Computes a structured deterministic diff between two markdown snapshots.
   */
  computeDiff(oldMarkdown: string | null, newMarkdown: string): StructuredDiff {
    if (oldMarkdown === null) {
      // Baseline initial version
      const newSections = this.parseSections(newMarkdown);
      const added: DiffCollectionItem[] = newSections.map((sec) => ({
        section: sec.heading,
        value: sec.lines.join('\n'),
      }));

      return {
        has_changes: true,
        is_baseline: true,
        added,
        removed: [],
        modified: [],
        summary_counts: {
          added: added.length,
          removed: 0,
          modified: 0,
        },
      };
    }

    const oldSections = this.parseSections(oldMarkdown);
    const newSections = this.parseSections(newMarkdown);

    const oldMap = new Map<string, MarkdownSection>();
    for (const sec of oldSections) {
      oldMap.set(sec.heading, sec);
    }

    const newMap = new Map<string, MarkdownSection>();
    for (const sec of newSections) {
      newMap.set(sec.heading, sec);
    }

    const added: DiffCollectionItem[] = [];
    const removed: DiffCollectionItem[] = [];
    const modified: DiffCollectionItem[] = [];

    // Check for new or modified sections
    for (const [heading, newSec] of newMap.entries()) {
      const oldSec = oldMap.get(heading);
      if (!oldSec) {
        added.push({
          section: heading,
          value: newSec.lines.join('\n'),
        });
      } else {
        const oldContent = oldSec.lines.join('\n');
        const newContent = newSec.lines.join('\n');

        if (oldContent !== newContent) {
          // Identify specific line differences
          const oldSet = new Set(oldSec.lines);
          const newSet = new Set(newSec.lines);

          const addedLines = newSec.lines.filter((l) => !oldSet.has(l));
          const removedLines = oldSec.lines.filter((l) => !newSet.has(l));

          modified.push({
            section: heading,
            before: removedLines.length > 0 ? removedLines.join('\n') : oldContent,
            after: addedLines.length > 0 ? addedLines.join('\n') : newContent,
          });
        }
      }
    }

    // Check for removed sections
    for (const [heading, oldSec] of oldMap.entries()) {
      if (!newMap.has(heading)) {
        removed.push({
          section: heading,
          value: oldSec.lines.join('\n'),
        });
      }
    }

    const hasChanges = added.length > 0 || removed.length > 0 || modified.length > 0;

    return {
      has_changes: hasChanges,
      is_baseline: false,
      added,
      removed,
      modified,
      summary_counts: {
        added: added.length,
        removed: removed.length,
        modified: modified.length,
      },
    };
  }
}

export const diffEngine = new DeterministicDiffEngine();
