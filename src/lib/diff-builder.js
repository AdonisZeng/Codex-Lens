import { diffLines, diffWords, diffChars } from 'diff';

export function generateLineDiff(oldContent, newContent) {
  if (!oldContent && !newContent) {
    return [];
  }

  const oldLines = (oldContent || '').split('\n');
  const newLines = (newContent || '').split('\n');

  const changes = diffLines(oldLines.join('\n'), newLines.join('\n'));
  const result = [];

  let oldLineNum = 1;
  let newLineNum = 1;

  for (const change of changes) {
    const lines = change.value.split('\n').filter(l => l !== '' || change.value === '\n');

    for (const line of lines) {
      if (change.added) {
        result.push({
          type: 'added',
          content: line,
          oldLineNumber: null,
          newLineNumber: newLineNum++
        });
      } else if (change.removed) {
        result.push({
          type: 'removed',
          content: line,
          oldLineNumber: oldLineNum++,
          newLineNumber: null
        });
      } else {
        result.push({
          type: 'unchanged',
          content: line,
          oldLineNumber: oldLineNum++,
          newLineNumber: newLineNum++
        });
      }
    }
  }

  return result;
}

export function generateWordDiff(oldContent, newContent) {
  if (!oldContent && !newContent) {
    return [];
  }

  const changes = diffWords(oldContent || '', newContent || '');
  const result = [];

  for (const change of changes) {
    result.push({
      type: change.added ? 'added' : change.removed ? 'removed' : 'unchanged',
      content: change.value
    });
  }

  return result;
}

export function generateCharDiff(oldContent, newContent) {
  if (!oldContent && !newContent) {
    return [];
  }

  const changes = diffChars(oldContent || '', newContent || '');
  const result = [];

  for (const change of changes) {
    result.push({
      type: change.added ? 'added' : change.removed ? 'removed' : 'unchanged',
      content: change.value
    });
  }

  return result;
}

export function formatDiffAsText(diff, options = {}) {
  const { showLineNumbers = true, prefixAdded = '+ ', prefixRemoved = '- ', prefixUnchanged = '  ' } = options;

  return diff.map(line => {
    let prefix;
    if (line.type === 'added') {
      prefix = prefixAdded;
    } else if (line.type === 'removed') {
      prefix = prefixRemoved;
    } else {
      prefix = prefixUnchanged;
    }

    const lineNumStr = showLineNumbers
      ? `${String(line.oldLineNumber || '').padStart(4)} ${String(line.newLineNumber || '').padStart(4)} | `
      : '';

    return `${lineNumStr}${prefix}${line.content}`;
  }).join('\n');
}

export function getDiffStats(diff) {
  const stats = {
    added: 0,
    removed: 0,
    unchanged: 0
  };

  for (const line of diff) {
    if (line.type === 'added') {
      stats.added++;
    } else if (line.type === 'removed') {
      stats.removed++;
    } else {
      stats.unchanged++;
    }
  }

  stats.total = stats.added + stats.removed + stats.unchanged;

  return stats;
}
