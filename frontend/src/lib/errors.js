// Maps the (PHI-free) failure messages the backend stores on a record to guidance for users.
const RULES = [
  [/password/i, 'Password-protected file', 'Remove the password and upload the file again.'],
  [/timeout|timed out/i, 'The AI service timed out',
    'This can happen with long documents or when the service is busy. Upload the file again in a few minutes.'],
  [/not configured|api_key/i, 'AI service is not configured', 'Ask an administrator to check the server configuration.'],
  [/tesseract/i, 'Text recognition is unavailable', 'Ask an administrator to check the server setup.'],
  [/could not read the file|too many pages|too many frames/i, 'This file could not be read',
    'It may be corrupted or in an unsupported layout. Re-export or re-scan it, then upload it again.'],
  [/no readable text/i, 'No readable text found', 'The pages may be blank or too faint. Try a clearer scan.'],
  [/LLM extraction failed/i, 'The AI service could not analyze this file', 'Try uploading it again in a few minutes.'],
]

export function describeFailure(message = '') {
  for (const [re, title, hint] of RULES) if (re.test(message)) return { title, hint }
  return { title: 'Processing failed', hint: 'Try uploading the file again. If it keeps failing, contact support.' }
}
