/* Pure logic for generating study materials from a learning item via Claude.
 * No I/O — builds the Anthropic request body and parses the response. The
 * network call lives in tools/gen-materials.mjs. */

export const MODEL = 'claude-opus-5'; // change to 'claude-sonnet-5' / 'claude-haiku-4-5' to cut cost

/* Structured-output schema: every object sets additionalProperties:false and
 * required (structured-outputs constraint). Guarantees parseable JSON. */
export const MATERIAL_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    guide: { type: 'string' },
    flashcards: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        properties: { front: { type: 'string' }, back: { type: 'string' } },
        required: ['front', 'back'],
      },
    },
    quiz: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        properties: {
          question: { type: 'string' },
          choices: { type: 'array', items: { type: 'string' } },
          answer: { type: 'string' },
        },
        required: ['question', 'choices', 'answer'],
      },
    },
  },
  required: ['guide', 'flashcards', 'quiz'],
};

const SYSTEM =
  'You turn a saved learning item (often a Chinese-language 抖音 video about AI/PM/engineering) ' +
  'into concise study materials for a Malaysian AI-PM/FDE learner. Write the guide in English, ' +
  'keep it practical and specific to the item.';

export function buildRequest(row, model = MODEL) {
  const title = row.title || 'Untitled';
  const summary = row.summary || '(no summary)';
  return {
    model,
    max_tokens: 2000,
    thinking: { type: 'disabled' }, // plain structured generation, no tools — cheaper/faster
    output_config: { format: { type: 'json_schema', schema: MATERIAL_SCHEMA } },
    system: SYSTEM,
    messages: [{
      role: 'user',
      content:
        `Create study materials for this learning item.\n\nTitle: ${title}\nSummary: ${summary}\n\n` +
        'Return: a study guide (<=180 words), 3-5 flashcards (front/back), and a 3-question ' +
        'multiple-choice quiz (each with 3-4 choices and the correct answer).',
    }],
  };
}

/* Parse the Anthropic response into {guide, flashcards, quiz}. Throws on refusal
 * or missing text. */
export function parseMaterial(resp) {
  if (resp.stop_reason === 'refusal') throw new Error('model refused to generate materials');
  const textBlock = (resp.content || []).find((b) => b.type === 'text');
  if (!textBlock) throw new Error('no text block in response');
  return JSON.parse(textBlock.text);
}
