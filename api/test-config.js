'use strict';

const {publicTestConfig, send} = require('../server/test-integrations');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return send(res, 405, {error: 'Method not allowed'});
  try {
    const {url, key} = publicTestConfig();
    return send(res, 200, {supabaseUrl: url, supabasePublishableKey: key});
  } catch {
    return send(res, 503, {error: 'The test connection is not configured.'});
  }
};
