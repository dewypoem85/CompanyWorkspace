const MATRIX_LIMIT = 500_000;
const MAX_RECURSION = 24;

export function diffTextLines(originalValue, currentValue) {
  const original = splitLines(originalValue);
  const current = splitLines(currentValue);
  const matches = [];
  collectMatches(original, 0, original.length, current, 0, current.length, matches, 0);
  matches.sort((left, right) => left[0] - right[0] || left[1] - right[1]);

  const kinds = Array(current.length).fill('modified');
  let addedCount = 0;
  let modifiedCount = 0;
  let removedCount = 0;
  const changes = [];
  let previousOriginal = -1;
  let previousCurrent = -1;

  for (const [originalIndex, currentIndex] of [...matches, [original.length, current.length]]) {
    const originalGap = originalIndex - previousOriginal - 1;
    const currentGap = currentIndex - previousCurrent - 1;
    const pairedChanges = Math.min(originalGap, currentGap);
    const addedLines = Math.max(0, currentGap - originalGap);
    const removedLines = Math.max(0, originalGap - currentGap);
    modifiedCount += pairedChanges;
    addedCount += addedLines;
    removedCount += removedLines;

    if (originalGap > 0 || currentGap > 0) {
      const currentStart = previousCurrent + 1;
      changes.push({
        kind: originalGap === 0 ? 'added' : currentGap === 0 ? 'removed' : 'modified',
        originalStart: previousOriginal + 1,
        originalEnd: originalIndex,
        currentStart,
        currentEnd: currentIndex,
        targetLine: Math.min(current.length - 1, currentStart),
        modifiedLines: pairedChanges,
        addedLines,
        removedLines
      });
    }

    for (let offset = pairedChanges; offset < currentGap; offset += 1) {
      kinds[previousCurrent + 1 + offset] = 'added';
    }
    if (currentIndex < current.length) kinds[currentIndex] = 'unchanged';
    previousOriginal = originalIndex;
    previousCurrent = currentIndex;
  }

  return {
    lines: current.map((text, index) => ({ text, kind: kinds[index] })),
    addedCount,
    modifiedCount,
    removedCount,
    changes,
    changed: addedCount + modifiedCount + removedCount > 0
  };
}

function splitLines(value) {
  return String(value ?? '').replace(/\r\n?/g, '\n').split('\n');
}

function collectMatches(original, originalStart, originalEnd, current, currentStart, currentEnd, matches, depth) {
  while (originalStart < originalEnd && currentStart < currentEnd
    && original[originalStart] === current[currentStart]) {
    matches.push([originalStart, currentStart]);
    originalStart += 1;
    currentStart += 1;
  }

  const suffix = [];
  while (originalStart < originalEnd && currentStart < currentEnd
    && original[originalEnd - 1] === current[currentEnd - 1]) {
    originalEnd -= 1;
    currentEnd -= 1;
    suffix.push([originalEnd, currentEnd]);
  }

  if (originalStart < originalEnd && currentStart < currentEnd) {
    const originalLength = originalEnd - originalStart;
    const currentLength = currentEnd - currentStart;
    if (originalLength * currentLength <= MATRIX_LIMIT) {
      matches.push(...lcsMatches(original, originalStart, originalEnd, current, currentStart, currentEnd));
    } else if (depth < MAX_RECURSION) {
      const anchors = uniqueAnchors(original, originalStart, originalEnd, current, currentStart, currentEnd);
      if (anchors.length > 0) {
        let nextOriginal = originalStart;
        let nextCurrent = currentStart;
        for (const anchor of anchors) {
          collectMatches(original, nextOriginal, anchor[0], current, nextCurrent, anchor[1], matches, depth + 1);
          matches.push(anchor);
          nextOriginal = anchor[0] + 1;
          nextCurrent = anchor[1] + 1;
        }
        collectMatches(original, nextOriginal, originalEnd, current, nextCurrent, currentEnd, matches, depth + 1);
      }
    }
  }

  matches.push(...suffix.reverse());
}

function lcsMatches(original, originalStart, originalEnd, current, currentStart, currentEnd) {
  const originalLength = originalEnd - originalStart;
  const currentLength = currentEnd - currentStart;
  const matrix = Array.from({ length: originalLength + 1 }, () => new Uint32Array(currentLength + 1));
  for (let originalOffset = originalLength - 1; originalOffset >= 0; originalOffset -= 1) {
    for (let currentOffset = currentLength - 1; currentOffset >= 0; currentOffset -= 1) {
      matrix[originalOffset][currentOffset] = original[originalStart + originalOffset] === current[currentStart + currentOffset]
        ? matrix[originalOffset + 1][currentOffset + 1] + 1
        : Math.max(matrix[originalOffset + 1][currentOffset], matrix[originalOffset][currentOffset + 1]);
    }
  }

  const result = [];
  let originalOffset = 0;
  let currentOffset = 0;
  while (originalOffset < originalLength && currentOffset < currentLength) {
    if (original[originalStart + originalOffset] === current[currentStart + currentOffset]) {
      result.push([originalStart + originalOffset, currentStart + currentOffset]);
      originalOffset += 1;
      currentOffset += 1;
    } else if (matrix[originalOffset + 1][currentOffset] >= matrix[originalOffset][currentOffset + 1]) {
      originalOffset += 1;
    } else {
      currentOffset += 1;
    }
  }
  return result;
}

function uniqueAnchors(original, originalStart, originalEnd, current, currentStart, currentEnd) {
  const originalEntries = uniqueLineEntries(original, originalStart, originalEnd);
  const currentEntries = uniqueLineEntries(current, currentStart, currentEnd);
  const candidates = [];
  for (const [line, originalEntry] of originalEntries) {
    const currentEntry = currentEntries.get(line);
    if (originalEntry.count === 1 && currentEntry?.count === 1) {
      candidates.push([originalEntry.index, currentEntry.index]);
    }
  }
  candidates.sort((left, right) => left[0] - right[0]);
  return longestIncreasingCurrentIndexes(candidates);
}

function uniqueLineEntries(lines, start, end) {
  const entries = new Map();
  for (let index = start; index < end; index += 1) {
    const existing = entries.get(lines[index]);
    if (existing) existing.count += 1;
    else entries.set(lines[index], { count: 1, index });
  }
  return entries;
}

function longestIncreasingCurrentIndexes(candidates) {
  if (candidates.length === 0) return [];
  const tails = [];
  const predecessors = new Int32Array(candidates.length).fill(-1);
  for (let index = 0; index < candidates.length; index += 1) {
    let low = 0;
    let high = tails.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (candidates[tails[middle]][1] < candidates[index][1]) low = middle + 1;
      else high = middle;
    }
    if (low > 0) predecessors[index] = tails[low - 1];
    tails[low] = index;
  }

  const result = [];
  let cursor = tails.at(-1);
  while (cursor !== undefined && cursor >= 0) {
    result.push(candidates[cursor]);
    cursor = predecessors[cursor];
  }
  return result.reverse();
}
