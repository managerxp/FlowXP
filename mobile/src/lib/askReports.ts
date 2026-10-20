/*
 * "Ask your reports" on the phone: a question box above the report lists that sends the question to Flow AI (the same assistant as Ask Flow AI,
 * POST /ai/chat). The assistant can call the report tools on the server (profit and loss, profit by item, discounts, GST by rate and HSN, stock
 * value, low stock, item movement, sales by category, money in and out), which run the same code the report screens do, as this person, so an
 * answer matches what the screen shows. The box only appears when the person may ask (Flow AI on, set up, questions left). Pure helpers here.
 */
export const REPORT_EXAMPLES = ['What was my profit this month?', 'Which items lose money?', 'How much GST do I owe?', 'What should I reorder?'];

export const MAX_ASK = 500;
/** The question as it will be sent, or '' when there is nothing to send. */
export const cleanQuestion = (text: string): string => text.trim().slice(0, MAX_ASK);

/** A question about the report being looked at: its name and the period, in the words the person sees. */
export const aboutReport = (template: string, title: string, from?: string, to?: string): string =>
  template.replace('{report}', title).replace('{from}', from ?? '').replace('{to}', to ?? '').replace(/\s+/g, ' ').replace(/ \./, '.').trim();

/** Every fixed text of the box, so the language tests can check each is translated. */
export const ASK_TEXTS: string[] = [...REPORT_EXAMPLES, 'Ask your reports', 'Ask', 'Thinking…', 'Open in Flow AI', 'Explain my {report} report from {from} to {to}.', 'Explain my {report} report.', 'Looked at {tools}'];
