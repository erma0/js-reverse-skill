'use strict';

/**
 * Case adapter contract (example only).
 *
 * Copy this file to result/src/adapter.js only after the current case has
 * captured a real successful chain. Every method must be implemented from
 * that case's wire evidence and RuyiTrace; do not fill in guessed vendor
 * defaults here.
 */

async function loadChallenge(_session, _config) {
  throw new Error('Implement bootstrap/load sequence from this case evidence');
}

async function resolveAssets(_session, _config, _loadResult) {
  throw new Error('Implement asset resolution from this case evidence');
}

async function prepareAnswer(answer) {
  return answer;
}

async function buildVerifyRequest(_context) {
  throw new Error('Implement exact method, URL, query/body serialization and headers from this case evidence');
}

async function parseVerifyResponse(_response, _context) {
  throw new Error('Implement response/JSONP parsing and credential validation from this case evidence');
}

async function consumeCredential(_session, _config, _credential) {
  throw new Error('Implement business credential consumption and success semantics from this case evidence');
}

module.exports = {
  loadChallenge,
  resolveAssets,
  prepareAnswer,
  buildVerifyRequest,
  parseVerifyResponse,
  consumeCredential,
};
