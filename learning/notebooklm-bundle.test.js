import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildBundle } from './notebooklm-bundle.js';

const rows = [
  {
    content: {
      guide: 'RAG grounds an LLM in retrieved documents to cut hallucination.',
      flashcards: [
        { front: 'What does RAG stand for?', back: 'Retrieval-Augmented Generation.' },
        { front: 'Why use RAG?', back: 'To ground answers in real sources.' },
      ],
      quiz: [
        {
          question: 'RAG primarily reduces which problem?',
          choices: ['Latency', 'Hallucination', 'Token cost'],
          answer: 'Hallucination',
        },
      ],
    },
    learning_sessions: { title: 'Intro to RAG', learned_on: '2026-07-20' },
  },
  {
    content: {
      guide: 'A vector index enables semantic nearest-neighbour search.',
      flashcards: [{ front: 'What is an embedding?', back: 'A dense vector representation of text.' }],
      quiz: [
        { question: 'Embeddings enable what kind of search?', choices: ['Keyword', 'Semantic'], answer: 'Semantic' },
      ],
    },
    learning_sessions: { title: 'Vector Search Basics', learned_on: '2026-07-21' },
  },
];

const STAMP = '2026-07-29T00:00:00Z';

test('bundle contains each item title', () => {
  const md = buildBundle(rows, STAMP);
  assert.match(md, /Intro to RAG/);
  assert.match(md, /Vector Search Basics/);
});

test('bundle contains a study guide, a flashcard, and a quiz question', () => {
  const md = buildBundle(rows, STAMP);
  assert.match(md, /RAG grounds an LLM in retrieved documents/); // guide
  assert.match(md, /What does RAG stand for\?/); // flashcard front
  assert.match(md, /Retrieval-Augmented Generation\./); // flashcard back
  assert.match(md, /RAG primarily reduces which problem\?/); // quiz question
  assert.match(md, /_Answer: Hallucination_/); // quiz answer
});

test('output is deterministic for the same inputs', () => {
  assert.equal(buildBundle(rows, STAMP), buildBundle(rows, STAMP));
});
