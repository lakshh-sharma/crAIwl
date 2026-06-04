export const PACKAGE_NAME = '@craiwl/api';

export {
  confirmScope,
  ScopeConfirmError,
  type ScopeConfirmRequest,
  type ScopeConfirmResponse,
  type ScopeConfirmDeps,
  type ScopeEstimate,
} from './scope.js';
export { createServer, type CraiwlServer, type CreateServerOptions } from './server.js';
