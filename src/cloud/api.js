import * as rules from '../../shared/model-connection-settings.js';
import { createCloudTransport } from '../cloud-transport.js';
import { createCloudModelStore } from './model-store.js';
import { createCloudJobStore } from './job-store.js';
import { createCloudHistoryStore } from './history-store.js';
import { handleLocalRequest } from '../trial-storage.js';

export function createCloudApi({ origin, nativeFetch }) {
  const fetchImpl = createCloudTransport({ origin, fetchImpl: nativeFetch });
  const models = createCloudModelStore({ rules, fetchImpl });
  const jobs = createCloudJobStore({ origin, models, fetchImpl });
  const history = createCloudHistoryStore({});
  return async request => {
    try { return await models.handle(request) || await jobs.handle(request) || await history.handle(request) || await handleLocalRequest(request); }
    catch { return Response.json({ error: 'Browser storage could not complete this operation. Existing saved data is unchanged.' }, { status: 500 }); }
  };
}
