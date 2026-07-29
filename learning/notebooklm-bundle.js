/* Pure formatter: learning_materials rows -> ONE markdown document suitable as a
 * NotebookLM source. No I/O. Deterministic given the same rows + timestamp.
 *
 * Each row is a PostgREST embed of shape:
 *   { content: { guide, flashcards:[{front,back}], quiz:[{question,choices,answer}] },
 *     learning_sessions: { title, learned_on } }
 * The network fetch + file write live in tools/push-notebooklm.mjs. */

const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];

function section(row, index) {
  const title = row.learning_sessions?.title || 'Untitled';
  const learnedOn = row.learning_sessions?.learned_on;
  const c = row.content || {};
  const out = [`## ${index}. ${title}`];
  if (learnedOn) out.push('', `_Learned on ${learnedOn}_`);

  if (c.guide) out.push('', '### Study Guide', '', c.guide);

  if (Array.isArray(c.flashcards) && c.flashcards.length) {
    out.push('', '### Flashcards', '');
    c.flashcards.forEach((f, i) => out.push(`${i + 1}. **${f.front}** — ${f.back}`));
  }

  if (Array.isArray(c.quiz) && c.quiz.length) {
    out.push('', '### Quiz', '');
    c.quiz.forEach((q, i) => {
      out.push(`**Q${i + 1}. ${q.question}**`, '');
      (q.choices || []).forEach((choice, j) => out.push(`- ${LETTERS[j] || j + 1}. ${choice}`));
      out.push('', `_Answer: ${q.answer}_`, '');
    });
  }

  return out.join('\n');
}

/* Combine every material row into one well-structured markdown string.
 * `generatedAt` is passed in (not read from the clock) so the output is
 * deterministic and testable. */
export function buildBundle(rows, generatedAt) {
  const header = [
    '# Life-OS Learnings — NotebookLM Source',
    '',
    `_Generated ${generatedAt} · ${rows.length} learning item(s)_`,
    '',
    'This document bundles every saved learning item with its AI study guide, ' +
      'flashcards, and quiz. Add it as a source in NotebookLM to chat with, ' +
      'summarize, or generate an audio overview across all of them.',
    '',
    '---',
    '',
  ];
  const body = rows.map((row, i) => section(row, i + 1)).join('\n\n---\n\n');
  return `${header.join('\n')}${body}\n`;
}
