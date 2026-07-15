export class ApiContractError extends Error {
  constructor(message) { super(message); this.name = 'ApiContractError'; }
}

const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);

export function validateEnvelope(body, label = 'API response') {
  if (!isObject(body)) throw new ApiContractError(`${label} returned a non-object envelope`);
  if (typeof body.ok !== 'boolean') throw new ApiContractError(`${label} envelope is missing a boolean ok field`);
  if (!Object.prototype.hasOwnProperty.call(body, 'data')) throw new ApiContractError(`${label} envelope is missing its data field`);
  if (body.error != null && !isObject(body.error)) throw new ApiContractError(`${label} envelope has an invalid error field`);
  return body;
}

export function unwrapApiBody(body, label = 'API response') {
  if (isObject(body) && Object.prototype.hasOwnProperty.call(body, 'ok')) {
    const envelope = validateEnvelope(body, label);
    if (!envelope.ok) throw new Error(envelope.error?.message || `${label} reported a failure`);
    return envelope.data;
  }
  // Compatibility endpoints may still return raw structured JSON.
  if (!isObject(body) && !Array.isArray(body)) throw new ApiContractError(`${label} returned an invalid JSON payload`);
  return body;
}

export async function readJsonResponse(response, label = 'API response') {
  try { return await response.json(); }
  catch { throw new ApiContractError(`${label} did not return valid JSON`); }
}
