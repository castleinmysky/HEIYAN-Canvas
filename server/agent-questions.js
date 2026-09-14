// Shared by Codex RPC, custom APIs and saved conversations. Silence is not consent.
export const QUESTION_WAIT_MS = 120000;
export const deferredQuestionNote = '用户尚未回答，问题已保留。只能继续不依赖该答案且已经授权的安全步骤；不得猜选项、扩大权限或把超时当作同意。没有独立步骤就说明等待回答并结束本轮。不要重复提出同一个问题。';
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const string = (value, max) => typeof value === 'string' && value.trim().length > 0 && value.length <= max;
export function normalizeQuestions(value) {
  if (!Array.isArray(value) || !value.length || value.length > 3) throw Error('每次可提出 1–3 个问题');
  const ids = new Set();
  return value.map(q => {
    if (!object(q) || !string(q.id, 80) || ['__proto__', 'constructor', 'prototype'].includes(q.id) || ids.has(q.id) || !string(q.question, 2000)) throw Error('问题编号或内容无效');
    ids.add(q.id);
    const options = q.options == null ? [] : q.options;
    if (!Array.isArray(options) || options.length > 6) throw Error('每个问题最多 6 个选项');
    const labels = new Set();
    return { id: q.id, header: typeof q.header === 'string' ? q.header.slice(0, 80) : '', question: q.question, isOther: true, isSecret: q.isSecret === true,
      options: options.map(option => {
        if (!object(option) || !string(option.label, 200) || labels.has(option.label) || option.description != null && (typeof option.description !== 'string' || option.description.length > 1000)) throw Error('问题选项无效');
        labels.add(option.label); return { label: option.label, description: option.description || '' };
      }) };
  });
}
export function questionAnswers(questions, input) {
  if (!object(input) || Object.keys(input).some(id => !questions.some(q => q.id === id))) throw Error('答案不属于当前问题');
  return Object.fromEntries(questions.map(q => {
    const answers = input[q.id]?.answers;
    if (!Array.isArray(answers) || answers.length !== 1 || !string(answers[0], 4000)) throw Error('请为每个问题选择一项或填写回答');
    return [q.id, { answers: [answers[0].trim()] }];
  }));
}
export function cleanQuestion(value) {
  if (!object(value) || !string(value.id, 180) || !['pending', 'deferred', 'answered', 'cancelled'].includes(value.status) || !Number.isFinite(value.createdAt)) throw Error('提问记录无效');
  const questions = normalizeQuestions(value.questions);
  const answers = value.status === 'answered' ? questionAnswers(questions, value.answers) : undefined;
  return { id: value.id, questions, status: value.status, source: value.source === 'api' ? 'api' : 'codex', createdAt: value.createdAt,
    updatedAt: Number(value.updatedAt) || value.createdAt,
    ...(answers ? { answers: Object.fromEntries(questions.map(q => [q.id, { answers: q.isSecret ? ['[私密回答不保存]'] : answers[q.id].answers }])) } : {}) };
}
export function questionText(question) {
  return question.questions.map(q => q.question + (question.answers?.[q.id] ? '\n回答：' + question.answers[q.id].answers.join('、') : '')).join('\n\n');
}
export function questionMessage(question) { return { id: 'question:' + question.id, role: 'notice', text: questionText(question), question }; }
export function questionResult(question, answers) { return answers ? { status: 'answered', answers } : { status: 'deferred', answers: {}, instruction: deferredQuestionNote }; }
export const questionTool = { type: 'function', name: 'heiyan_ask_question', description: 'Ask the current user 1–3 concise creative questions using a real conversation card. Offer options when useful; free text is always available. Do not use plain prose for a choice the user must answer. This is NOT an approval tool. Missing or deferred answers never grant consent. When deferred, continue only already-authorized independent steps, or finish with the unresolved question retained; never guess an answer or repeatedly ask the same question.', inputSchema: {
  type: 'object', additionalProperties: false, required: ['questions'], properties: { questions: { type: 'array', minItems: 1, maxItems: 3, items: {
    type: 'object', additionalProperties: false, required: ['id', 'header', 'question', 'options'], properties: {
      id: { type: 'string' }, header: { type: 'string' }, question: { type: 'string' }, options: { type: 'array', maxItems: 6, items: { type: 'object', additionalProperties: false, required: ['label', 'description'], properties: { label: { type: 'string' }, description: { type: 'string' } } } },
    },
  } } },
} };
